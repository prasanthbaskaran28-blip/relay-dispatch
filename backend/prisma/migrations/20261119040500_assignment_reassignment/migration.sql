ALTER TYPE "AssignmentStatus" ADD VALUE 'REASSIGNED';

ALTER TABLE "Assignment"
    ADD COLUMN "reassignedFromId" TEXT,
    ADD COLUMN "reassignmentReason" TEXT,
    ADD COLUMN "overrideReason" TEXT,
    ADD COLUMN "actor" TEXT NOT NULL DEFAULT 'api',
    ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "Assignment_idempotencyKey_key" ON "Assignment"("idempotencyKey");
CREATE INDEX "Assignment_reassignedFromId_idx" ON "Assignment"("reassignedFromId");

ALTER TABLE "Assignment"
    ADD CONSTRAINT "Assignment_reassignedFromId_fkey"
    FOREIGN KEY ("reassignedFromId") REFERENCES "Assignment"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
