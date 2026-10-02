import express from "express";
import dropRouter from "./routes/drop.js";
import paymentRouter from "./routes/payment.js";
import adminRouter from "./routes/admin.js";

export const app = express();

app.use(
  "/api/webhooks/payment",
  express.raw({
    type: "application/json",
  }),
);

app.use(express.json());

app.use(express.static("public"));

app.get("/health", async (_req, res) => {
  res.json({
    status: "ok",
  });
});

app.use("/api", dropRouter);
app.use("/api", paymentRouter);
app.use("/admin", adminRouter);
