import { Pool } from "pg";

const API = "http://localhost:3000";

const pool = new Pool({
  connectionString:
    "postgresql://ronak:ronak_password@localhost:5432/sneaker_drop",
});

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }

  console.log(`PASS: ${message}`);
}

async function api(path: string, options: RequestInit = {}) {
  const response = await fetch(`${API}${path}`, options);

  const body = await response.json();

  return {
    status: response.status,
    body,
  };
}

async function reset() {
  const result = await api("/admin/reset", {
    method: "POST",
  });

  assert(result.status === 200 && result.body.reset === true, "database reset");
}

async function invariants() {
  const result = await api("/admin/invariants");

  assert(result.status === 200, "invariants endpoint responds");

  assert(
    result.body.ok === true,
    `invariants clean: ${
      result.body.violations?.join(", ") ?? "no violations"
    }`,
  );

  return result.body;
}

async function buy(userId: string) {
  return api("/api/buy", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      userId,
    }),
  });
}

async function pay(userId: string, scenario: string) {
  return api("/api/pay", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      userId,
      scenario,
    }),
  });
}

async function status(userId: string) {
  return api(`/api/status?userId=${encodeURIComponent(userId)}`);
}

async function db<T = any>(sql: string, params: unknown[] = []) {
  const result = await pool.query<T>(sql, params);

  return result.rows;
}

async function testBasicBuy() {
  console.log("\n--- BASIC BUY ---");

  await reset();

  const first = await buy("basic-user");

  assert(first.status === 201, "first buy creates hold");

  const second = await buy("basic-user");

  assert(second.status === 409, "same user cannot create second active hold");

  await invariants();
}

async function testExpiryPromotion() {
  console.log("\n--- EXPIRY + WAITLIST ---");

  await reset();

  for (let i = 1; i <= 20; i++) {
    const result = await buy(`stock-user-${i}`);

    assert(result.body.type === "HOLD", `stock user ${i} gets hold`);
  }

  const waiting = await buy("waiting-user");

  assert(waiting.body.type === "WAITLISTED", "21st user enters waitlist");

  await sleep(32_000);

  const promoted = await status("waiting-user");

  assert(
    promoted.body.hold !== null,
    "first waitlisted user is promoted after expiry",
  );

  assert(
    promoted.body.waitlistPosition === null,
    "promoted user leaves waitlist",
  );

  await invariants();
}

async function completePurchase(userId: string) {
  const bought = await buy(userId);

  assert(bought.body.type === "HOLD", `${userId} receives hold`);

  const payment = await pay(userId, "success");

  assert(payment.status === 202, `${userId} payment accepted`);

  await sleep(1500);
}

async function testMaxPurchases() {
  console.log("\n--- MAX 2 PURCHASES ---");

  await reset();

  await completePurchase("max-user");

  await completePurchase("max-user");

  const third = await buy("max-user");

  assert(third.status === 409, "third purchase is rejected");

  await invariants();
}

async function testDuplicateWebhook() {
  console.log("\n--- DUPLICATE WEBHOOK ---");

  await reset();

  await buy("duplicate-user");

  await pay("duplicate-user", "duplicate");

  await sleep(1500);

  const rows = await db(
    `
    SELECT p.status AS payment_status
    FROM payments p
    JOIN holds h
      ON h.id = p.hold_id
    WHERE h.user_id = $1
  `,
    ["duplicate-user"],
  );

  assert(
    rows.length === 1 && rows[0].payment_status === "SUCCEEDED",
    "duplicate webhook causes one successful payment",
  );

  const events = await db(
    `
      SELECT COUNT(*)::int AS count
      FROM payment_events pe
      JOIN payments p
        ON p.id = pe.payment_id
      JOIN holds h
        ON h.id = p.hold_id
      WHERE h.user_id = $1
    `,
    ["duplicate-user"],
  );

  assert(events[0].count === 1, "duplicate webhook is idempotent");

  await invariants();
}

