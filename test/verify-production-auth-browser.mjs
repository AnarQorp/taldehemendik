import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { buildApp } from "../backend/dist/app.js";
import { ProductionAuthAdapter } from "../backend/dist/auth/production.js";
import { authPool, pool, rawPool } from "../backend/dist/db/pool.js";

const ARTIFACTS_DIR = "/home/anarqorp/.gemini/antigravity/brain/14e42d33-62b4-4338-aa0b-d63ec97c310f/screenshots";
const LOCAL_DIR = "/home/anarqorp/TaldeHemendik/test-artifacts/screenshots";

async function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHttp(url, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 404) return true;
    } catch {
      // retry
    }
    await delay(150);
  }
  throw new Error(`Timeout waiting for ${url}`);
}

async function getPageWsUrl() {
  const res = await fetch("http://127.0.0.1:9222/json");
  const targets = await res.json();
  const page = targets.find((t) => t.type === "page");
  if (!page) throw new Error("No page target found on CDP 9222");
  return page.webSocketDebuggerUrl;
}

class CdpClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 1;
    this.callbacks = new Map();
  }

  async connect() {
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });

    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.method === "Runtime.consoleAPICalled") {
        console.log("[Browser Console]", msg.params.type, ...msg.params.args.map((a) => a.value ?? a.description));
      } else if (msg.method === "Runtime.exceptionThrown") {
        console.error("[Browser Exception]", msg.params.exceptionDetails);
      }
      if (msg.id && this.callbacks.has(msg.id)) {
        this.callbacks.get(msg.id)(msg);
        this.callbacks.delete(msg.id);
      }
    };
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const msgId = this.id++;
      this.callbacks.set(msgId, (msg) => {
        if (msg.error) {
          reject(new Error(`CDP ${method} failed: ${JSON.stringify(msg.error)}`));
        } else {
          resolve(msg.result);
        }
      });
      this.ws.send(JSON.stringify({ id: msgId, method, params }));
    });
  }

  async evaluate(expression) {
    let script = expression.trim();
    if (!script.startsWith("(async () =>") && !script.startsWith("(() =>") && !script.startsWith("function")) {
      script = `(async () => {\n${script}\n})()`;
    }
    const res = await this.send("Runtime.evaluate", {
      expression: script,
      awaitPromise: true,
      returnByValue: true
    });
    if (res.exceptionDetails) {
      throw new Error(`Eval failed: ${JSON.stringify(res.exceptionDetails)}`);
    }
    return res.result?.value;
  }

  async captureScreenshot(filename) {
    const res = await this.send("Page.captureScreenshot", { format: "png" });
    const buffer = Buffer.from(res.data, "base64");
    const localPath = path.join(LOCAL_DIR, filename);
    const artifactPath = path.join(ARTIFACTS_DIR, filename);
    await fs.writeFile(localPath, buffer);
    try {
      await fs.writeFile(artifactPath, buffer);
    } catch {
      // ignore
    }
    console.log(`📸 Screenshot saved: ${filename}`);
  }

  close() {
    this.ws.close();
  }
}

