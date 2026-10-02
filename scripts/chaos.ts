const USERS = 2000;
const REQUESTS = 5000;

const scenarios = ["success", "fail", "duplicate", "out_of_order", "late"];

async function buy(userId: string) {
  const response = await fetch("http://localhost:3000/api/buy", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ userId }),
  });

  return response.json();
}

async function pay(userId: string, scenario: string) {
  const response = await fetch("http://localhost:3000/api/pay", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      userId,
      scenario,
    }),
  });

  return response.json();
}

async function main() {
  const results = await Promise.allSettled(
    Array.from({ length: REQUESTS }, (_, index) => {
      const userId = `chaos-user-${index % USERS}`;

      return buy(userId);
    }),
  );

  console.log(`Buy requests completed: ${results.length}`);

  // Try payments for every user.
  await Promise.allSettled(
    Array.from({ length: USERS }, (_, index) => {
      const userId = `chaos-user-${index}`;

      const scenario = scenarios[index % scenarios.length];

      return pay(userId, scenario);
    }),
  );

  await new Promise((resolve) => setTimeout(resolve, 3000));

  const response = await fetch("http://localhost:3000/admin/invariants");

  const invariants = await response.json();

  console.log(JSON.stringify(invariants, null, 2));

  if (!invariants.ok) {
    console.error("CHAOS TEST FAILED");
    process.exit(1);
  }

  console.log("CHAOS TEST PASSED");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
