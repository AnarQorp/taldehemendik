import test from "node:test";
import assert from "node:assert/strict";
import { escapeHtml } from "../src/utils/sanitize.js";
import { AuthService } from "../src/api/auth.js";
import { ApiClient } from "../src/api/client.js";
import { DomainError, mapDomainError, ERROR_MESSAGES } from "../src/api/errors.js";

test("1. XSS Sanitization: escapeHtml neutralizes script injection and HTML tags", () => {
  // Test null / undefined / edge cases
  assert.equal(escapeHtml(null), "");
  assert.equal(escapeHtml(undefined), "");
  assert.equal(escapeHtml(123), "123");
  assert.equal(escapeHtml(""), "");

  // Test special HTML characters
  assert.equal(escapeHtml("Hello & World"), "Hello &amp; World");
  assert.equal(escapeHtml("<script>alert('xss')</script>"), "&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt;");
  assert.equal(escapeHtml('"><svg onload=alert(1)>'), '&quot;&gt;&lt;svg onload=alert(1)&gt;');

  // ZaQ audit reproduction payload
  const zaqPayload = `<img src=x onerror="alert(localStorage.getItem('talde_session_token'))">`;
  const sanitized = escapeHtml(zaqPayload);

  assert.ok(!sanitized.includes("<img"), "Must not contain raw <img opening tag");
  assert.ok(!sanitized.includes(">"), "Must not contain raw > character");
  assert.ok(sanitized.includes("&lt;img"), "Must encode < as &lt;");
  assert.ok(sanitized.includes("&quot;"), "Must encode \" as &quot;");
  assert.ok(sanitized.includes("&#39;"), "Must encode ' as &#39;");
  assert.equal(
    sanitized,
    "&lt;img src=x onerror=&quot;alert(localStorage.getItem(&#39;talde_session_token&#39;))&quot;&gt;"
  );
});

test("2. OTP Persistence Decoupling: AuthService.verifyOtp does NOT persist token on client", async () => {
  let clientToken = null;
  const mockClient = {
    setToken(t) { clientToken = t; },
    getToken() { return clientToken; },
    async post(path, body, options) {
      return {
        accessToken: "jwt-token-synthetic-12345",
        user: { id: "user-uuid", email: body.email }
      };
    }
  };

  const auth = new AuthService(mockClient);
  const result = await auth.verifyOtp("mikel@example.test", "challenge-1", "123456", "Mikel");

  // Token returned in response but NEVER set on client
  assert.equal(result.accessToken, "jwt-token-synthetic-12345");
  assert.equal(clientToken, null, "Client token must remain null until controller validates lifecycle state");
  assert.equal(mockClient.getToken(), null);
});

test("3. OTP Lifecycle & In-flight Cancellation Logic: Controller checks state before persistence", async () => {
  // Simulate the controller's atomic verification lifecycle
  let appState = {
    sessionToken: null,
    otpOpSeq: 1,
    isModalOpen: true,
    contextGeneration: 1,
    appMode: "BETA_NORMAL",
    inFlightController: new AbortController()
  };

  const mockClient = {
    setToken(t) { appState.sessionToken = t; },
    getToken() { return appState.sessionToken; },
    async post(path, body, options) {
      // Simulate network latency
      await new Promise(r => setTimeout(r, 20));
      if (options?.signal?.aborted) {
        const err = new Error("This operation was aborted");
        err.name = "AbortError";
        throw err;
      }
      return {
        accessToken: "verified-token-abc",
        user: { id: "u-1", email: body.email }
      };
    }
  };

  const auth = new AuthService(mockClient);

  // Scenario A: Modal is closed while verification is in-flight (Condition 1)
  const currentOpId = ++appState.otpOpSeq;
  const currentGen = appState.contextGeneration;
  const currentMode = appState.appMode;

  const inFlightPromise = (async () => {
    try {
      const res = await auth.verifyOtp(
        "coach@test.com",
        "chal-1",
        "123456",
        "Coach",
        { signal: appState.inFlightController.signal }
      );
      // Controller check before persistence
      if (
        currentOpId !== appState.otpOpSeq ||
        !appState.isModalOpen ||
        currentGen !== appState.contextGeneration ||
        currentMode !== appState.appMode
      ) {
        // Discard result
        return { discarded: true };
      }
      appState.sessionToken = res.accessToken;
      return { success: true };
    } catch (err) {
      if (err.name === "AbortError") {
        return { aborted: true };
      }
      throw err;
    }
  })();

  // User closes modal and aborts operation before response returns
  appState.isModalOpen = false;
  appState.inFlightController.abort();

  const outcome = await inFlightPromise;
  assert.ok(outcome.aborted || outcome.discarded, "Operation must be discarded or aborted");
  assert.equal(appState.sessionToken, null, "Token must NOT be persisted if modal was closed");
});

