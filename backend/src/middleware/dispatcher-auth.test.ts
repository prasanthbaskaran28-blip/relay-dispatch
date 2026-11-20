import express from "express";
import type { Server } from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { requireDispatcherAuth } from "./dispatcher-auth.js";

const token = "test-dispatcher-token-with-at-least-32-bytes";
const originalToken = process.env.DISPATCH_API_TOKEN;
const app = express();
app.get("/protected", requireDispatcherAuth, (_request, response) => {
  response.status(204).end();
});

describe("dispatcher authentication middleware", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    process.env.DISPATCH_API_TOKEN = token;
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.once("listening", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Could not determine the auth test server address.");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(() => {
    process.env.DISPATCH_API_TOKEN = token;
  });

  afterAll(async () => {
    if (originalToken === undefined) delete process.env.DISPATCH_API_TOKEN;
    else process.env.DISPATCH_API_TOKEN = originalToken;
    if (server?.listening) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("rejects requests without a bearer token", async () => {
    const response = await fetch(`${baseUrl}/protected`);

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("Bearer");
    expect(await response.json()).toMatchObject({
      error: { code: "UNAUTHORIZED" },
    });
  });

  it("rejects an incorrect bearer token", async () => {
    const response = await fetch(`${baseUrl}/protected`, {
      headers: { Authorization: "Bearer incorrect-token-value" },
    });

    expect(response.status).toBe(401);
  });

  it("fails closed when no sufficiently long token is configured", async () => {
    process.env.DISPATCH_API_TOKEN = "short";
    const response = await fetch(`${baseUrl}/protected`);

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: "AUTH_NOT_CONFIGURED" },
    });
  });

  it("allows a request with the configured bearer token", async () => {
    const response = await fetch(`${baseUrl}/protected`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(204);
  });
});
