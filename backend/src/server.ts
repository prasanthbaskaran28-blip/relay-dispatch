import "dotenv/config";
import app from "./app.js";
import prisma from "./config/database.js";
import { startAssignmentTimeoutWorker } from "./workers/assignment-timeout.worker.js";

const port = Number(process.env.PORT ?? 5000);
const stopAssignmentTimeoutWorker = startAssignmentTimeoutWorker();
const server = app.listen(port, () => {
  console.log(`RELAY API running at http://localhost:${port}`);
});

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}; shutting down RELAY API.`);

  server.close(async (error) => {
    if (error) {
      console.error("Failed to close the HTTP server cleanly:", error);
      process.exitCode = 1;
    }

    try {
      await stopAssignmentTimeoutWorker();
      await prisma.$disconnect();
    } catch (shutdownError) {
      console.error("Failed to stop backend services cleanly:", shutdownError);
      process.exitCode = 1;
    }
  });
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
