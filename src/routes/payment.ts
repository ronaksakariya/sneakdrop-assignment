import { Router } from "express";
import { fetch } from "undici";
import { config } from "../config.js";
import { acquireAdvisoryLock, withTx } from "../db.js";
import { releaseAndPromote } from "../services/holdService.js";
import { verifyWebhookSignature } from "../services/paymentService.js";

const router = Router();

router.post("/webhooks/payment", async (req, res) => {
  const rawBody = req.body as Buffer;

  const signature = req.header("x-webhook-signature");

  if (
    !Buffer.isBuffer(rawBody) ||
    !verifyWebhookSignature(rawBody, signature)
  ) {
    return res.status(401).json({
      error: "Invalid webhook signature",
    });
  }

  let event: {
    eventId: string;
    paymentId: string;
    type: "payment.succeeded" | "payment.failed";
    attempt: number;
  };

  try {
    event = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return res.status(400).json({
      error: "Invalid webhook JSON",
    });
  }

  let refundPaymentId: string | null = null;

  try {
    await withTx(async (client) => {
      // All webhook paths enter the shared
      // release/waitlist critical section first.
      await acquireAdvisoryLock(client, "waitlist:global");

      const eventResult = await client.query(
        `
              INSERT INTO payment_events (
                provider_event_id,
                payment_id,
                event_type,
                payload
              )
              VALUES ($1, $2, $3, $4)
              ON CONFLICT (
                provider_event_id
              )
              DO NOTHING
              RETURNING id
            `,
        [event.eventId, event.paymentId, event.type, event],
      );

      // Duplicate event.
      if (eventResult.rows.length === 0) {
        return;
      }

      const paymentResult = await client.query(
        `
              SELECT *
              FROM payments
              WHERE id = $1
              FOR UPDATE
            `,
        [event.paymentId],
      );

      if (paymentResult.rows.length === 0) {
        throw new Error("PAYMENT_NOT_FOUND");
      }

      const payment = paymentResult.rows[0];

      // Terminal payment state wins.
      if (
        payment.status === "SUCCEEDED" ||
        payment.status === "REFUNDED" ||
        payment.status === "LATE_REFUNDED"
      ) {
        return;
      }

      if (event.type === "payment.succeeded") {
        const holdResult = await client.query(
          `
                SELECT
                  id,
                  unit_id,
                  status,
                  expires_at,
                  expires_at <= now()
                    AS expired
                FROM holds
                WHERE id = $1
                FOR UPDATE
              `,
          [payment.hold_id],
        );

        if (holdResult.rows.length === 0) {
          throw new Error("HOLD_NOT_FOUND");
        }

        const hold = holdResult.rows[0];

        if (hold.status !== "ACTIVE" || hold.expired) {
          if (hold.status === "ACTIVE") {
            await releaseAndPromote(client, String(hold.id), "EXPIRED");
          }

          await client.query(
            `
                UPDATE payments
                SET status =
                      'LATE_REFUNDED',
                    updated_at = now()
                WHERE id = $1
              `,
            [payment.id],
          );

          refundPaymentId = String(payment.id);

          return;
        }

        await client.query(
          `
              UPDATE holds
              SET status = 'PAID',
                  updated_at = now()
              WHERE id = $1
            `,
          [hold.id],
        );

        await client.query(
          `
              UPDATE units
              SET status = 'SOLD'
              WHERE id = $1
            `,
          [hold.unit_id],
        );

        await client.query(
          `
              UPDATE payments
              SET status = 'SUCCEEDED',
                  updated_at = now()
              WHERE id = $1
            `,
          [payment.id],
        );

        return;
      }

      // Failed webhook.
      const holdResult = await client.query(
        `
              SELECT
                id,
                unit_id,
                status,
                expires_at,
                expires_at <= now()
                  AS expired
              FROM holds
              WHERE id = $1
              FOR UPDATE
            `,
        [payment.hold_id],
      );

      if (holdResult.rows.length === 0) {
        throw new Error("HOLD_NOT_FOUND");
      }

      const hold = holdResult.rows[0];

      await client.query(
        `
            UPDATE payments
            SET status = 'FAILED',
                updated_at = now()
            WHERE id = $1
          `,
        [payment.id],
      );

      if (hold.status === "ACTIVE" && hold.expired) {
        await releaseAndPromote(client, String(hold.id), "EXPIRED");

        return;
      }

      if (
        hold.status === "ACTIVE" &&
        payment.attempts >= config.maxPaymentAttempts
      ) {
        await releaseAndPromote(client, String(hold.id), "RELEASED");
      }
    });

    if (refundPaymentId) {
      try {
        await fetch(`${config.mockProviderUrl}/refunds`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            paymentId: refundPaymentId,
            reason: "late_payment",
          }),
        });
      } catch (error) {
        console.error("Refund request failed:", error);
      }
    }

    return res.status(200).json({
      received: true,
    });
  } catch (error) {
    console.error("Webhook processing failed:", error);

    return res.status(500).json({
      error: "Webhook processing failed",
    });
  }
});

export default router;
