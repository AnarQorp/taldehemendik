import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { ProductionAuthAdapter } from "../../src/auth/production.js";
import { AuthPolicy } from "../../src/auth/policy.js";

describe("ZaQ Admission Gate & Policy Verification (Offline Probe)", () => {
  const env = Object.freeze({
    NODE_ENV: "production",
    AUTH_TOKEN_SECRET: "offline-proof-not-a-real-secret-0123456789abcdef",
    TALDE_AUTH_ALLOWED_EMAILS: "allowed@fixture.invalid",
    TALDE_AUTH_POLICY_REVISION: "offline-proof-v1"
  });

  function createMockAdapter() {
    const counts = { connect: 0, queries: 0, smtp_mock_calls: 0 };
    const client = {
      query: async (sql: string) => {
        counts.queries++;
        return { rows: sql.includes("count(*)") ? [{ count: 0, latest: null }] : [] };
      },
      release() {}
    };
    const pool = {
      connect: async () => {
        counts.connect++;
        return client as any;
      }
    };
    const delivery = {
      sendMail: async () => {
        counts.smtp_mock_calls++;
        return {};
      }
    };

    const adapter = new ProductionAuthAdapter({
      pool: pool as any,
      delivery,
      secret: env.AUTH_TOKEN_SECRET,
      allowedEmails: [env.TALDE_AUTH_ALLOWED_EMAILS],
      policyRevision: env.TALDE_AUTH_POLICY_REVISION
    });

    return { adapter, counts };
  }

  it("reproduces ZaQ gate: rejects unauthorized OTP with 0 DB connections and 0 SMTP calls", async () => {
    const { adapter, counts } = createMockAdapter();

    let otpRejected = false;
    try {
      await adapter.requestOtp("outside@fixture.invalid");
    } catch (error: any) {
      if (error.code === "AUTH_INVALID" || error.statusCode === 401 || error.status === 401) {
        otpRejected = true;
      } else {
        throw error;
      }
    }

    expect(otpRejected).toBe(true);
    expect(counts.connect).toBe(0);
    expect(counts.queries).toBe(0);
    expect(counts.smtp_mock_calls).toBe(0);
  });

  it("reproduces ZaQ gate: rejects tokens missing required email or policy claims", () => {
    const { adapter } = createMockAdapter();

    // Token signed with SECRET but missing email and policy revision
    const claims = {
      sub: "f244153e-e7d3-4b7c-81d5-ef96585de752",
      iss: "talde-hemendik",
      aud: "talde-private-api",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600
    };
    const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
    const token = payload + "." + crypto.createHmac("sha256", env.AUTH_TOKEN_SECRET).update(payload).digest("base64url");

    let missingPolicyClaimsRejected = false;
    try {
      adapter.verifyAccessToken(token);
    } catch {
      missingPolicyClaimsRejected = true;
    }

    expect(missingPolicyClaimsRejected).toBe(true);
  });

  it("revokes tokens immediately when policy revision changes", () => {
    const { adapter: adapterV1 } = createMockAdapter();

    // Token issued under revision v1
    const userId = "f244153e-e7d3-4b7c-81d5-ef96585de752";
    const tokenV1 = adapterV1.issueAccessToken(userId, "user@fixture.invalid");

    // Valid under v1
    const verified = adapterV1.verifyAccessToken(tokenV1);
    expect(verified).toEqual({ userId, email: "user@fixture.invalid" });

    // When policy is rotated to v2:
    const adapterV2 = new ProductionAuthAdapter({
      secret: env.AUTH_TOKEN_SECRET,
      allowedEmails: [env.TALDE_AUTH_ALLOWED_EMAILS],
      policyRevision: "offline-proof-v2"
    });

    // Token issued under v1 is now rejected under v2 (revocation)
    expect(() => adapterV2.verifyAccessToken(tokenV1)).toThrow();
  });

  it("accepts allowed emails directly and issues valid policy-bound tokens", async () => {
    const { adapter, counts } = createMockAdapter();

    const challenge = await adapter.requestOtp("allowed@fixture.invalid");
    expect(challenge.challengeId).toBeDefined();
    expect(counts.connect).toBe(1);
    expect(counts.smtp_mock_calls).toBe(1);

    const token = adapter.issueAccessToken("f244153e-e7d3-4b7c-81d5-ef96585de752", "allowed@fixture.invalid");
    const decoded = adapter.verifyAccessToken(token);
    expect(decoded).toEqual({ userId: "f244153e-e7d3-4b7c-81d5-ef96585de752", email: "allowed@fixture.invalid" });
  });

  it("reproduces ZaQ lifecycle probe: rejects startup when allowedEmails is empty", () => {
    expect(() => {
      new ProductionAuthAdapter({
        secret: env.AUTH_TOKEN_SECRET,
        allowedEmails: [],
        policyRevision: env.TALDE_AUTH_POLICY_REVISION
      });
    }).toThrow(/allowlist/i);
  });

  it("reproduces ZaQ lifecycle probe: rejects startup when policyRevision is missing or empty", () => {
    expect(() => {
      new ProductionAuthAdapter({
        secret: env.AUTH_TOKEN_SECRET,
        allowedEmails: [env.TALDE_AUTH_ALLOWED_EMAILS],
        policyRevision: ""
      });
    }).toThrow(/TALDE_AUTH_POLICY_REVISION/i);
  });

  it("reproduces ZaQ lifecycle probe: invalidates pending OTP challenges when policy revision changes", async () => {
    let capturedChallenge: any = null;
    let deliveredOtp: string | null = null;

    const client = {
      query: async (sql: string, args: any[] = []) => {
        if (sql.includes("count(*)")) return { rows: [{ count: 0, latest: null }] };
        if (sql.startsWith("INSERT INTO auth_challenges")) {
          capturedChallenge = { id: args[0], email: args[1], otp_hash: args[2], attempts: 0, consumed_at: null, unexpired: true };
        }
        if (sql.startsWith("SELECT *, expires_at")) {
          return { rows: capturedChallenge ? [capturedChallenge] : [] };
        }
        return { rows: [], rowCount: 0 };
      },
      release() {}
    };
    const pool = {
      connect: async () => client as any
    };
    const delivery = {
      sendMail: async (msg: any) => {
        deliveredOtp = msg.text.match(/\b[0-9]{6}\b/)?.[0] ?? null;
        return {};
      }
    };

    // Old adapter under policy-v1
    const oldAdapter = new ProductionAuthAdapter({
      pool: pool as any,
      delivery,
      secret: env.AUTH_TOKEN_SECRET,
      allowedEmails: [env.TALDE_AUTH_ALLOWED_EMAILS],
      policyRevision: "policy-v1"
    });

    const { challengeId } = await oldAdapter.requestOtp("allowed@fixture.invalid");
    expect(challengeId).toBeDefined();
    expect(deliveredOtp).toBeDefined();

    // New adapter under policy-v2
    const newAdapter = new ProductionAuthAdapter({
      pool: pool as any,
      delivery,
      secret: env.AUTH_TOKEN_SECRET,
      allowedEmails: [env.TALDE_AUTH_ALLOWED_EMAILS],
      policyRevision: "policy-v2"
    });

    // Verification of the old challenge under the new policy revision MUST fail
    await expect(
      newAdapter.verifyOtp("allowed@fixture.invalid", challengeId, deliveredOtp!)
    ).rejects.toThrow();
  });
});
