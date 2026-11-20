import { Prisma } from "@prisma/client";
import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";
import { AppError } from "../utils/app-error.js";

export const notFoundHandler: RequestHandler = (request, _response, next) => {
  next(
    new AppError(
      404,
      "ROUTE_NOT_FOUND",
      `Route ${request.method} ${request.originalUrl} was not found.`,
    ),
  );
};

export const errorHandler: ErrorRequestHandler = (
  error,
  _request,
  response,
  _next,
) => {
  if (error instanceof ZodError) {
    response.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed.",
        details: error.issues.map((issue) => ({
          field: issue.path.map(String).join("."),
          message: issue.message,
        })),
      },
    });
    return;
  }

  if (error instanceof AppError) {
    response.status(error.statusCode).json({
      error: { code: error.code, message: error.message },
    });
    return;
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      response.status(409).json({
        error: {
          code: "DUPLICATE_RESOURCE",
          message: "A record with these values already exists.",
        },
      });
      return;
    }

    if (error.code === "P2003") {
      response.status(400).json({
        error: {
          code: "INVALID_REFERENCE",
          message: "A referenced record does not exist.",
        },
      });
      return;
    }

    if (error.code === "P2025") {
      response.status(404).json({
        error: { code: "RECORD_NOT_FOUND", message: "Record not found." },
      });
      return;
    }

    if (error.code === "P2034") {
      response.status(409).json({
        error: {
          code: "CONCURRENT_MODIFICATION",
          message: "The record changed concurrently. Retry the request.",
        },
      });
      return;
    }
  }

  if (
    error instanceof SyntaxError &&
    "status" in error &&
    error.status === 400
  ) {
    response.status(400).json({
      error: { code: "INVALID_JSON", message: "Request body must be valid JSON." },
    });
    return;
  }

  console.error("Unhandled API error:", error);
  response.status(500).json({
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "An unexpected error occurred.",
    },
  });
};
