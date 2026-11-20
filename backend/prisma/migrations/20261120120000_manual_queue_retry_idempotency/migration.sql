ALTER TABLE "JobEvent" ADD COLUMN "idempotencyKey" TEXT;

WITH retry_events AS (
    SELECT
        "id",
        details->>'idempotencyKey' AS idempotency_key,
        ROW_NUMBER() OVER (
            PARTITION BY "jobId", "eventType", details->>'idempotencyKey'
            ORDER BY "createdAt", "id"
        ) AS occurrence
    FROM "JobEvent"
    WHERE "eventType" = 'MANUAL_QUEUE_RETRY'
      AND jsonb_typeof(details) = 'object'
      AND details->>'idempotencyKey' IS NOT NULL
)
UPDATE "JobEvent" AS event
SET "idempotencyKey" = retry_events.idempotency_key
FROM retry_events
WHERE event."id" = retry_events."id"
  AND retry_events.occurrence = 1;

CREATE UNIQUE INDEX "JobEvent_jobId_eventType_idempotencyKey_key"
    ON "JobEvent"("jobId", "eventType", "idempotencyKey");
