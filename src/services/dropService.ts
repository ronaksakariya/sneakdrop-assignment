import type { PoolClient } from "pg";
import { config } from "../config.js";
import { acquireAdvisoryLock, withTx } from "../db.js";
import { releaseAndPromote } from "./holdService.js";

type BuyResult =
  | {
      type: "HOLD";
      holdId: string;
      unitId: number;
      expiresAt: string;
    }
  | {
      type: "WAITLISTED";
      waitlistId: string;
      position: number;
    };

export async function buy(userId: string): Promise<BuyResult> {
  return withTx(async (client) => {
    await acquireAdvisoryLock(client, `user:${userId}`);

    const activeHoldResult = await client.query(
      `
        SELECT
          id,
          expires_at <= now() AS expired
        FROM holds
        WHERE user_id = $1
          AND status = 'ACTIVE'
        LIMIT 1
      `,
      [userId],
    );

    if (activeHoldResult.rows.length > 0) {
      const hold = activeHoldResult.rows[0];

      if (hold.expired) {
        await acquireAdvisoryLock(client, "waitlist:global");

        await releaseAndPromote(client, String(hold.id), "EXPIRED");
      } else {
        throw new Error("USER_ALREADY_HAS_ACTIVE_HOLD");
      }
    }

    const purchaseCount = await client.query(
      `
        SELECT COUNT(*)::int AS count
        FROM holds
        WHERE user_id = $1
          AND status = 'PAID'
      `,
      [userId],
    );

    if (purchaseCount.rows[0].count >= config.maxPerUser) {
      throw new Error("MAX_PURCHASES_REACHED");
    }

    let unitResult = await claimAvailableUnit(client);

    if (unitResult.rows.length === 0) {
      await acquireAdvisoryLock(client, "waitlist:global");

      // Lost-wakeup protection:
      // retry after taking the shared lock.
      unitResult = await claimAvailableUnit(client);
    }

    if (unitResult.rows.length > 0) {
      const unitId = unitResult.rows[0].id;

      const holdResult = await client.query(
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
          RETURNING id, unit_id, expires_at
        `,
        [userId, unitId, config.holdTtlSeconds],
      );

      return {
        type: "HOLD",
        holdId: String(holdResult.rows[0].id),
        unitId: holdResult.rows[0].unit_id,
        expiresAt: holdResult.rows[0].expires_at.toISOString(),
      };
    }

    // We already own waitlist:global here.
    const existingWaitlist = await client.query(
      `
        SELECT id
        FROM waitlist
        WHERE user_id = $1
          AND status = 'WAITING'
        LIMIT 1
      `,
      [userId],
    );

    if (existingWaitlist.rows.length > 0) {
      const position = await getWaitlistPosition(
        client,
        String(existingWaitlist.rows[0].id),
      );

      return {
        type: "WAITLISTED",
        waitlistId: String(existingWaitlist.rows[0].id),
        position,
      };
    }

    const waitlistResult = await client.query(
      `
        INSERT INTO waitlist (user_id)
        VALUES ($1)
        RETURNING id
      `,
      [userId],
    );

    const position = await getWaitlistPosition(
      client,
      String(waitlistResult.rows[0].id),
    );

    return {
      type: "WAITLISTED",
      waitlistId: String(waitlistResult.rows[0].id),
      position,
    };
  });
}

async function claimAvailableUnit(client: PoolClient) {
  const result = await client.query(
    `
      SELECT id
      FROM units
      WHERE status = 'AVAILABLE'
      ORDER BY id
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `,
  );

  if (result.rows.length === 0) {
    return result;
  }

  await client.query(
    `
      UPDATE units
      SET status = 'HELD'
      WHERE id = $1
    `,
    [result.rows[0].id],
  );

  return result;
}

async function getWaitlistPosition(
  client: PoolClient,
  waitlistId: string,
): Promise<number> {
  const result = await client.query(
    `
      SELECT COUNT(*)::int + 1 AS position
      FROM waitlist w
      JOIN waitlist target
        ON target.id = $1
      WHERE w.status = 'WAITING'
        AND (
          w.created_at < target.created_at
          OR (
            w.created_at = target.created_at
            AND w.id < target.id
          )
        )
    `,
    [waitlistId],
  );

  return result.rows[0].position;
}
