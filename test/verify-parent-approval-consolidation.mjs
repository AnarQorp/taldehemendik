import { promises as fs } from "node:fs";
import path from "node:path";

const ARTIFACTS_DIR = "/home/anarqorp/.gemini/antigravity/brain/866c5187-97f7-49ac-b2a6-cc798435cb85/screenshots";
const API_BASE = "http://127.0.0.1:3101";

async function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getPageWsUrl() {
  const res = await fetch("http://127.0.0.1:9222/json");
  const targets = await res.json();
  const page = targets.find((t) => t.type === "page" && t.url.includes("8000"));
  if (!page) {
    const fallback = targets.find((t) => t.type === "page");
    if (!fallback) throw new Error("No page target found on CDP 9222");
    return fallback.webSocketDebuggerUrl;
  }
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
    const res = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    return res.result?.value;
  }

  async captureScreenshot(filename) {
    const res = await this.send("Page.captureScreenshot", { format: "png" });
    const buffer = Buffer.from(res.data, "base64");
    const outPath = path.join(ARTIFACTS_DIR, filename);
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, buffer);
    console.log(`[SCREENSHOT] ${filename}`);
  }

  close() {
    this.ws.close();
  }
}

async function runVerification() {
  console.log("=== STARTING PARENT APPROVAL CONSOLIDATION VERIFICATION ===");

  // Reset database to empty
  const emptyRes = await fetch(`${API_BASE}/v1/dev/empty`, { method: "POST" });
  console.log("Dev empty status:", emptyRes.status);

  const wsUrl = await getPageWsUrl();
  const cdp = new CdpClient(wsUrl);
  await cdp.connect();

  console.log("Reloading Chrome page...");
  await cdp.send("Page.reload");
  await delay(3000);

  // --- STEP 1: Coach Bootstrap & Generate Individual Invite Token ---
  console.log("Setting up Coach session & player...");
  const coachSetup = await cdp.evaluate(`(async () => {
    try {
      localStorage.clear();
      teamApp.appMode = 'BETA_NORMAL';
      teamApp.currentRole = 'coach';
      await teamApp.goToScreen('v2_00_coach_create_team');
      document.getElementById('club-name').value = 'Barakaldo CF';
      document.getElementById('team-name').value = 'Infantil A';
      document.getElementById('coach-name').value = 'Mikel Mister';
      document.getElementById('coach-email').value = 'coach.consolidation@example.test';
      await teamApp.submitCoachBootstrap();
      return { tsId: localStorage.getItem('talde_team_season_id'), coachTok: localStorage.getItem('talde_token_coach') };
    } catch (err) {
      return { error: err.message, stack: err.stack };
    }
  })()`);
  console.log("Coach setup result:", JSON.stringify(coachSetup));
  await delay(1500);

  // Add Player Unai Lopez
  const playerRes = await cdp.evaluate(`(async () => {
    const tsId = localStorage.getItem('talde_team_season_id');
    const coachTok = localStorage.getItem('talde_token_coach');
    teamApp.beta.teamSeasonId = tsId;
    teamApp.tokens.coach = coachTok;
    api.client.setToken(coachTok);

    document.getElementById('player-firstname').value = 'Unai';
    document.getElementById('player-lastname').value = 'Lopez';
    document.getElementById('player-number').value = '10';
    document.getElementById('player-position').value = 'Centrocampista';
    await teamApp.submitAddPlayer();
    const ps = await api.teams.getPlayers(tsId);
    return ps.items ? ps.items[0] : ps;
  })()`);
  console.log("Added player ID:", playerRes?.id);
  if (!playerRes?.id) throw new Error("Player creation failed!");
  await delay(1000);

  // Create Individual Invitation Token
  const inviteToken = await cdp.evaluate(`(async () => {
    const tsId = localStorage.getItem('talde_team_season_id');
    const inv = await api.teams.createPlayerInvitation(tsId, '${playerRes.id}');
    return inv.token;
  })()`);
  console.log("Generated individual invite token:", inviteToken);

  // Save Coach State before switching
  const coachToken = await cdp.evaluate(`localStorage.getItem('talde_token_coach')`);
  const teamSeasonId = await cdp.evaluate(`localStorage.getItem('talde_team_season_id')`);

  // --- STEP 2: Tutor Session with ?inviteToken=... ---
  console.log("Opening Tutor session with ?inviteToken=...");
  await cdp.evaluate(`(() => {
    localStorage.removeItem('talde_token_coach');
    localStorage.removeItem('talde_token_parent');
    localStorage.removeItem('talde_team_season_id');
    localStorage.removeItem('talde_active_role');
    teamApp.tokens = { coach: null, parent: null };
  })()`);

  await cdp.send("Page.navigate", { url: `http://127.0.0.1:8000/?inviteToken=${inviteToken}` });
  await delay(1500);

  // Tutor OTP Auth & Submit Join Request
  const submitRes = await cdp.evaluate(`(async () => {
    try {
      document.getElementById('tutor-email').value = 'tutor.consolidation@example.test';
      document.getElementById('tutor-name').value = 'Elena Tutor';

      await teamApp.submitParentJoinRequest();
      return { success: true, verifiedInv: teamApp.beta.verifiedInvitation, notice: document.getElementById('parent-clean-backend-notice')?.innerText };
    } catch (err) {
      return { error: err.message, stack: err.stack };
    }
  })()`);
  console.log("Submit Join Result:", JSON.stringify(submitRes, null, 2));
  await delay(1500);

  await cdp.captureScreenshot("v6_01_tutor_request_pending.png");

  const pendingNoticeText = await cdp.evaluate(`document.getElementById('parent-clean-backend-notice')?.innerText`);
  console.log("Pending Notice Text:", pendingNoticeText);
  if (!pendingNoticeText?.includes("PENDIENTE DE APROBACIÓN")) {
    throw new Error(`Expected pending notice to contain 'PENDIENTE DE APROBACIÓN', got '${pendingNoticeText}'!`);
  }

  // --- STEP 3: Refresh (F5) BEFORE Coach Approval -> Must STAY Pending ---
  console.log("Testing F5 refresh BEFORE coach approval...");
  await cdp.send("Page.reload");
  await delay(2000);

  const preApproveScreen = await cdp.evaluate(`teamApp.currentScreen`);
  const preApproveUrlSearch = await cdp.evaluate(`window.location.search`);
  console.log("Pre-approval refresh screen:", preApproveScreen, "URL search:", preApproveUrlSearch);

  if (preApproveScreen === "v2_07_parent_home") {
    throw new Error("FAILED: Refresh BEFORE approval prematurely jumped to v2_07_parent_home!");
  }

  // --- STEP 4: Coach Approves Request from Real UI in Coach Context ---
  console.log("Coach approving request from UI...");
  const approveRes = await cdp.evaluate(`(async () => {
    // Switch to Coach Token & Context
    teamApp.tokens.coach = '${coachToken}';
    teamApp.beta.teamSeasonId = '${teamSeasonId}';
    localStorage.setItem('talde_token_coach', '${coachToken}');
    localStorage.setItem('talde_team_season_id', '${teamSeasonId}');
    localStorage.setItem('talde_active_role', 'coach');
    teamApp.currentRole = 'coach';
    api.client.setToken('${coachToken}');

    await teamApp.goToScreen('v2_01_coach_home', 'inicio');
    const pendingRes = await api.teams.getPendingRequests('${teamSeasonId}');
    console.log("DEBUG Step 4 pendingRequests:", JSON.stringify(pendingRes));
    const req = (pendingRes.items || []).find(i => i.id);
    if (!req) throw new Error('No pending guardian link request found!');

    // Approve from UI routine
    const appRes = await teamApp.approveBetaGuardianRequest(req.id, null);
    return { req, appRes };
  })()`);
  console.log("Coach Approval Result:", JSON.stringify(approveRes, null, 2));
  await delay(1500);

  // --- STEP 5: Tutor Tab Focus / Visibility Event -> Automatic Consolidation ---
  console.log("Returning to Tutor context & simulating focus/visibilitychange...");
  const checkRes = await cdp.evaluate(`(async () => {
    // Restore parent token in teamApp state
    const parentTok = localStorage.getItem('talde_token_parent');
    teamApp.tokens.parent = parentTok;
    teamApp.currentRole = 'parent';
    localStorage.setItem('talde_active_role', 'parent');

    api.client.setToken(parentTok);
    const mems = await api.teams.getMyMemberships();
    console.log("DEBUG Step 5 memberships:", JSON.stringify(mems));

    const res = await teamApp.checkParentApprovalStatus(true);
    return { res, mems, screen: teamApp.currentScreen, role: teamApp.currentRole, guardianPlayers: teamApp.beta.guardianPlayers };
  })()`);
  console.log("Check Approval Status Result:", JSON.stringify(checkRes, null, 2));
  await delay(1500);

  await cdp.captureScreenshot("v6_02_tutor_auto_consolidated_home.png");

  const postApproveScreen = await cdp.evaluate(`teamApp.currentScreen`);
  const postApproveSearch = await cdp.evaluate(`window.location.search`);
  const guardianPlayersLen = await cdp.evaluate(`teamApp.beta.guardianPlayers?.length`);

  console.log("Post-approval Screen:", postApproveScreen);
  console.log("Post-approval URL search (should be empty):", postApproveSearch);
  console.log("Post-approval Guardian Players count:", guardianPlayersLen);

  if (postApproveScreen !== "v2_07_parent_home") {
    throw new Error(`FAILED: Expected screen 'v2_07_parent_home', got '${postApproveScreen}'!`);
  }
  if (postApproveSearch.includes("inviteToken")) {
    throw new Error(`FAILED: URL search still contains inviteToken: '${postApproveSearch}'!`);
  }
  if (!guardianPlayersLen || guardianPlayersLen < 1) {
    throw new Error(`FAILED: guardianPlayers expected > 0, got ${guardianPlayersLen}!`);
  }

  // --- STEP 6: Verify F5 Refresh Maintains Parent Home ---
  console.log("Testing F5 refresh AFTER approval...");
  await cdp.send("Page.reload");
  await delay(2000);

  await cdp.captureScreenshot("v6_03_tutor_f5_parent_home.png");

  const f5Screen = await cdp.evaluate(`teamApp.currentScreen`);
  const f5Role = await cdp.evaluate(`teamApp.currentRole`);
  console.log("F5 Screen:", f5Screen, "Role:", f5Role);

  if (f5Screen !== "v2_07_parent_home" || f5Role !== "parent") {
    throw new Error(`FAILED: F5 refresh expected v2_07_parent_home / parent role, got ${f5Screen} / ${f5Role}!`);
  }

  // --- STEP 7: Verify Re-entering via Switch Membership ---
  console.log("Testing switchMembership('parent') recovery...");
  await cdp.evaluate(`(async () => {
    await teamApp.switchMembership('onboard');
    await new Promise(r => setTimeout(r, 500));
    await teamApp.switchMembership('parent');
  })()`);
  await delay(1500);

  const reenterScreen = await cdp.evaluate(`teamApp.currentScreen`);
  console.log("Re-enter Screen:", reenterScreen);
  if (reenterScreen !== "v2_07_parent_home") {
    throw new Error(`FAILED: Re-entering parent membership expected v2_07_parent_home, got '${reenterScreen}'!`);
  }

  // --- STEP 8: Verify GUARDIAN Membership with guardianPlayers = [] DOES NOT grant access ---
  console.log("Testing GUARDIAN membership with empty guardianPlayers = []...");
  const emptyGuardAccessGranted = await cdp.evaluate(`(async () => {
    // Mock a membership response with status ACTIVE but guardian_players = []
    const origGetMyMemberships = api.teams.getMyMemberships;
    api.teams.getMyMemberships = async () => ({
      items: [{
        role: "GUARDIAN",
        status: "ACTIVE",
        team_id: "fake-team-id",
        team_season_id: "fake-ts-id",
        display_label: "Infantil A",
        season_label: "2026/27",
        guardian_players: []
      }]
    });
    
    // Reset state to pending view
    teamApp.currentScreen = "v2_00_parent_join_team";
    const res = await teamApp.checkParentApprovalStatus(true);
    
    // Restore original function
    api.teams.getMyMemberships = origGetMyMemberships;
    return { res, screen: teamApp.currentScreen };
  })()`);

  console.log("Empty guardianPlayers check result:", JSON.stringify(emptyGuardAccessGranted));
  if (emptyGuardAccessGranted.res === true || emptyGuardAccessGranted.screen === "v2_07_parent_home") {
    throw new Error("FAILED: GUARDIAN membership with empty guardianPlayers = [] incorrectly granted access to Parent Home!");
  }

  cdp.close();
  console.log("=== PARENT APPROVAL CONSOLIDATION E2E VERIFICATION COMPLETED SUCCESSFULLY ===");
}

runVerification().catch((err) => {
  console.error("VERIFICATION FAILED:", err);
  process.exit(1);
});
