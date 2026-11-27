import type { EntityManager } from 'typeorm';

export async function initializeExpenseCounters(manager: EntityManager): Promise<void> {
  await manager.query(`
    INSERT INTO app_settings (key, value, updated_at)
    SELECT 'expense_code_counter:' || stamp,
      jsonb_build_object('last_number', MAX(number)), NOW()
    FROM (
      SELECT substring(expense_code FROM '^EXP-([0-9]{4})-[0-9]+$') AS stamp,
        substring(expense_code FROM '^EXP-[0-9]{4}-([0-9]+)$')::bigint AS number
      FROM expenses WHERE expense_code ~ '^EXP-[0-9]{4}-[0-9]+$'
    ) numbered
    GROUP BY stamp
    ORDER BY stamp
    ON CONFLICT (key) DO UPDATE SET
      value = jsonb_build_object('last_number', GREATEST(
        (app_settings.value->>'last_number')::bigint,
        (EXCLUDED.value->>'last_number')::bigint
      )), updated_at = NOW()
  `);
}

export async function nextExpenseCode(manager: EntityManager, date = new Date()): Promise<string> {
  if (Number.isNaN(date.getTime())) throw new RangeError('Invalid expense code date');
  const stamp = `${String(date.getFullYear()).slice(-2)}${String(date.getMonth() + 1).padStart(2, '0')}`;
  const prefix = `EXP-${stamp}-`;

  // The persisted high-water mark survives deletions; the upsert serializes reservations.
  const rows = await manager.query(`
    WITH maximum AS (
      SELECT COALESCE(MAX(substring(expense_code FROM '^EXP-[0-9]{4}-([0-9]+)$')::bigint), 0) AS number
      FROM expenses
      WHERE expense_code LIKE $2 || '%' AND expense_code ~ '^EXP-[0-9]{4}-[0-9]+$'
    )
    INSERT INTO app_settings (key, value, updated_at)
    SELECT $1, jsonb_build_object('last_number', number + 1), NOW() FROM maximum WHERE true
    ON CONFLICT (key) DO UPDATE SET
      value = jsonb_build_object('last_number', GREATEST(
        COALESCE((app_settings.value->>'last_number')::bigint, 0),
        (SELECT number FROM maximum)
      ) + 1), updated_at = NOW()
    RETURNING value->>'last_number' AS last_number
  `, [`expense_code_counter:${stamp}`, prefix]);

  return `${prefix}${String(rows[0].last_number).padStart(5, '0')}`;
}
