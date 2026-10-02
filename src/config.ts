import "dotenv/config";

function getEnv(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;

  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function getNumberEnv(name: string, fallback: number): number {
  const value = process.env[name];

  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Environment variable ${name} must be a positive number`);
  }

  return parsed;
}

export const config = {
  port: getNumberEnv("PORT", 3000),

  databaseUrl: getEnv(
    "DATABASE_URL",
    "postgresql://ronak:ronak_password@localhost:5432/sneaker_drop",
  ),

  totalUnits: getNumberEnv("TOTAL_UNITS", 20),

  holdTtlSeconds: getNumberEnv("HOLD_TTL_SECONDS", 300),

  maxPerUser: getNumberEnv("MAX_PER_USER", 2),

  maxPaymentAttempts: getNumberEnv("MAX_PAYMENT_ATTEMPTS", 3),

  webhookSecret: getEnv("WEBHOOK_SECRET", "development-secret"),

  nodeEnv: getEnv("NODE_ENV", "development"),

  mockProviderUrl: getEnv("MOCK_PROVIDER_URL", "http://localhost:4000"),

  paymentWebhookUrl: getEnv(
    "PAYMENT_WEBHOOK_URL",
    "http://localhost:3000/api/webhooks/payment",
  ),
};
