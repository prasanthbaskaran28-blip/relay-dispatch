import { AssignmentStatus, JobStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { AppError } from "../../utils/app-error.js";
import {
  assertJobAssignable,
  assertOverrideReason,
  assertReassignmentAllowed,
} from "./assignment.logic.js";

describe("assignment rules", () => {
  it("allows assignment only from unassigned job states", () => {
    for (const status of [
      JobStatus.NEW,
      JobStatus.READY_FOR_ASSIGNMENT,
      JobStatus.MANUAL_QUEUE,
    ]) {
      expect(() => assertJobAssignable(status)).not.toThrow();
    }

    for (const status of [
      JobStatus.AWAITING_CONFIRMATION,
      JobStatus.ACCEPTED,
      JobStatus.PICKED_UP,
      JobStatus.DELIVERED,
      JobStatus.CANCELLED,
    ]) {
      expect(() => assertJobAssignable(status)).toThrow(AppError);
    }
  });

  it("requires a reason only when selecting below the top recommendation", () => {
    expect(() => assertOverrideReason(0)).not.toThrow();
    expect(() => assertOverrideReason(1, "Dispatcher choice")).not.toThrow();
    expect(() => assertOverrideReason(1)).toThrow(
      expect.objectContaining({ code: "OVERRIDE_REASON_REQUIRED" }),
    );
  });

  it("allows pending and accepted reassignment only before pickup", () => {
    expect(() =>
      assertReassignmentAllowed(
        JobStatus.AWAITING_CONFIRMATION,
        AssignmentStatus.PENDING,
      ),
    ).not.toThrow();
    expect(() =>
      assertReassignmentAllowed(
        JobStatus.ACCEPTED,
        AssignmentStatus.ACCEPTED,
        "Dispatch correction",
      ),
    ).not.toThrow();

    for (const status of [
      JobStatus.PICKED_UP,
      JobStatus.DELIVERED,
      JobStatus.CANCELLED,
    ]) {
      expect(() =>
        assertReassignmentAllowed(status, AssignmentStatus.PENDING),
      ).toThrow(AppError);
    }
    expect(() =>
      assertReassignmentAllowed(
        JobStatus.AWAITING_CONFIRMATION,
        AssignmentStatus.REASSIGNED,
      ),
    ).toThrow(AppError);
  });

  it("requires a reason to replace an accepted assignment", () => {
    expect(() =>
      assertReassignmentAllowed(
        JobStatus.ACCEPTED,
        AssignmentStatus.ACCEPTED,
      ),
    ).toThrow(
      expect.objectContaining({ code: "REASSIGNMENT_REASON_REQUIRED" }),
    );
  });
});
