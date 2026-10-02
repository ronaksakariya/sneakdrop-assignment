import { config } from "../config.js";
import { acquireAdvisoryLock, withTx } from "../db.js";

export async function resetDatabase() {
  return withTx(async (client) => {
    await acquireAdvisoryLock(client, "waitlist:global");

    await client.query(`
      TRUNCATE
        payment_events,
        payments,
        holds,
        waitlist,
        units
      RESTART IDENTITY CASCADE
    `);

    await client.query(
      `
        INSERT INTO units (status)
        SELECT 'AVAILABLE'
        FROM generate_series(1, $1)
      `,
      [config.totalUnits],
    );
  });
}

export async function getInvariants() {
  return withTx(async (client) => {
    const violations: string[] = [];

    const unitsResult = await client.query(
      `
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (
            WHERE status = 'AVAILABLE'
          )::int AS available,
          COUNT(*) FILTER (
            WHERE status = 'HELD'
          )::int AS held,
          COUNT(*) FILTER (
            WHERE status = 'SOLD'
          )::int AS sold
        FROM units
      `,
    );

    const units = unitsResult.rows[0];

    if (units.total !== config.totalUnits) {
      violations.push(
        `Expected ${config.totalUnits} units, got ${units.total}`,
      );
    }

    if (units.available + units.held + units.sold !== units.total) {
      violations.push("Unit state counts do not add up");
    }

    const activeHoldResult = await client.query(`
        SELECT COUNT(*)::int AS count
        FROM holds
        WHERE status = 'ACTIVE'
      `);

    const paidHoldResult = await client.query(`
        SELECT COUNT(*)::int AS count
        FROM holds
        WHERE status = 'PAID'
      `);

    const duplicateUserResult = await client.query(`
        SELECT user_id
        FROM holds
        WHERE status = 'ACTIVE'
        GROUP BY user_id
        HAVING COUNT(*) > 1
      `);

    const duplicateUnitResult = await client.query(`
        SELECT unit_id
        FROM holds
        WHERE status = 'ACTIVE'
        GROUP BY unit_id
        HAVING COUNT(*) > 1
      `);

    const activeWrongUnitResult = await client.query(`
        SELECT h.id
        FROM holds h
        JOIN units u
          ON u.id = h.unit_id
        WHERE h.status = 'ACTIVE'
          AND u.status <> 'HELD'
      `);

    const paidWrongUnitResult = await client.query(`
        SELECT h.id
        FROM holds h
        JOIN units u
          ON u.id = h.unit_id
        WHERE h.status = 'PAID'
          AND u.status <> 'SOLD'
      `);

    const soldWithoutPaidResult = await client.query(`
        SELECT u.id
        FROM units u
        WHERE u.status = 'SOLD'
          AND NOT EXISTS (
            SELECT 1
            FROM holds h
            WHERE h.unit_id = u.id
              AND h.status = 'PAID'
          )
      `);

    const duplicateWaitlistResult = await client.query(`
        SELECT user_id
        FROM waitlist
        WHERE status = 'WAITING'
        GROUP BY user_id
        HAVING COUNT(*) > 1
      `);

    const pendingDuplicateResult = await client.query(`
        SELECT hold_id
        FROM payments
        WHERE status = 'PENDING'
        GROUP BY hold_id
        HAVING COUNT(*) > 1
      `);

    if (activeHoldResult.rows[0].count !== units.held) {
      violations.push("ACTIVE holds do not match HELD units");
    }

    if (paidHoldResult.rows[0].count !== units.sold) {
      violations.push("PAID holds do not match SOLD units");
    }

    if (duplicateUserResult.rows.length) {
      violations.push("A user has more than one active hold");
    }

    if (duplicateUnitResult.rows.length) {
      violations.push("A unit has more than one active hold");
    }

    if (activeWrongUnitResult.rows.length) {
      violations.push("An active hold points to a non-HELD unit");
    }

    if (paidWrongUnitResult.rows.length) {
      violations.push("A paid hold points to a non-SOLD unit");
    }

    if (soldWithoutPaidResult.rows.length) {
      violations.push("A SOLD unit has no PAID hold");
    }

    if (duplicateWaitlistResult.rows.length) {
      violations.push("A user appears twice in WAITING");
    }

    if (pendingDuplicateResult.rows.length) {
      violations.push("A hold has multiple pending payments");
    }

    return {
      ok: violations.length === 0,
      violations,
      metrics: {
        totalUnits: units.total,
        availableUnits: units.available,
        heldUnits: units.held,
        soldUnits: units.sold,
        activeHolds: activeHoldResult.rows[0].count,
        paidHolds: paidHoldResult.rows[0].count,
      },
    };
  });
}
