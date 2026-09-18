import test from "node:test";
import assert from "node:assert/strict";
import { DomainError, mapDomainError, ERROR_MESSAGES } from "../src/api/errors.js";
import { IdempotencyManager } from "../src/api/idempotency.js";
import { ApiClient } from "../src/api/client.js";

test("mapDomainError maps domain error codes to Spanish messages", () => {
  const err1 = new DomainError("CALLUP_VERSION_CONFLICT", "Conflict", 409);
  assert.equal(mapDomainError(err1), ERROR_MESSAGES.CALLUP_VERSION_CONFLICT);

  const err2 = new DomainError("SUBSTITUTE_NO_LONGER_ELIGIBLE", "No eligible", 409);
  assert.equal(mapDomainError(err2), ERROR_MESSAGES.SUBSTITUTE_NO_LONGER_ELIGIBLE);

  const err3 = new DomainError("UNKNOWN_CODE", "Mensaje legible", 400);
  assert.equal(mapDomainError(err3), "Mensaje legible");

  const netErr = new TypeError("fetch failed");
  assert.match(mapDomainError(netErr), /127.0.0.1:3100/);
});

test("IdempotencyManager maintains key across retries and resets when requested", () => {
  const mgr = new IdempotencyManager();
  const scope = "publish-callup-test";

  const key1 = mgr.getOrCreateKey(scope);
  assert.ok(key1, "Key should be generated");
  assert.equal(typeof key1, "string");
  assert.equal(key1.length, 36, "Should be valid UUID format");

  // Retry returns exact same key
  const key2 = mgr.getOrCreateKey(scope);
  assert.equal(key1, key2, "Idempotency key must be identical across retries of same scope");

  // Clear key
  mgr.clearKey(scope);
  const key3 = mgr.getOrCreateKey(scope);
  assert.notEqual(key1, key3, "After clear, new operation should produce new key");
});

test("ApiClient builds correct headers and handles Bearer token and Idempotency-Key", async () => {
  let capturedUrl = "";
  let capturedOptions = {};

  global.fetch = async (url, options) => {
    capturedUrl = url;
    capturedOptions = options;
    return {
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({ success: true })
    };
  };

  const client = new ApiClient("http://127.0.0.1:3100/v1");
  client.setToken("my-test-jwt");

  const result = await client.post("/callups/123/publish", { expectedVersion: 1 }, { idempotencyKey: "test-idem-key" });

  assert.equal(capturedUrl, "http://127.0.0.1:3100/v1/callups/123/publish");
  assert.equal(capturedOptions.method, "POST");
  assert.equal(capturedOptions.headers["Authorization"], "Bearer my-test-jwt");
  assert.equal(capturedOptions.headers["Content-Type"], "application/json");
  assert.equal(capturedOptions.headers["Idempotency-Key"], "test-idem-key");
  assert.deepEqual(result, { success: true });
});

test("ApiClient parses error payloads and throws DomainError", async () => {
  global.fetch = async () => {
    return {
      ok: false,
      status: 409,
      statusText: "Conflict",
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({ error: { code: "CALLUP_VERSION_CONFLICT", message: "Revision mismatch" } })
    };
  };

  const client = new ApiClient("http://127.0.0.1:3100/v1");
  await assert.rejects(
    async () => {
      await client.post("/callups/123/publish", {});
    },
    (err) => {
      assert.ok(err instanceof DomainError);
      assert.equal(err.code, "CALLUP_VERSION_CONFLICT");
      assert.equal(err.status, 409);
      return true;
    }
  );
});