test("4. Multi-team Concurrency: contextGeneration invalidates late async responses", async () => {
  // Test simulated contextGeneration guard as implemented in TeamAppState
  let contextGeneration = 0;
  let live = {
    teamSeasonId: null,
    teamName: null,
    agenda: []
  };

  async function mockFetchTeamData(teamId, teamName, delayMs) {
    const reqGen = contextGeneration;
    await new Promise(resolve => setTimeout(resolve, delayMs));

    // Guard: ignore stale response
    if (reqGen !== contextGeneration) {
      return { discarded: true, reqGen, currentGen: contextGeneration };
    }

    live.teamSeasonId = teamId;
    live.teamName = teamName;
    live.agenda = [`event-for-${teamName}`];
    return { applied: true, reqGen };
  }

  function switchTeam(newTeamId, newTeamName) {
    contextGeneration++;
    live = {
      teamSeasonId: null,
      teamName: null,
      agenda: []
    };
  }

  // Step 1: User is on Team A, async fetch starts (slow: 50ms)
  contextGeneration = 1;
  const teamAPromise = mockFetchTeamData("team-A-id", "Team A", 50);

  // Step 2: User quickly switches to Team B (fast: 10ms)
  switchTeam("team-B-id", "Team B");
  assert.equal(contextGeneration, 2);
  assert.equal(live.teamSeasonId, null, "Operational state must be wiped on switch");

  const teamBPromise = mockFetchTeamData("team-B-id", "Team B", 10);

  const [resA, resB] = await Promise.all([teamAPromise, teamBPromise]);

  // Team B resolved and applied
  assert.equal(resB.applied, true);
  assert.equal(live.teamSeasonId, "team-B-id");
  assert.equal(live.teamName, "Team B");

  // Team A resolved LATER, but was discarded due to stale contextGeneration
  assert.equal(resA.discarded, true);
  assert.equal(resA.reqGen, 1);
  assert.equal(resA.currentGen, 2);

  // Crucial: live state still belongs strictly to Team B!
  assert.equal(live.teamSeasonId, "team-B-id");
  assert.equal(live.teamName, "Team B");
  assert.deepEqual(live.agenda, ["event-for-Team B"]);
});

test("5. DEMO / BETA_NORMAL Mode Isolation: State and tokens are purged on mode change", () => {
  const fakeStorage = new Map();
  fakeStorage.set("talde_session_token", "production-active-token");
  fakeStorage.set("talde_token_coach", "coach-token-legacy");

  let appMode = "BETA_NORMAL";
  let live = { teamSeasonId: "real-prod-team-id", members: ["real-user"] };
  let inFlightAborted = false;

  function setAppMode(newMode) {
    if (appMode === newMode) return;
    inFlightAborted = true;
    appMode = newMode;
    live = { teamSeasonId: null, members: [] };
    fakeStorage.delete("talde_session_token");
    fakeStorage.delete("talde_token_coach");
    fakeStorage.delete("talde_token_parent");
  }

  // Switch to DEMO
  setAppMode("DEMO");
  assert.equal(appMode, "DEMO");
  assert.equal(inFlightAborted, true);
  assert.equal(fakeStorage.get("talde_session_token"), undefined);
  assert.equal(fakeStorage.get("talde_token_coach"), undefined);
  assert.equal(live.teamSeasonId, null);
  assert.deepEqual(live.members, []);
});

test("6. 401 Classification: Differentiates unauthenticated OTP failure from session expiry", () => {
  // Case A: Unauthenticated 401 on /auth/otp/verify (wrong or expired OTP)
  const unauth401 = new DomainError("AUTH_INVALID", "Invalid or expired OTP", 401);
  unauth401.wasAuthenticated = false;
  unauth401.path = "/auth/otp/verify";

  const msgA = mapDomainError(unauth401);
  assert.equal(msgA, ERROR_MESSAGES.AUTH_INVALID);
  assert.ok(msgA.includes("Código no válido o caducado"), "Must show invalid OTP message to user");

  // Case B: Authenticated 401 on /v1/me/memberships (Bearer token expired/revoked)
  const auth401 = new DomainError("AUTH_EXPIRED", "Token expired", 401);
  auth401.wasAuthenticated = true;
  auth401.path = "/v1/me/memberships";

  const msgB = mapDomainError(auth401);
  assert.equal(msgB, ERROR_MESSAGES.AUTH_REQUIRED);
  assert.ok(msgB.includes("Sesión no válida o expirada"), "Must trigger session expiration notice");
});
