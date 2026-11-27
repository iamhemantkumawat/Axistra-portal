const test = require('node:test');
const assert = require('node:assert/strict');
require('reflect-metadata');
const { initializeExpenseCounters, nextExpenseCode } = require('../dist/common/expense-code');
const { ExpensesService } = require('../dist/expenses/expenses.service');
const { WalletsService } = require('../dist/wallets/wallets.service');
const november = new Date('2026-11-15T12:00:00Z');

test('allocator binds the monthly counter key and preserves long suffixes', async () => {
  let parameters;
  const manager = { query: async (_sql, args) => { parameters = args; return [{ last_number: '100000' }]; } };
  assert.equal(await nextExpenseCode(manager, november), 'EXP-2611-100000');
  assert.deepEqual(parameters, ['expense_code_counter:2611', 'EXP-2611-']);
});

test('invalid code dates fail before accessing the database', async () => {
  await assert.rejects(nextExpenseCode({ query: () => assert.fail('unexpected query') }, new Date(NaN)), RangeError);
});

test('expense service initializes monthly high-water marks on startup', async () => {
  let calls = 0;
  const service = new ExpensesService({ manager: { query: async (sql) => {
    assert.match(sql, /ON CONFLICT/); calls++;
  } } }, {}, {}, {});
  await service.onModuleInit();
  assert.equal(calls, 1);
});

test('manual expenses use the shared allocator and create one wallet debit', async () => {
  let allocations = 0;
  const debits = [];
  const repo = {
    manager: { query: async () => { allocations++; return [{ last_number: '39' }]; } },
    create: (payload) => ({ id: 'fixture-expense', ...payload }),
    save: async (payload) => payload,
  };
  const service = new ExpensesService(repo, {}, { log: async () => {} }, { recordExpense: async (value) => debits.push(value) });
  const expense = await service.create({ vendor_name: 'Fixture vendor', amount: '100.16', currency: 'USDT',
    payment_method: 'USDT', source_wallet: 'BINANCE' });
  assert.match(expense.expense_code, /^EXP-\d{4}-00039$/);
  assert.equal(allocations, 1);
  assert.equal(debits.length, 1);
  assert.equal(debits[0].wallet, 'BINANCE');
  assert.equal(debits[0].amount, '100.16');
});

test('explicit expense codes retain existing API behavior without reserving a number', async () => {
  const repo = {
    manager: { query: () => assert.fail('explicit code must not allocate') },
    create: (payload) => ({ id: 'fixture-expense', ...payload }), save: async (payload) => payload,
  };
  const service = new ExpensesService(repo, {}, { log: async () => {} }, { recordExpense: async () => {} });
  const expense = await service.create({ vendor_name: 'Fixture vendor', amount: '1', currency: 'AED', expense_code: 'IMPORTED-CODE' });
  assert.equal(expense.expense_code, 'IMPORTED-CODE');
});

test('new cashout-fee expenses use the same allocator with the cashout month', async () => {
  let parameters;
  const repo = {
    findOne: async () => null,
    manager: { query: async (_sql, args) => { parameters = args; return [{ last_number: '40' }]; } },
    create: (payload) => payload, save: async (payload) => payload,
  };
  const service = new WalletsService({}, {}, {}, repo, {});
  const expense = await service.upsertCashoutFeeExpense({ ref: 'FIXTURE-CASH', bank_reference: 'FIXTURE-BANK',
    fee_aed: 10, cashout_date: november, gross_aed: 110, net_aed: 100, from_wallet: 'BINANCE' });
  assert.deepEqual(parameters, ['expense_code_counter:2611', 'EXP-2611-']);
  assert.equal(expense.expense_code, 'EXP-2611-00040');
});

test('updating an existing cashout fee does not consume another expense number', async () => {
  const repo = {
    findOne: async () => ({ id: 'existing', expense_code: 'EXP-2611-00010' }),
    manager: { query: () => assert.fail('existing fee must not allocate') }, save: async (payload) => payload,
  };
  const expense = await new WalletsService({}, {}, {}, repo, {}).upsertCashoutFeeExpense({
    ref: 'FIXTURE-CASH', bank_reference: 'FIXTURE-BANK', fee_aed: 10, cashout_date: november,
    gross_aed: 110, net_aed: 100, from_wallet: 'BINANCE' });
  assert.equal(expense.expense_code, 'EXP-2611-00010');
});

test('PostgreSQL counter handles gaps, deletion, concurrency, restarts and monthly rollover',
  { skip: !process.env.TEST_PGHOST }, async () => {
    const { Pool } = require('pg');
    const pool = new Pool({ host: process.env.TEST_PGHOST, user: 'postgres', database: 'postgres',
      password: process.env.TEST_PGPASSWORD, max: 8 });
    const manager = { query: async (sql, args) => (await pool.query(sql, args)).rows };
    try {
      await pool.query('CREATE TABLE app_settings (key varchar PRIMARY KEY, value jsonb NOT NULL, updated_at timestamp NOT NULL)');
      await pool.query('CREATE TABLE expenses (expense_code varchar UNIQUE)');
      await pool.query("INSERT INTO expenses VALUES ('EXP-2611-00001'),('EXP-2611-00034'),('EXP-2611-00038'),('EXP-2610-00999')");
      await initializeExpenseCounters(manager);
      await pool.query("DELETE FROM expenses WHERE expense_code='EXP-2611-00038'");
      assert.equal(await nextExpenseCode(manager, november), 'EXP-2611-00039');
      const codes = await Promise.all(Array.from({ length: 24 }, async () => {
        const code = await nextExpenseCode(manager, november);
        await pool.query('INSERT INTO expenses VALUES ($1)', [code]);
        return code;
      }));
      assert.equal(new Set(codes).size, 24);
      assert.deepEqual(codes.slice().sort(), Array.from({ length: 24 }, (_, i) => `EXP-2611-${String(i + 40).padStart(5, '0')}`));
      await pool.query("DELETE FROM expenses WHERE expense_code='EXP-2611-00063'");
      await initializeExpenseCounters(manager);
      assert.equal(await nextExpenseCode(manager, november), 'EXP-2611-00064');
      await pool.query("DELETE FROM expenses WHERE expense_code LIKE 'EXP-2611-%'");
      await initializeExpenseCounters(manager);
      assert.equal(await nextExpenseCode(manager, november), 'EXP-2611-00065');
      assert.equal(await nextExpenseCode(manager, new Date('2026-12-15T12:00:00Z')), 'EXP-2612-00001');
      await pool.query("INSERT INTO expenses VALUES ('EXP-2611-99999')");
      assert.equal(await nextExpenseCode(manager, november), 'EXP-2611-100000');
      await initializeExpenseCounters(manager);
      assert.equal(await nextExpenseCode(manager, november), 'EXP-2611-100001');
    } finally { await pool.end(); }
  });
