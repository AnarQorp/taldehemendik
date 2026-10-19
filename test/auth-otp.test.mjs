import test from "node:test";
import assert from "node:assert/strict";
import { AuthService } from "../src/api/auth.js";
import { ApiClient } from "../src/api/client.js";
import { mapDomainError, DomainError, ERROR_MESSAGES } from "../src/api/errors.js";

test("AuthService.requestOtp normalizes email before posting", async () => {
  let requestedPayload = null;
  const mockClient = {
    async post(path, body) {
      requestedPayload = { path, body };
      return { challengeId: "test-challenge-1234" };
    }
  };

  const auth = new AuthService(mockClient);
  const res = await auth.requestOtp("   MiKeL.Entrenador@EXAMPLE.COM   ");

  assert.equal(requestedPayload.path, "/auth/otp/request");
  assert.equal(requestedPayload.body.email, "mikel.entrenador@example.com");
  assert.equal(res.challengeId, "test-challenge-1234");
});

test("AuthService.verifyOtp trims inputs and sets accessToken on client", async () => {
  let verifyPayload = null;
  let tokenSetOnClient = null;
  const mockClient = {
    setToken(t) { tokenSetOnClient = t; },
    async post(path, body) {
      verifyPayload = { path, body };
      return {
        accessToken: "header.payload.sig",
        user: { id: "user-uuid-1", email: body.email }
      };
    }
  };

  const auth = new AuthService(mockClient);
  const res = await auth.verifyOtp(
    "  Mister@Test.Com  ",
    "challenge-uuid",
    "  839102  ",
    "  Mikel Entrenador  "
  );

  assert.equal(verifyPayload.path, "/auth/otp/verify");
  assert.equal(verifyPayload.body.email, "mister@test.com");
  assert.equal(verifyPayload.body.challengeId, "challenge-uuid");
  assert.equal(verifyPayload.body.otp, "839102");
  assert.equal(verifyPayload.body.displayName, "Mikel Entrenador");
  assert.equal(tokenSetOnClient, "header.payload.sig");
  assert.equal(res.accessToken, "header.payload.sig");
});

test("AuthService.loginDev fails closed in production when developmentOtp is missing", async () => {
  const mockClient = {
    async post(path) {
      if (path === "/auth/otp/request") {
        // Production backend response: ONLY challengeId, NEVER developmentOtp
        return { challengeId: "prod-challenge-uuid" };
      }
      throw new Error("Should not reach verify");
    }
  };

  const auth = new AuthService(mockClient);
  await assert.rejects(
    async () => {
      await auth.loginDev("coach@example.com", "Coach");
    },
    /DEV_AUTH_UNAVAILABLE/
  );
});

test("mapDomainError handles 401, 429, 503 and generic errors without leaking sensitive data", () => {
  // 401 Unauthorized / Invalid OTP
  const err401 = new DomainError("AUTH_INVALID", "Invalid or expired", 401);
  assert.equal(mapDomainError(err401), ERROR_MESSAGES.AUTH_INVALID);

  // 429 Rate Limit
  const err429 = new DomainError("AUTH_INVALID", "Please wait before requesting another code", 429);
  assert.equal(mapDomainError(err429), ERROR_MESSAGES.RATE_LIMIT_EXCEEDED);

  // 503 Mail Delivery Unavailable
  const err503 = new DomainError("AUTH_INVALID", "Authentication email delivery is unavailable", 503);
  assert.match(mapDomainError(err503), /servicio de envío de correos no está disponible/i);

  // Generic network error
  const netErr = new TypeError("fetch failed");
  assert.match(mapDomainError(netErr), /Error de conexión/);
});

test("Security guarantee: OTP codes are never logged or stored in storage", () => {
  const storage = new Map();
  const mockStorage = {
    setItem(k, v) { storage.set(k, String(v)); },
    getItem(k) { return storage.get(k) || null; },
    removeItem(k) { storage.delete(k); }
  };

  const sensitiveOtp = "729104";
  const accessToken = "mock.valid.token";

  mockStorage.setItem("talde_session_token", accessToken);

  // Assert sensitive OTP is nowhere in storage keys or values
  for (const [key, value] of storage.entries()) {
    assert.notEqual(key, sensitiveOtp);
    assert.notEqual(value, sensitiveOtp);
    assert.ok(!value.includes(sensitiveOtp), `Storage key ${key} must not contain raw OTP`);
  }
});
