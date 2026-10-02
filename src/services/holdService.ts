import type { PoolClient } from "pg";
import { config } from "../config.js";

type ReleaseStatus = "EXPIRED" | "RELEASED";

export async function releaseAndPromote(
  client: PoolClient,
  holdId: string,
  newStatus: ReleaseStatus,
) {
  // The caller must already hold waitlist:global.
  // Row-lock order:
  // hold -> unit -> waitlist

  const holdResult = await client.query(
    `
      SELECT id, user_id, unit_id, status
      FROM holds
      WHERE id = $1
      FOR UPDATE
    `,
    [holdId],
  );

  if (holdResult.rows.length === 0) {
    return {
      released: false,
      reason: "HOLD_NOT_FOUND",
    };
  }

  const hold = holdResult.rows[0];

  if (hold.status !== "ACTIVE") {
    return {
      released: false,
      reason: "HOLD_ALREADY_HANDLED",
    };
  }

  const unitResult = await client.query(
    `
      SELECT id, status
      FROM units
      WHERE id = $1
      FOR UPDATE
    `,
    [hold.unit_id],
  );

  if (unitResult.rows.length === 0) {
    throw new Error("UNIT_NOT_FOUND");
  }

  await client.query(
    `
      UPDATE holds
      SET status = $2,
          updated_at = now()
      WHERE id = $1
    `,
    [holdId, newStatus],
  );

  const waitlistResult = await client.query(
    `
      SELECT id, user_id
      FROM waitlist
      WHERE status = 'WAITING'
      ORDER BY created_at ASC, id ASC
      FOR UPDATE
      LIMIT 1
    `,
  );

  if (waitlistResult.rows.length === 0) {
    await client.query(
      `
        UPDATE units
        SET status = 'AVAILABLE'
        WHERE id = $1
      `,
      [hold.unit_id],
    );

    return {
      released: true,
      promoted: false,
    };
  }

  const waiter = waitlistResult.rows[0];

  await client.query(
    `
      UPDATE waitlist
      SET status = 'PROMOTED'
      WHERE id = $1
    `,
    [waiter.id],
  );

  const newHoldResult = await client.query(
    `
      INSERT INTO holds (
        user_id,
        unit_id,
        status,
        expires_at
      )
      VALUES (
        $1,
        $2,
        'ACTIVE',
        now() + ($3 * interval '1 second')
      )
      RETURNING id, user_id, unit_id, expires_at
    `,
    [waiter.user_id, hold.unit_id, config.holdTtlSeconds],
  );

  return {
    released: true,
    promoted: true,
    userId: newHoldResult.rows[0].user_id,
    holdId: String(newHoldResult.rows[0].id),
    unitId: newHoldResult.rows[0].unit_id,
    expiresAt: newHoldResult.rows[0].expires_at.toISOString(),
  };
}
