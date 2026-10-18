import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { DevelopmentAuthAdapter } from "../../src/auth/development-adapter.js";
import { rawPool as pool } from "../../src/db/pool.js";

describe("Dev Reset and CORS configuration", () => {
  it("rejects unauthorized CORS origin", async () => {
    const app = await buildApp({ authAdapter: new DevelopmentAuthAdapter() });
    const response = await app.inject({
      method: "OPTIONS",
      url: "/v1/events",
      headers: {
        origin: "http://malicious-site.example.com",
        "access-control-request-method": "GET"
      }
    });
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    await app.close();
  });

  it("allows configured localhost origins with correct headers", async () => {
    const app = await buildApp({ authAdapter: new DevelopmentAuthAdapter() });
    const response = await app.inject({
      method: "OPTIONS",
      url: "/v1/events",
      headers: {
        origin: "http://localhost:8000",
        "access-control-request-method": "GET",
        "access-control-request-headers": "authorization, idempotency-key"
      }
    });
    expect(response.headers["access-control-allow-origin"]).toBe("http://localhost:8000");
    expect(response.headers["access-control-allow-headers"]).toContain("Authorization");
    expect(response.headers["access-control-allow-headers"]).toContain("Idempotency-Key");
    await app.close();
  });
});
