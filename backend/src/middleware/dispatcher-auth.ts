import { createHash, timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";

const minimumTokenBytes = 32;

function matchesToken(providedToken: string, expectedToken: string): boolean {
  const providedDigest = createHash("sha256").update(providedToken).digest();
  const expectedDigest = createHash("sha256").update(expectedToken).digest();
  return timingSafeEqual(providedDigest, expectedDigest);
}

export const requireDispatcherAuth: RequestHandler = (request, response, next) => {
  const expectedToken = process.env.DISPATCH_API_TOKEN;
  if (
    !expectedToken ||
    Buffer.byteLength(expectedToken, "utf8") < minimumTokenBytes
  ) {
    response.status(503).json({
      error: {
        code: "AUTH_NOT_CONFIGURED",
        message: "Dispatcher API authentication is not configured.",
      },
    });
    return;
  }

  const authorization = request.get("Authorization");
  const match = authorization?.match(/^Bearer ([^\s]+)$/i);
  if (!match || !matchesToken(match[1]!, expectedToken)) {
    response.set("WWW-Authenticate", 'Bearer realm="dispatch-api"');
    response.status(401).json({
      error: {
        code: "UNAUTHORIZED",
        message: "A valid dispatcher access token is required.",
      },
    });
    return;
  }

  next();
};
