const test = require('node:test');
const assert = require('node:assert/strict');
require('reflect-metadata');
const { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } = require('@nestjs/common/constants');
const { RequestMethod } = require('@nestjs/common');
const { JwtStrategy } = require('../dist/auth/jwt.strategy');
const { AdminGuard } = require('../dist/auth/admin.guard');
const { AuthController } = require('../dist/auth/auth.controller');
const { BackupsModule } = require('../dist/backups/backups.module');
const { BackupStatusController, BackupTwoFactorGuard } = require('../dist/backups/backup-status.controller');
const { SeedService } = require('../dist/seed/seed.service');
const { KycService } = require('../dist/kyc/kyc.service');

const id = '11111111-1111-4111-8111-111111111111';
const session = { sub: id, role: 'admin', two_fa: true };
const user = { id, email: 'staff@example.invalid', role: 'admin', two_fa_enabled: true };
const context = (value) => ({ switchToHttp: () => ({ getRequest: () => ({ user: value }) }) });
const strategy = (findOne) => new JwtStrategy({ getOrThrow: () => 'test-only-signing-key-not-a-production-secret' }, { findOne });

test('only the restricted backup controller is registered', () => {
  assert.deepEqual(Reflect.getMetadata('controllers', BackupsModule), [BackupStatusController]);
  assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, BackupStatusController).map((guard) => guard.name),
    ['JwtAuthGuard', 'AdminGuard', 'BackupTwoFactorGuard']);
  const routes = Object.getOwnPropertyNames(BackupStatusController.prototype)
    .filter((name) => Reflect.hasMetadata(METHOD_METADATA, BackupStatusController.prototype[name]))
    .map((name) => [Reflect.getMetadata(METHOD_METADATA, BackupStatusController.prototype[name]),
      Reflect.getMetadata(PATH_METADATA, BackupStatusController.prototype[name])]);
  assert.deepEqual(routes, [[RequestMethod.GET, '/'], [RequestMethod.GET, 'drive/status'], [RequestMethod.POST, '/']]);
});

test('backup and admin guards fail closed', () => {
  for (const value of [undefined, {}, { verified_2fa: false }, { verified_2fa: 'true' }]) {
    assert.throws(() => new BackupTwoFactorGuard().canActivate(context(value)), { status: 403 });
  }
  assert.equal(new BackupTwoFactorGuard().canActivate(context({ verified_2fa: true })), true);
  for (const value of [undefined, {}, { role: 'auditor' }, { role: 'chartered_accountant' }]) {
    assert.throws(() => new AdminGuard().canActivate(context(value)), { status: 403 });
  }
  assert.equal(new AdminGuard().canActivate(context({ role: 'admin' })), true);
});

test('staff-management endpoints require the admin guard', () => {
  for (const name of ['listAdmins', 'createAdmin']) {
    assert.ok(Reflect.getMetadata(GUARDS_METADATA, AuthController.prototype[name]).includes(AdminGuard));
  }
});

test('challenge tokens and invalid subjects cannot become API sessions', async () => {
  const auth = strategy(async () => assert.fail('invalid token must not reach the repository'));
  for (const payload of [undefined, {}, { ...session, purpose: '2fa' }, { ...session, purpose: null },
    { ...session, sub: 'not-a-uuid' }]) {
    await assert.rejects(auth.validate(payload), { status: 401 });
  }
});

test('JWT validation checks active users, current roles and completed 2FA', async () => {
  let query;
  const auth = strategy(async (options) => { query = options; return user; });
  assert.deepEqual(await auth.validate(session), { id, email: user.email, role: 'admin', verified_2fa: true });
  assert.deepEqual(query.where, { id, is_active: true });
  await assert.rejects(auth.validate({ ...session, role: 'auditor' }), { status: 401 });
  await assert.rejects(auth.validate({ ...session, two_fa: false }), { status: 401 });
  await assert.rejects(strategy(async () => null).validate(session), { status: 401 });
  const no2fa = await strategy(async () => ({ ...user, two_fa_enabled: false })).validate(session);
  assert.equal(no2fa.verified_2fa, false);
});

test('backup responses omit Drive credentials and downloads', () => {
  const controller = new BackupStatusController({
    list: () => [{ name: 'probe.sql.gz' }, { name: 'axistra-safety-2026-11-14_17-00-00.sql.gz' },
      { name: 'axistra-manual-2026-11-25_12-00-00-abcd1234.sql.gz' }],
    driveStatus: () => ({ configured: true, mode: 'oauth', verified: true, refresh_token: 'fixture', folder_id: 'fixture' }),
  });
  assert.equal(controller.list().length, 1);
  assert.deepEqual(controller.driveStatus(), { configured: true, mode: 'oauth', verified: true });
});

test('manual backups reject concurrent requests and enforce cooldown', async () => {
  let finish;
  let options;
  const controller = new BackupStatusController({ createBackup: (opts) => {
    options = opts;
    return new Promise((resolve) => { finish = resolve; });
  } });
  const pending = controller.create({ upload_to_drive: true }, { user });
  await assert.rejects(controller.create({}, { user }), { status: 429 });
  finish({ name: 'fixture.sql.gz', drive: { id: 'fixture', refresh_token: 'fixture' } });
  assert.deepEqual(await pending, { name: 'fixture.sql.gz', mirrored_to_drive: true });
  assert.equal(options.uploadToDrive, true);
  await assert.rejects(controller.create({}, { user }), { status: 429 });
});

test('staff seeding never resets existing credentials', async () => {
  const service = new SeedService({ count: async () => 1,
    save: async () => assert.fail('existing users must not be saved'),
    findOne: async () => assert.fail('existing passwords must not be compared or repaired') }, {});
  await service.seedAdmin();
  assert.equal(service.seedCharteredAccountant, undefined);
});

test('empty-table bootstrap rejects missing and weak passwords', async () => {
  const previous = process.env.SEED_ADMIN_PASSWORD;
  try {
    const service = new SeedService({ count: async () => 0,
      create: () => assert.fail('weak bootstrap password must not create a user') }, {});
    service.logger = { warn: () => {} };
    for (const value of ['', 'weak', 'x'.repeat(73)]) {
      process.env.SEED_ADMIN_PASSWORD = value;
      await service.seedAdmin();
    }
  } finally {
    if (previous === undefined) delete process.env.SEED_ADMIN_PASSWORD;
    else process.env.SEED_ADMIN_PASSWORD = previous;
  }
});

test('KYC downloads reject traversal and invalid identifiers', async () => {
  const service = new KycService();
  for (const [customer, filename] of [['..', 'passwd'], [id, '../passwd'], [id, '/etc/passwd'],
    [id, '..\\passwd'], ['not-a-uuid', 'identity.pdf']]) {
    await assert.rejects(service.download(customer, filename), { status: 404 });
  }
});