async function testOutOfOrder() {
  console.log("\n--- OUT OF ORDER ---");

  await reset();

  await buy("order-user");

  await pay("order-user", "out_of_order");

  await sleep(1500);

  const rows = await db(
    `
    SELECT p.status AS payment_status
    FROM payments p
    JOIN holds h
      ON h.id = p.hold_id
    WHERE h.user_id = $1
  `,
    ["order-user"],
  );

  assert(
    rows.length === 1 && rows[0].payment_status === "SUCCEEDED",
    "later failed event cannot overwrite success",
  );

  await invariants();
}

async function testFailureCap() {
  console.log("\n--- FAILURE CAP ---");

  await reset();

  await buy("failure-user");

  await pay("failure-user", "fail");

  await sleep(800);

  await pay("failure-user", "fail");

  await sleep(800);

  await pay("failure-user", "fail");

  await sleep(1500);

  const rows = await db(
    `
      SELECT
        h.status AS hold_status,
        p.status AS payment_status,
        p.attempts
      FROM holds h
      JOIN payments p
        ON p.hold_id = h.id
      WHERE h.user_id = $1
    `,
    ["failure-user"],
  );

  assert(
    rows.length === 1 && rows[0].payment_status === "FAILED",
    "payment ends FAILED",
  );

  assert(rows[0].attempts === 3, "payment reaches attempt cap");

  assert(
    rows[0].hold_status !== "ACTIVE",
    "hold is released after failure cap",
  );

  await invariants();
}

async function testLatePayment() {
  console.log("\n--- LATE PAYMENT ---");

  await reset();

  await buy("late-user");

  await pay("late-user", "late");

  await sleep(37_000);

  const rows = await db(
    `
      SELECT
        h.status AS hold_status,
        p.status AS payment_status
      FROM holds h
      JOIN payments p
        ON p.hold_id = h.id
      WHERE h.user_id = $1
    `,
    ["late-user"],
  );

  assert(
    rows.length === 1 && rows[0].payment_status === "LATE_REFUNDED",
    "late payment becomes LATE_REFUNDED",
  );

  assert(
    rows[0].hold_status !== "ACTIVE",
    "late payment does not reactivate hold",
  );

  await invariants();
}

async function testLoad() {
  console.log("\n--- 5,000 CONCURRENT BUYS ---");

  await reset();

  const totalRequests = 5000;
  const userCount = 2000;

  const results = await Promise.all(
    Array.from(
      {
        length: totalRequests,
      },
      (_, index) => buy(`load-user-${index % userCount}`),
    ),
  );

  const holds = results.filter((result) => result.body.type === "HOLD").length;

  const waitlisted = results.filter(
    (result) => result.body.type === "WAITLISTED",
  ).length;

  const unexpectedErrors = results.filter(
    (result) => result.status >= 500,
  ).length;

  console.log(`Requests: ${totalRequests}`);

  console.log(`Holds: ${holds}`);

  console.log(`Waitlisted: ${waitlisted}`);

  console.log(`Unexpected 5xx: ${unexpectedErrors}`);

  assert(holds === 20, "exactly 20 holds under 5,000 concurrent buys");

  assert(unexpectedErrors === 0, "no unexpected 5xx responses");

  const result = await invariants();

  assert(result.metrics.heldUnits === 20, "database has exactly 20 held units");
}

async function main() {
  console.log("====================================");

  console.log(" SNEAKER DROP FINAL TEST SUITE");

  console.log("====================================");

  const health = await api("/health");

  assert(health.status === 200 && health.body.status === "ok", "API health");

  const mock = await fetch("http://localhost:4000/health");

  assert(mock.ok, "mock payment health");

  await testBasicBuy();
  await testExpiryPromotion();
  await testMaxPurchases();
  await testDuplicateWebhook();
  await testOutOfOrder();
  await testFailureCap();
  await testLatePayment();
  await testLoad();

  console.log("\n====================================");

  console.log(" ALL FINAL TESTS PASSED");

  console.log("====================================");
}

main()
  .catch((error) => {
    console.error("\nFINAL TEST FAILED");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
