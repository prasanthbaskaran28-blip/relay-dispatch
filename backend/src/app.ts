import express from "express";
import cors from "cors";
import prisma from "./config/database.js";
import jobRoutes from "./modules/jobs/job.routes.js";
import riderRoutes from "./modules/riders/rider.routes.js";
import assignmentRoutes from "./modules/assignments/assignment.routes.js";
import manualQueueRoutes from "./modules/manual-queue/manual-queue.routes.js";
import auditLogRoutes from "./modules/audit-logs/audit-logs.routes.js";
import dashboardRoutes from "./modules/dashboard/dashboard.routes.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import { requireDispatcherAuth } from "./middleware/dispatcher-auth.js";

const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/", (_request, response) => {
  response.json({ message: "RELAY Dispatch API is running" });
});

app.get("/health", async (_request, response) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    response.status(200).json({ status: "OK", database: "Connected" });
  } catch (error) {
    console.error("Database health check failed:", error);
    response.status(503).json({ status: "ERROR", database: "Disconnected" });
  }
});

app.use("/api", requireDispatcherAuth);
app.use("/api/jobs", jobRoutes);
app.use("/api/riders", riderRoutes);
app.use("/api/assignments", assignmentRoutes);
app.use("/api/manual-queue", manualQueueRoutes);
app.use("/api/audit-logs", auditLogRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
