import { app } from "./app.js";
import { config } from "./config.js";
import { pool } from "./db.js";
import { startExpiryWorker } from "./workers/expiryWorker.js";

const server = app.listen(config.port, () => {
  console.log(`Server running on port ${config.port}`);
});

const expiryWorker = startExpiryWorker();

function shutdown() {
  clearInterval(expiryWorker);

  server.close(() => {
    void pool.end().finally(() => {
      process.exit(0);
    });
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
