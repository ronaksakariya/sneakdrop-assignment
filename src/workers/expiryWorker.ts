import { acquireAdvisoryLock, withTx } from "../db.js";
import { releaseAndPromote } from "../services/holdService.js";

const BATCH_SIZE = 50;

async function processExpiredHolds() {
  try {
    await withTx(async (client) => {
      await acquireAdvisoryLock(client, "waitlist:global");

      const result = await client.query(
        `
            SELECT id
            FROM holds
            WHERE status = 'ACTIVE'
              AND expires_at <= now()
            ORDER BY expires_at ASC, id ASC
            FOR UPDATE SKIP LOCKED
            LIMIT $1
          `,
        [BATCH_SIZE],
      );

      for (const row of result.rows) {
        await releaseAndPromote(client, String(row.id), "EXPIRED");
      }
    });
  } catch (error) {
    console.error("Expiry worker failed:", error);
  }
}

export function startExpiryWorker() {
  void processExpiredHolds();

  return setInterval(() => {
    void processExpiredHolds();
  }, 1000);
}
