async function main() {
  const users = Array.from({ length: 25 }, (_, index) => `user-${index + 1}`);

  const results = await Promise.all(
    users.map(async (userId) => {
      const response = await fetch("http://localhost:3000/api/buy", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ userId }),
      });

      return {
        userId,
        status: response.status,
        body: await response.json(),
      };
    }),
  );

  const holds = results.filter((result) => result.body.type === "HOLD");

  const waitlisted = results.filter(
    (result) => result.body.type === "WAITLISTED",
  );

  console.log(`Holds: ${holds.length}`);
  console.log(`Waitlisted: ${waitlisted.length}`);

  for (const result of results) {
    console.log(result);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
