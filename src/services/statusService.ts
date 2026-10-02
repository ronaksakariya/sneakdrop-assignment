import { withTx, acquireAdvisoryLock } from "../db.js";
import { releaseAndPromote } from "./holdService.js";

export async function getStatus(userId: string) {
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
      }
    }

    const unitsResult = await client.query(
      `
        SELECT COUNT(*)::int AS count
        FROM units
        WHERE status = 'AVAILABLE'
      `,
    );

    const holdResult = await client.query(
      `
        SELECT
          id,
          unit_id,
          expires_at,
          GREATEST(
            FLOOR(
              EXTRACT(
                EPOCH FROM (
                  expires_at - now()
                )
              )
            ),
            0
          )::int AS seconds_remaining
        FROM holds
        WHERE user_id = $1
          AND status = 'ACTIVE'
          AND expires_at > now()
        LIMIT 1
      `,
      [userId],
    );

    const waitlistResult = await client.query(
      `
          SELECT
            target.id,
            (
              SELECT COUNT(*)::int + 1
              FROM waitlist w
              WHERE w.status = 'WAITING'
                AND (
                  w.created_at <
                    target.created_at
                  OR (
                    w.created_at =
                      target.created_at
                    AND w.id < target.id
                  )
                )
            ) AS position
          FROM waitlist target
          WHERE target.user_id = $1
            AND target.status = 'WAITING'
          LIMIT 1
        `,
      [userId],
    );

    const purchaseResult = await client.query(
      `
          SELECT COUNT(*)::int AS count
          FROM holds
          WHERE user_id = $1
            AND status = 'PAID'
        `,
      [userId],
    );

    return {
      unitsLeft: unitsResult.rows[0].count,

      hold:
        holdResult.rows.length > 0
          ? {
              holdId: String(holdResult.rows[0].id),
              unitId: holdResult.rows[0].unit_id,
              secondsRemaining: holdResult.rows[0].seconds_remaining,
              expiresAt: holdResult.rows[0].expires_at.toISOString(),
            }
          : null,

      waitlistPosition:
        waitlistResult.rows.length > 0 ? waitlistResult.rows[0].position : null,

      purchaseCount: purchaseResult.rows[0].count,
    };
  });
}
