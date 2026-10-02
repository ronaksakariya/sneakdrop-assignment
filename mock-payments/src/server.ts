import crypto from "node:crypto";
import express from "express";

const app = express();

app.use(express.json());

const PORT = Number(process.env.MOCK_PORT ?? 4000);

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET ?? "development-secret";

const LATE_DELAY_MS = Number(process.env.LATE_DELAY_MS ?? 310_000);

type Scenario =
  | "success"
  | "fail"
  | "duplicate"
  | "out_of_order"
  | "late"
  | "random";

function sign(body: string) {
  return crypto.createHmac("sha256", WEBHOOK_SECRET).update(body).digest("hex");
}

async function sendWebhook(
  webhookUrl: string,
  event: {
    eventId: string;
    paymentId: string;
    type: "payment.succeeded" | "payment.failed";
    attempt: number;
  },
) {
  const body = JSON.stringify(event);

  await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-webhook-signature": sign(body),
    },
    body,
  });
}

app.post("/charges", async (req, res) => {
  const { paymentId, attempt, scenario, webhookUrl } = req.body as {
    paymentId: string;
    attempt: number;
    scenario: Scenario;
    webhookUrl: string;
  };

  const selected =
    scenario === "random"
      ? (
          ["success", "fail", "duplicate", "out_of_order", "late"] as Scenario[]
        )[Math.floor(Math.random() * 5)]
      : scenario;

  res.status(202).json({
    accepted: true,
    paymentId,
    scenario: selected,
  });

  const successEvent = {
    eventId: crypto.randomUUID(),
    paymentId,
    type: "payment.succeeded" as const,
    attempt,
  };

  const failureEvent = {
    eventId: crypto.randomUUID(),
    paymentId,
    type: "payment.failed" as const,
    attempt,
  };

  if (selected === "success") {
    setTimeout(() => void sendWebhook(webhookUrl, successEvent), 500);
    return;
  }

  if (selected === "fail") {
    setTimeout(() => void sendWebhook(webhookUrl, failureEvent), 500);
    return;
  }

  if (selected === "duplicate") {
    setTimeout(async () => {
      await sendWebhook(webhookUrl, successEvent);

      await sendWebhook(webhookUrl, successEvent);
    }, 500);

    return;
  }

  if (selected === "out_of_order") {
    setTimeout(async () => {
      await sendWebhook(webhookUrl, successEvent);

      await sendWebhook(webhookUrl, failureEvent);
    }, 500);

    return;
  }

  if (selected === "late") {
    setTimeout(() => void sendWebhook(webhookUrl, successEvent), LATE_DELAY_MS);
  }
});

app.post("/refunds", async (req, res) => {
  console.log("REFUND:", JSON.stringify(req.body));

  return res.json({
    status: "REFUNDED",
    paymentId: req.body.paymentId,
  });
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.listen(PORT, () => {
  console.log(`Mock payments running on port ${PORT}`);
});
