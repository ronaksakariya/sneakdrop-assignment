import { Router } from "express";
import { buy } from "../services/dropService.js";
import { getStatus } from "../services/statusService.js";
import { createPayment } from "../services/paymentService.js";

const router = Router();

router.post("/buy", async (req, res) => {
  const userId = req.body?.userId;

  if (typeof userId !== "string" || userId.trim() === "") {
    return res.status(400).json({
      error: "userId is required",
    });
  }

  try {
    const result = await buy(userId.trim());

    if (result.type === "HOLD") {
      return res.status(201).json(result);
    }

    return res.status(200).json(result);
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "USER_ALREADY_HAS_ACTIVE_HOLD") {
        return res.status(409).json({
          error: "You already have an active hold",
        });
      }

      if (error.message === "MAX_PURCHASES_REACHED") {
        return res.status(409).json({
          error: "Maximum purchases reached",
        });
      }
    }

    console.error("Buy failed:", error);

    return res.status(500).json({
      error: "Internal server error",
    });
  }
});

router.get("/status", async (req, res) => {
  const userId = req.query.userId;

  if (typeof userId !== "string" || userId.trim() === "") {
    return res.status(400).json({
      error: "userId is required",
    });
  }

  try {
    const status = await getStatus(userId.trim());

    return res.json(status);
  } catch (error) {
    console.error("Status failed:", error);

    return res.status(500).json({
      error: "Internal server error",
    });
  }
});

router.post("/pay", async (req, res) => {
  const userId = req.body?.userId;
  const scenario =
    typeof req.body?.scenario === "string" ? req.body.scenario : "success";

  if (typeof userId !== "string" || userId.trim() === "") {
    return res.status(400).json({
      error: "userId is required",
    });
  }

  try {
    const result = await createPayment(userId.trim(), scenario);

    return res.status(202).json(result);
  } catch (error) {
    if (error instanceof Error) {
      const messages: Record<string, string> = {
        NO_ACTIVE_HOLD: "No active hold",
        HOLD_EXPIRED: "Hold expired",
        PAYMENT_ALREADY_TERMINAL: "Payment already completed",
        MAX_PAYMENT_ATTEMPTS_REACHED: "Maximum payment attempts reached",
      };

      const message = messages[error.message];

      if (message) {
        return res.status(409).json({
          error: message,
        });
      }
    }

    console.error("Payment failed:", error);

    return res.status(500).json({
      error: "Internal server error",
    });
  }
});

export default router;
