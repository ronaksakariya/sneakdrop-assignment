import crypto from "node:crypto";
import { fetch } from "undici";
import { config } from "../config.js";
import { acquireAdvisoryLock, withTx } from "../db.js";
import { releaseAndPromote } from "./holdService.js";

type PaymentTransactionResult = {
  paymentId: string;
  holdId: string;
  attempt: number;
  shouldCallProvider: boolean;
};

export async function createPayment(userId: string, scenario: string) {
  const payment = await withTx<PaymentTransactionResult>(async (client) => {
    await acquireAdvisoryLock(client, `user:${userId}`);

    // Payment operations also enter the
    // waitlist critical section before they
    // can trigger a release.
    await acquireAdvisoryLock(client, "waitlist:global");

    const holdResult = await client.query(
      `
              SELECT
                id,
                unit_id,
                status,
                expires_at,
                expires_at <= now() AS expired
              FROM holds
              WHERE user_id = $1
                AND status = 'ACTIVE'
              LIMIT 1
              FOR UPDATE
            `,
      [userId],
    );

    if (holdResult.rows.length === 0) {
      throw new Error("NO_ACTIVE_HOLD");
    }

    const hold = holdResult.rows[0];

    if (hold.expired) {
      await releaseAndPromote(client, String(hold.id), "EXPIRED");

      throw new Error("HOLD_EXPIRED");
    }

    const existingResult = await client.query(
      `
              SELECT
                id,
                status,
                attempts
              FROM payments
              WHERE hold_id = $1
              FOR UPDATE
            `,
      [hold.id],
    );

    if (existingResult.rows.length === 0) {
      const result = await client.query(
        `
                INSERT INTO payments (
                  hold_id,
                  user_id,
                  status,
                  attempts
                )
                VALUES (
                  $1,
                  $2,
                  'PENDING',
                  1
                )
                RETURNING id, attempts
              `,
        [hold.id, userId],
      );

      return {
        paymentId: String(result.rows[0].id),
        holdId: String(hold.id),
        attempt: result.rows[0].attempts,
        shouldCallProvider: true,
      };
    }

    const payment = existingResult.rows[0];

    if (payment.status === "PENDING") {
      return {
        paymentId: String(payment.id),
        holdId: String(hold.id),
        attempt: payment.attempts,
        shouldCallProvider: false,
      };
    }

    if (
      payment.status === "SUCCEEDED" ||
      payment.status === "REFUNDED" ||
      payment.status === "LATE_REFUNDED"
    ) {
      throw new Error("PAYMENT_ALREADY_TERMINAL");
    }

    if (payment.attempts >= config.maxPaymentAttempts) {
      throw new Error("MAX_PAYMENT_ATTEMPTS_REACHED");
    }

    const result = await client.query(
      `
              UPDATE payments
              SET status = 'PENDING',
                  attempts = attempts + 1,
                  updated_at = now()
              WHERE id = $1
              RETURNING id, attempts
            `,
      [payment.id],
    );

    return {
      paymentId: String(result.rows[0].id),
      holdId: String(hold.id),
      attempt: result.rows[0].attempts,
      shouldCallProvider: true,
    };
  });

  if (payment.shouldCallProvider) {
    try {
      await fetch(`${config.mockProviderUrl}/charges`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          paymentId: payment.paymentId,
          holdId: payment.holdId,
          attempt: payment.attempt,
          scenario,
          webhookUrl: config.paymentWebhookUrl,
        }),
      });
    } catch (error) {
      console.error("Mock payment request failed:", error);
    }
  }

  return {
    paymentId: payment.paymentId,
    status: "PENDING",
  };
}

export function verifyWebhookSignature(
  rawBody: Buffer,
  signature: string | undefined,
): boolean {
  if (!signature) {
    return false;
  }

  const expected = crypto
    .createHmac("sha256", config.webhookSecret)
    .update(rawBody)
    .digest("hex");

  const received = Buffer.from(signature, "utf8");

  const expectedBuffer = Buffer.from(expected, "utf8");

  if (received.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(received, expectedBuffer);
}
