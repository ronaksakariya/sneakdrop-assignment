import { Router } from "express";
import { config } from "../config.js";
import { getInvariants, resetDatabase } from "../services/adminService.js";

const router = Router();

function ensureDev(res: Parameters<Parameters<Router["get"]>[1]>[1]) {
  if (config.nodeEnv === "production") {
    res.status(404).end();
    return false;
  }

  return true;
}

router.get("/invariants", async (_req, res) => {
  if (!ensureDev(res)) {
    return;
  }

  try {
    const result = await getInvariants();

    return res.json(result);
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      error: "Could not calculate invariants",
    });
  }
});

router.post("/reset", async (_req, res) => {
  if (!ensureDev(res)) {
    return;
  }

  try {
    await resetDatabase();

    return res.json({
      reset: true,
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      error: "Could not reset database",
    });
  }
});

export default router;
