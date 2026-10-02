const TOTAL_REQUESTS = 5000;
const USER_COUNT = 2000;

async function request(userId: string) {
  const response = await fetch("http://localhost:3000/api/buy", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ userId }),
  });

  return response.json();
}

async function main() {
  const requests = Array.from({ length: TOTAL_REQUESTS }, (_, index) => {
    const userId = `load-user-${index % USER_COUNT}`;

    return request(userId);
  });

  const results = await Promise.all(requests);

  const holds = results.filter((r) => r.type === "HOLD");

  const waitlisted = results.filter((r) => r.type === "WAITLISTED");

  const errors = results.filter((r) => r.error);

  console.log(`Requests: ${TOTAL_REQUESTS}`);
  console.log(`Holds: ${holds.length}`);
  console.log(`Waitlisted: ${waitlisted.length}`);
  console.log(`Errors: ${errors.length}`);

  const invariantResponse = await fetch(
    "http://localhost:3000/admin/invariants",
  );

  const invariants = await invariantResponse.json();

  console.log(JSON.stringify(invariants, null, 2));

  if (holds.length !== 20 || !invariants.ok) {
    console.error("LOAD TEST FAILED");

    process.exit(1);
  }

  console.log("exactly 20 held, 0 violations");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