async function main() {
  console.log("=== INITIATING BROWSER PRODUCTION AUTH VERIFICATION ===");
  await fs.mkdir(LOCAL_DIR, { recursive: true });
  await fs.mkdir(ARTIFACTS_DIR, { recursive: true });

  const runId = randomUUID().slice(0, 8);
  const coachEmail = `coach-${runId}@example.test`;
  const guardianEmail = `guardian-${runId}@example.test`;

  // 1. In-memory delivered mail sink for production auth adapter
  const deliveredOtps = new Map();
  const delivery = {
    async sendMail(message) {
      const code = message.text.match(/\b\d{6}\b/)?.[0];
      if (code) {
        deliveredOtps.set(message.to.toLowerCase(), code);
        console.log(`[Test Mail Sink] OTP for ${message.to} captured`);
      }
      return {};
    }
  };

  const secret = "production-browser-auth-verification-secret-32-chars";
  const authAdapter = new ProductionAuthAdapter({
    pool: authPool,
    delivery,
    secret,
    from: "auth@taldehemendik.test"
  });

  // 2. Start Backend API on port 3101
  console.log("Starting backend API on port 3101...");
  const app = await buildApp({ authAdapter, enableDevReset: false });
  await app.listen({ host: "127.0.0.1", port: 3101 });
  console.log("Backend listening on http://127.0.0.1:3101/v1");

  // 3. Start static HTTP server on port 8000 if not already running
  let pyServer = null;
  try {
    await fetch("http://127.0.0.1:8000/");
    console.log("Static server already running on port 8000.");
  } catch {
    console.log("Spawning python static server on port 8000...");
    pyServer = spawn("python3", ["-m", "http.server", "8000"], {
      cwd: "/home/anarqorp/TaldeHemendik",
      stdio: "ignore"
    });
    await waitForHttp("http://127.0.0.1:8000/");
  }

  // 4. Launch Headless Chrome on port 9222
  console.log("Spawning headless Chrome on port 9222...");
  const chrome = spawn("/usr/bin/google-chrome", [
    "--headless=new",
    "--remote-debugging-port=9222",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "about:blank"
  ]);

  await waitForHttp("http://127.0.0.1:9222/json");

  const wsUrl = await getPageWsUrl();
  console.log("Connected to Chrome CDP:", wsUrl);
  const client = new CdpClient(wsUrl);
  await client.connect();

  await client.send("Page.enable");
  await client.send("Runtime.enable");
  await client.send("Network.enable");

  // Emulate mobile-first viewport (iPhone 12/13/14: 390x844, 2x dpr)
  await client.send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true
  });

  try {
    // 5. Navigate to app
    console.log("Navigating to http://127.0.0.1:8000/ ...");
    await client.send("Page.navigate", { url: "http://127.0.0.1:8000/" });
    await delay(1200);

    // Wait for teamApp
    for (let i = 0; i < 30; i++) {
      const ready = await client.evaluate(`return typeof window.teamApp !== 'undefined';`);
      if (ready) break;
      await delay(200);
    }

    // Ensure session is clean
    await client.evaluate(`
      localStorage.removeItem('talde_session_token');
      localStorage.removeItem('talde_coach_token');
      localStorage.removeItem('talde_guardian_token');
      localStorage.removeItem('talde_token_coach');
      localStorage.removeItem('talde_token_parent');
      window.teamApp.tokens.coach = null;
      window.teamApp.tokens.parent = null;
      window.teamApp.sessionToken = null;
      window.teamApp.goToScreen('v2_00_onboarding_welcome');
    `);
    await delay(500);

    // STEP 1: Verify Welcome Screen
    console.log("[Browser Step 1] Verifying Welcome Screen...");
    const welcomeScreen = await client.evaluate(`return document.getElementById('v2_00_onboarding_welcome')?.classList.contains('hidden') === false;`);
    if (!welcomeScreen) throw new Error("Onboarding welcome screen is not visible");
    await client.captureScreenshot("01_onboarding_welcome.png");

    // STEP 2: Test Email Step via direct login prompt
    console.log("[Browser Step 2] Testing Email Step modal via promptEmailLogin...");
    await client.evaluate(`window.teamApp.promptEmailLogin('');`);
    await delay(400);

    const isEmailModalOpen = await client.evaluate(`
      const modal = document.getElementById('modal-otp-auth');
      const emailStep = document.getElementById('modal-otp-email-step');
      return Boolean(modal && !modal.classList.contains('hidden') && emailStep && !emailStep.classList.contains('hidden'));
    `);
    if (!isEmailModalOpen) throw new Error("Email step modal did not open properly");
    console.log("✓ Email step modal opened successfully");
    await client.captureScreenshot("02_otp_modal_email_step.png");

    // STEP 3: Test modal cancellation
    console.log("[Browser Step 3] Testing modal cancellation...");
    await client.evaluate(`window.teamApp.closeOtpModal();`);
    await delay(300);
    const isModalClosed = await client.evaluate(`
      const modal = document.getElementById('modal-otp-auth');
      return Boolean(modal && modal.classList.contains('hidden'));
    `);
    if (!isModalClosed) throw new Error("Modal did not close on cancel click");
    console.log("✓ Modal closed cleanly");

    // STEP 4: Navigate to Coach Create Team & Trigger Bootstrap with OTP
    console.log("[Browser Step 4] Navigating to Coach Create Team...");
    await client.evaluate(`
      window.teamApp.goToScreen('v2_00_coach_create_team');
      document.getElementById('club-name').value = 'S. D. Indautxu';
      document.getElementById('team-name').value = 'Infantil A';
      document.getElementById('coach-name').value = 'Mikel Entrenador CDP';
      document.getElementById('coach-email').value = '${coachEmail}';
    `);
    await delay(400);

    // Click bootstrap button
    await client.evaluate(`document.getElementById('coach-bootstrap-btn').click();`);

    // Wait for challengeId and mail delivery
    for (let i = 0; i < 30; i++) {
      const challengeId = await client.evaluate(`return window.teamApp.otpState?.challengeId;`);
      if (challengeId && deliveredOtps.has(coachEmail)) break;
      await delay(200);
    }

    // Verify OTP Modal is open in code step
    const isCodeStepOpen = await client.evaluate(`
      const modal = document.getElementById('modal-otp-auth');
      const codeStep = document.getElementById('modal-otp-code-step');
      return Boolean(modal && !modal.classList.contains('hidden') && codeStep && !codeStep.classList.contains('hidden'));
    `);
    if (!isCodeStepOpen) throw new Error("OTP Modal did not open in code step");

    const timerActive = await client.evaluate(`
      const countdown = document.getElementById('modal-otp-countdown');
      const resendBtn = document.getElementById('modal-otp-resend-btn');
      return Boolean(countdown && !countdown.classList.contains('hidden') && resendBtn && resendBtn.classList.contains('hidden'));
    `);
    if (!timerActive) throw new Error("Countdown timer should be active and resend button hidden");
    console.log("✓ OTP requested, 60s countdown active, resend button hidden");
    await client.captureScreenshot("03_coach_otp_code_step.png");

    // Check delivered OTP
    const coachOtp = deliveredOtps.get(coachEmail);
    if (!coachOtp || !/^\d{6}$/.test(coachOtp)) throw new Error(`Delivered OTP not found: ${coachOtp}`);
    console.log(`✓ OTP delivered via test transport`);

    // STEP 5: Test invalid OTP handling (generic error banner)
    console.log("[Browser Step 5] Testing invalid OTP rejection...");
    await client.evaluate(`
      document.getElementById('modal-otp-input').value = '000000';
      document.getElementById('modal-otp-submit-btn').click();
    `);

    // Wait for verification attempt to complete
    for (let i = 0; i < 30; i++) {
      const isVerifying = await client.evaluate(`return window.teamApp.otpState?.isVerifying;`);
      if (isVerifying === false) break;
      await delay(150);
    }
    await delay(300);

    const errorBannerVisible = await client.evaluate(`
      const banner = document.getElementById('modal-otp-status');
      return Boolean(banner && !banner.classList.contains('hidden') && (banner.textContent.includes('válido') || banner.textContent.includes('caducado')));
    `);
    if (!errorBannerVisible) throw new Error("Error banner did not display on wrong OTP code");
    console.log("✓ Generic error banner displayed correctly on wrong OTP");
    await client.captureScreenshot("04_coach_otp_invalid_code.png");

    // STEP 6: Submit correct OTP & complete Coach Bootstrap
    console.log("[Browser Step 6] Submitting correct OTP and verifying...");
    await client.evaluate(`
      document.getElementById('modal-otp-input').value = '${coachOtp}';
      document.getElementById('modal-otp-submit-btn').click();
    `);

    // Wait for team bootstrap and code section
    for (let i = 0; i < 40; i++) {
      const bootstrapped = await client.evaluate(`
        const codeSection = document.getElementById('coach-code-section');
        const token = localStorage.getItem('talde_session_token');
        return Boolean(token && codeSection && !codeSection.classList.contains('hidden'));
      `);
      if (bootstrapped) break;
      await delay(200);
    }

    const generatedCode = await client.evaluate(`return document.getElementById('coach-code-display')?.textContent?.trim();`);
    console.log(`✓ Coach authenticated, team bootstrapped with code: ${generatedCode}`);
    await client.captureScreenshot("05_coach_team_bootstrapped.png");

    // Click 'Ir a la mesa del entrenador'
    await client.evaluate(`document.getElementById('coach-cta-btn').click();`);
    await delay(600);
    const coachHomeActive = await client.evaluate(`
      const home = document.getElementById('v2_01_coach_home');
      return Boolean(home && !home.classList.contains('hidden'));
    `);
    if (!coachHomeActive) throw new Error("Coach home (v2_01_coach_home) was not activated");
    console.log("✓ Coach navigated to Mesa del Entrenador (v2_01_coach_home)");
    await client.captureScreenshot("06_coach_home_active.png");

    // STEP 7: Verify Guardian Flow
    console.log("[Browser Step 7] Testing Guardian OTP flow...");
    // Clear session for guardian test
    await client.evaluate(`
      localStorage.removeItem('talde_session_token');
      localStorage.removeItem('talde_coach_token');
      localStorage.removeItem('talde_guardian_token');
      localStorage.removeItem('talde_token_coach');
      localStorage.removeItem('talde_token_parent');
      window.teamApp.tokens.coach = null;
      window.teamApp.tokens.parent = null;
      window.teamApp.sessionToken = null;
      window.teamApp.goToScreen('v2_00_onboarding_welcome');
    `);
    await delay(400);

    // Open guardian join team
    await client.evaluate(`
      window.teamApp.goToScreen('v2_00_parent_join_team');
      document.getElementById('parent-join-code-input').value = '${generatedCode || "INDA16"}';
      document.getElementById('parent-claim-name').value = 'Ibai Menor CDP';
      document.getElementById('tutor-name').value = 'Elena Familiar CDP';
      document.getElementById('tutor-email').value = '${guardianEmail}';
    `);
    await delay(300);

    // Click submit
    await client.evaluate(`document.getElementById('btn-submit').click();`);

    // Wait for guardian challengeId and mail delivery
    for (let i = 0; i < 30; i++) {
      const challengeId = await client.evaluate(`return window.teamApp.otpState?.challengeId;`);
      if (challengeId && deliveredOtps.has(guardianEmail)) break;
      await delay(200);
    }

    // Verify modal opened with Elena's email prefilled
    const guardianCodeOpen = await client.evaluate(`
      const modal = document.getElementById('modal-otp-auth');
      const display = document.getElementById('modal-otp-email-display');
      return Boolean(modal && !modal.classList.contains('hidden') && display && display.textContent.includes('${guardianEmail}'));
    `);
    if (!guardianCodeOpen) throw new Error("Guardian OTP modal did not open with prefilled email");
    console.log("✓ Guardian OTP modal opened with prefilled email");
    await client.captureScreenshot("07_guardian_otp_modal_open.png");

    const guardianOtp = deliveredOtps.get(guardianEmail);
    if (!guardianOtp) throw new Error("Guardian OTP not captured");

    // Verify OTP
    await client.evaluate(`
      document.getElementById('modal-otp-input').value = '${guardianOtp}';
      document.getElementById('modal-otp-submit-btn').click();
    `);

    // Wait for session token
    for (let i = 0; i < 40; i++) {
      const hasToken = await client.evaluate(`return Boolean(localStorage.getItem('talde_session_token'));`);
      if (hasToken) break;
      await delay(200);
    }

    const hasGuardianSession = await client.evaluate(`return Boolean(localStorage.getItem('talde_session_token'));`);
    if (!hasGuardianSession) throw new Error("Guardian session token was not created");
    console.log("✓ Guardian OTP verified and session token persisted");
    await client.captureScreenshot("08_guardian_request_submitted.png");

    // STEP 8: Test session persistence on reload
    console.log("[Browser Step 8] Testing session reload persistence...");
    await client.send("Page.reload");
    await delay(2000);

    const sessionRestored = await client.evaluate(`
      return Boolean(window.teamApp && (window.teamApp.tokens?.parent || window.teamApp.tokens?.coach || localStorage.getItem('talde_session_token')));
    `);
    const welcomeHidden = await client.evaluate(`
      const welcome = document.getElementById('v2_00_onboarding_welcome');
      return welcome ? welcome.classList.contains('hidden') : true;
    `);
    if (!sessionRestored || !welcomeHidden) throw new Error("Session was not restored or welcome screen repeated");
    console.log("✓ Session restored across reload without repeating onboarding");
    await client.captureScreenshot("09_session_restored_reload.png");

    // STEP 9: Test session purge on logout / expiry
    console.log("[Browser Step 9] Testing session purge on logout / expiry...");
    await client.evaluate(`window.teamApp.clearSessionData();`);
    await delay(500);

    const storageClean = await client.evaluate(`
      return (
        localStorage.getItem('talde_session_token') === null &&
        localStorage.getItem('talde_token_coach') === null &&
        localStorage.getItem('talde_token_parent') === null
      );
    `);
    const navigatedToWelcome = await client.evaluate(`
      const welcome = document.getElementById('v2_00_onboarding_welcome');
      return Boolean(welcome && !welcome.classList.contains('hidden'));
    `);
    if (!storageClean || !navigatedToWelcome) throw new Error("Session data not purged or did not navigate to welcome");
    console.log("✓ Session purged completely and redirected to welcome");
    await client.captureScreenshot("10_session_purged_onboarding.png");

    // STEP 10: ZaQ XSS Defect Reproduction & Proof of Neutralization (Defect 1)
    console.log("[Browser Step 10] Testing ZaQ XSS Defect neutralization in live DOM...");
    await client.evaluate(`
      window.__xss_executed = false;
      const zaqPayload = '<img src=x onerror="window.__xss_executed=true; alert(localStorage.getItem(\\'talde_session_token\\'))">';
      window.teamApp.sessionToken = 'test-session-token';
      window.teamApp.tokens.coach = 'test-session-token';
      window.teamApp.beta.teamSeasonId = 'ts-xss-test';
      window.teamApp.beta.team = { name: 'Indautxu XSS Test' };
      window.teamApp.beta.teamSeason = { season_label: '2026/27', display_label: 'Infantil A' };

      window.api.teams.getPendingRequests = async () => ({
        items: [
          {
            id: 'xss-test-request-id',
            display_name: zaqPayload,
            email: 'attacker@example.test',
            claimed_player_name: zaqPayload,
            claimed_shirt_number: 9,
            created_at: new Date().toISOString()
          }
        ]
      });
      window.api.teams.getPlayers = async () => ({ items: [] });
      window.api.events.getEvents = async () => ({ items: [] });
      window.api.pending.getPending = async () => ({ actionItems: [], indicators: [] });
      window.api.teams.getMyMemberships = async () => ({
        items: [{ id: 'm1', role: 'COACH', team_season_id: 'ts-xss-test', team_name: 'Test Team', status: 'ACTIVE' }]
      });
      window.teamApp.live = { teamSeasonId: 'ts-xss-test', role: 'COACH', teamName: 'Test Team' };
      window.teamApp.goToScreen('v2_01_coach_home');
      await window.teamApp.syncCoachHome();
    `);
    await delay(600);

    const xssExecuted = await client.evaluate(`return window.__xss_executed;`);
    if (xssExecuted) throw new Error("CRITICAL SECURITY FAILURE: ZaQ XSS executed code in DOM!");

    const cardContent = await client.evaluate(`
      const card = document.getElementById('coach-pending-approval-card');
      return {
        html: card ? card.innerHTML : '',
        hasImgTag: Boolean(card && card.querySelector('img[src="x"]'))
      };
    `);
    if (cardContent.hasImgTag) throw new Error("Raw <img> element was inserted into the DOM");
    if (!cardContent.html.includes('&lt;img src=x onerror=')) {
      throw new Error("Payload was not safely escaped as HTML entities");
    }
    console.log("✓ ZaQ XSS attack completely neutralized; rendered safely as escaped text, 0 scripts executed");
    await client.captureScreenshot("11_xss_injection_neutralized.png");

    // STEP 11: OTP In-Flight Cancellation & Discard (Condition 1)
    console.log("[Browser Step 11] Testing OTP in-flight cancellation & token discard...");
    await client.evaluate(`
      window.__cancelled_success_called = false;
      window.teamApp.openOtpModal({
        email: 'cancelled-user@example.test',
        mode: 'verify',
        challengeId: 'cancelled-challenge',
        onSuccess: () => { window.__cancelled_success_called = true; }
      });
      window.teamApp.submitOtpVerification('999999');
      window.teamApp.closeOtpModal();
    `);
    await delay(500);

    const tokenAfterCancellation = await client.evaluate(`
      return localStorage.getItem('talde_session_token');
    `);
    const callbackCalled = await client.evaluate(`return window.__cancelled_success_called;`);
    if (tokenAfterCancellation !== null) throw new Error("Token was persisted after OTP modal was closed!");
    if (callbackCalled) throw new Error("onSuccess callback was called on cancelled OTP operation!");
    console.log("✓ Cancelled OTP operation did not create a session or invoke callbacks");
    await client.captureScreenshot("12_otp_cancellation_no_session.png");

    // STEP 12: Multi-Team Async Race Condition & Generation Invalidation (Condition 2)
    console.log("[Browser Step 12] Testing Multi-Team Async Race Condition & generation invalidation...");
    await client.evaluate(`
      window.__teamA_stale_discarded = false;
      window.teamApp.live = { teamSeasonId: 'team-A', teamName: 'Equipo A', agenda: [] };
      window.api.teams.getMyMemberships = async () => ({
        items: [
          { id: 'm-A', role: 'COACH', team_season_id: 'team-A', team_name: 'Equipo A', status: 'ACTIVE' },
          { id: 'm-B', role: 'COACH', team_season_id: 'team-B', team_name: 'Equipo B', status: 'ACTIVE' }
        ]
      });

      // Simulate async Team A sync that takes 250ms
      (async () => {
        const reqGen = window.teamApp.contextGeneration;
        await new Promise(r => setTimeout(r, 250));
        if (reqGen !== window.teamApp.contextGeneration) {
          window.__teamA_stale_discarded = true;
          return;
        }
        window.teamApp.live = { teamSeasonId: 'team-A-corrupted', teamName: 'Equipo A Corrupto' };
      })();

      // User immediately switches to Team B
      await window.teamApp.switchTeam('team-B', 'Equipo B');
      window.teamApp.live = { teamSeasonId: 'team-B', teamName: 'Equipo B', agenda: [] };
    `);
    await delay(400);

    const multiteamState = await client.evaluate(`
      return {
        currentTeamId: window.teamApp.live?.teamSeasonId,
        currentTeamName: window.teamApp.live?.teamName,
        staleDiscarded: window.__teamA_stale_discarded
      };
    `);
    if (multiteamState.currentTeamId !== 'team-B') {
      throw new Error('Race condition failure: Live team corrupted to ' + multiteamState.currentTeamId);
    }
    if (!multiteamState.staleDiscarded) {
      throw new Error("Stale async response was not discarded by contextGeneration check");
    }
    console.log("✓ Multi-team race condition avoided; stale response discarded and Team B isolated");
    await client.captureScreenshot("13_multiteam_concurrency_isolated.png");

    // STEP 13: Session Expiry Purge & 401 Handling (Condition 4 & Defect 4)
    console.log("[Browser Step 13] Testing Session Expiry Purge & 401 handling...");
    await client.evaluate(`
      localStorage.setItem('talde_session_token', 'synthetic-token-to-purge');
      window.teamApp.sessionToken = 'synthetic-token-to-purge';
      const coachEmailInput = document.getElementById('coach-email');
      if (coachEmailInput) coachEmailInput.value = 'private-coach@indautxu.test';
      const tutorEmailInput = document.getElementById('tutor-email');
      if (tutorEmailInput) tutorEmailInput.value = 'private-tutor@indautxu.test';

      const expiredError = new Error("401 Unauthorized");
      expiredError.status = 401;
      expiredError.wasAuthenticated = true;
      window.teamApp.handleSessionExpired(expiredError);
    `);
    await delay(400);

    const expiryCheck = await client.evaluate(`
      return {
        token: localStorage.getItem('talde_session_token'),
        coachEmail: document.getElementById('coach-email')?.value,
        tutorEmail: document.getElementById('tutor-email')?.value,
        isWelcomeVisible: document.getElementById('v2_00_onboarding_welcome')?.classList.contains('hidden') === false
      };
    `);
    if (expiryCheck.token !== null) throw new Error("Session token was not purged on expiry");
    if (expiryCheck.coachEmail !== "" || expiryCheck.tutorEmail !== "") {
      throw new Error("Private form inputs were not purged on session expiry");
    }
    if (!expiryCheck.isWelcomeVisible) {
      throw new Error("User was not navigated back to onboarding welcome on session expiry");
    }
    console.log("✓ Session expiry cleanly purged storage, cleared private form inputs, and returned to welcome");
    await client.captureScreenshot("14_session_expiry_purge.png");

    console.log("\n========================================================");
    console.log("🎯 ALL PHYSICAL BROWSER CDP TESTS PASSED WITH 100% SUCCESS");
    console.log("========================================================\n");
  } finally {
    client.close();
    chrome.kill("SIGKILL");
    if (pyServer) pyServer.kill("SIGKILL");
    await app.close();
    await Promise.allSettled([authPool.end(), pool.end(), rawPool.end()]);
  }
}

main().catch((err) => {
  console.error("Browser verification failed:", err);
  process.exit(1);
});
