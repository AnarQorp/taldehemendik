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
  console.log("=== STARTING PHYSICAL VERIFICATION OF 4 ISSUES ===");

  const resetRes = await fetch(`${API_BASE}/v1/dev/reset`, { method: "POST" });
  console.log("Dev reset status:", resetRes.status);

  const wsUrl = await getPageWsUrl();
  const cdp = new CdpClient(wsUrl);
  await cdp.connect();

  await cdp.send("Page.navigate", { url: "http://127.0.0.1:8000/" });
  await delay(1000);

  // Step 1: Start BETA clean mode and go to coach creation screen
  await cdp.evaluate("teamApp.startBetaClean()");
  await delay(1000);
  await cdp.evaluate("teamApp.goToScreen('v2_00_coach_create_team')");
  await delay(1000);

  // Bootstrap Coach
  const coachCtx = await cdp.evaluate(`
    (async () => {
      document.getElementById('club-name').value = 'Barakaldo CF';
      document.getElementById('team-name').value = 'Infantil A';
      document.getElementById('coach-name').value = 'Mikel Mister';
      document.getElementById('coach-email').value = 'mister@barakaldo.test';
      await teamApp.submitCoachBootstrap();
      return { coachToken: localStorage.getItem('talde_token_coach'), tsId: localStorage.getItem('talde_team_season_id') };
    })()
  `);
  const { coachToken, tsId } = coachCtx;
  console.log("Captured coachToken:", coachToken ? "PRESENT" : "MISSING", "tsId:", tsId);
  await delay(2000);
  await cdp.captureScreenshot("v4_01_coach_bootstrapped.png");

  // Add Player 1: Gorka
  await cdp.evaluate(`
    (async () => {
      document.getElementById('player-firstname').value = 'Gorka';
      document.getElementById('player-lastname').value = 'Guruzeta';
      document.getElementById('player-number').value = '9';
      document.getElementById('player-position').value = 'Delantero';
      await teamApp.submitAddPlayer();
    })()
  `);
  await delay(1500);

  // Add Player 2: Mikel
  await cdp.evaluate(`
    (async () => {
      document.getElementById('player-firstname').value = 'Mikel';
      document.getElementById('player-lastname').value = 'Vesga';
      document.getElementById('player-number').value = '6';
      document.getElementById('player-position').value = 'Centrocampista';
      await teamApp.submitAddPlayer();
    })()
  `);
  await delay(1500);
  await cdp.captureScreenshot("v4_02_players_added.png");

  const playersInBeta = await cdp.evaluate(`JSON.stringify(teamApp.beta.players)`);
  console.log("Players in teamApp.beta.players:", playersInBeta);

  const gorkaPlayerId = await cdp.evaluate(`
    teamApp.beta.players.find(p => p.firstName === 'Gorka' || p.first_name === 'Gorka' || p.player?.first_name === 'Gorka')?.id ||
    teamApp.beta.players.find(p => p.firstName === 'Gorka' || p.first_name === 'Gorka' || p.player?.first_name === 'Gorka')?.player?.id
  `);
  console.log("Gorka player ID:", gorkaPlayerId);
  if (!gorkaPlayerId) throw new Error("Could not find Gorka player ID!");

  const inviteResult = await cdp.evaluate(`
    (async () => {
      try {
        await teamApp.openPlayerInviteModal('${gorkaPlayerId}', 'Gorka');
        return teamApp.beta.lastInvitation || { error: 'lastInvitation is empty' };
      } catch(e) {
        return { error: e.message };
      }
    })()
  `);
  console.log("Invite result:", JSON.stringify(inviteResult));
  const inviteToken = inviteResult?.token;
  console.log("Generated invite token for Gorka:", inviteToken);

  // Open tutor session via URL
  await cdp.send("Page.navigate", { url: `http://127.0.0.1:8000/?inviteToken=${inviteToken}` });
  await delay(2500);

  for (let i = 0; i < 20; i++) {
    const ready = await cdp.evaluate(`typeof window.teamApp !== 'undefined'`);
    if (ready) break;
    await delay(300);
  }

  const submitJoinRes = await cdp.evaluate(`
    (async () => {
      try {
        if ('${inviteToken}') {
          await teamApp.setupIndividualInvite('${inviteToken}');
        }
        if (document.getElementById('tutor-name')) document.getElementById('tutor-name').value = 'Amaia Guruzeta';
        if (document.getElementById('tutor-email')) document.getElementById('tutor-email').value = 'amaia@barakaldo.test';
        await teamApp.submitParentJoinRequest();
        return { success: true, verified: teamApp.beta.verifiedInvitation };
      } catch (err) {
        return { error: err.message, stack: err.stack };
      }
    })()
  `);
  console.log("DEBUG submitParentJoinRequest result:", JSON.stringify(submitJoinRes, null, 2));
  await delay(2000);
  await cdp.captureScreenshot("v4_03_tutor_request_sent.png");

  // Switch to Coach to approve
  const reqDebug = await cdp.evaluate(`
    (async () => {
      const res = await fetch('${API_BASE}/v1/team-seasons/${tsId}/guardian-link-requests', {
        headers: { Authorization: 'Bearer ${coachToken}' }
      });
      const data = await res.json();
      return { status: res.status, data, reqId: data.items ? data.items[0]?.id : null };
    })()
  `);
  console.log("DEBUG Pending Request Fetch:", JSON.stringify(reqDebug, null, 2));
  const reqId = reqDebug?.reqId;
  console.log("Pending request ID:", reqId);

  const approveRes = await cdp.evaluate(`
    (async () => {
      try {
        api.client.setToken('${coachToken}');
        const res = await api.teams.approveGuardianRequest('${reqId}', null);
        return res;
      } catch (e) {
        return { error: e.message };
      }
    })()
  `);
  console.log("Approve result:", JSON.stringify(approveRes));
  await delay(1500);
  await cdp.captureScreenshot("v4_04_coach_approved.png");

  // Switch back to Tutor
  await cdp.evaluate(`await teamApp.switchMembership('parent')`);
  await delay(1200);
  await cdp.captureScreenshot("v4_05_tutor_home_gorka.png");

  // --- CHECK ISSUE 3: Tutor Re-entry ---
  console.log("Checking Issue 3: Tutor Re-entry...");
  await cdp.evaluate(`teamApp.goToScreen('v2_00_onboarding_welcome')`);
  await delay(1000);
  await cdp.captureScreenshot("v4_06_tutor_at_welcome.png");

  const parentAuthDebug = await cdp.evaluate(`
    (async () => {
      const parentToken = teamApp.tokens.parent || localStorage.getItem("talde_token_parent");
      api.client.setToken(parentToken);
      const mems = await api.teams.getMyMemberships();
      return { parentToken, mems };
    })()
  `);
  console.log("Parent Auth Debug:", JSON.stringify(parentAuthDebug));

  const handleParentRes = await cdp.evaluate(`
    (async () => {
      try {
        await teamApp.handleParentAccess();
        return { currentScreen: teamApp.currentScreen, guardianPlayer: teamApp.beta.guardianPlayer };
      } catch (e) {
        return { error: e.message };
      }
    })()
  `);
  console.log("handleParentAccess result:", JSON.stringify(handleParentRes));
  const screenAfterClick = await cdp.evaluate(`teamApp.currentScreen`);
  console.log("Screen after clicking Familia card:", screenAfterClick);
  if (screenAfterClick !== "v2_07_parent_home") {
    throw new Error(`Issue 3 failed: expected v2_07_parent_home, got ${screenAfterClick}`);
  }
  await cdp.captureScreenshot("v4_07_tutor_reentered_home.png");

  // --- CHECK ISSUE 1: Familia -> Jugador (v2_04_player_detail) ---
  console.log("Checking Issue 1: Familia -> Jugador clean view...");
  await cdp.evaluate(`teamApp.goToScreen('v2_04_player_detail', 'hijos')`);
  await delay(1500);
  await cdp.captureScreenshot("v4_08_player_detail_gorka_clean.png");

  const parentContainerText = await cdp.evaluate(`document.getElementById('player-detail-parent-container').innerText`);
  const demoContainerHidden = await cdp.evaluate(`document.getElementById('player-detail-demo-container').classList.contains('hidden')`);
  const coachBarHidden = await cdp.evaluate(`document.getElementById('player-detail-coach-bar').classList.contains('hidden')`);
  console.log("Demo container hidden:", demoContainerHidden);
  console.log("Coach bar hidden:", coachBarHidden);
  console.log("Parent container text snippet:", parentContainerText.slice(0, 150));

  if (!demoContainerHidden || !coachBarHidden) {
    throw new Error("Issue 1 failed: demo container or coach bar is not hidden for parent!");
  }
  if (parentContainerText.includes("esguince") || parentContainerText.includes("Indautxu") || parentContainerText.includes("Fisioterapia")) {
    throw new Error("Issue 1 failed: leak of legacy demo/medical data into parent view!");
  }

  // --- CHECK ISSUE 4: Event vs Callup (Pending & Published State) ---
  console.log("Checking Issue 4: Event vs Callup...");

  // Coach creates event
  await cdp.evaluate(`teamApp.switchMembership('coach')`);
  await delay(1000);
  await cdp.evaluate(`
    (async () => {
      const coachToken = localStorage.getItem('talde_token_coach');
      const tsId = localStorage.getItem('talde_team_season_id');
      await fetch('${API_BASE}/v1/team-seasons/' + tsId + '/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + coachToken },
        body: JSON.stringify({
          type: 'MATCH',
          title: 'Partido de Liga vs Indautxu',
          startsAt: '2026-10-15T10:00:00.000Z',
          arrivalAt: '2026-10-15T09:15:00.000Z',
          location: 'Campo de Lasesarre',
          notes: 'Traer equipación oficial',
          availabilityEnabled: true,
          callupEnabled: true
        })
      });
    })()
  `);
  await delay(1200);

  // Coach views agenda -> sees "Convocatoria pendiente" & "Publicar convocatoria"
  await cdp.evaluate(`teamApp.goToScreen('v2_02_coach_agenda', 'agenda')`);
  await delay(1500);
  await cdp.captureScreenshot("v4_09_coach_agenda_callup_pending.png");

  // Tutor views home / player detail -> sees "Convocatoria pendiente" (NEVER "No convocado")
  await cdp.evaluate(`teamApp.switchMembership('parent')`);
  await delay(1500);
  await cdp.captureScreenshot("v4_10_tutor_home_callup_pending.png");

  await cdp.evaluate(`teamApp.goToScreen('v2_04_player_detail', 'hijos')`);
  await delay(1500);
  await cdp.captureScreenshot("v4_11_tutor_player_detail_callup_pending.png");

  const pendingBadgeText = await cdp.evaluate(`document.getElementById('player-detail-parent-container').innerText`);
  if (!pendingBadgeText.includes("Convocatoria pendiente")) {
    throw new Error("Issue 4 failed: Tutor does not see 'Convocatoria pendiente' before publication!");
  }
  if (pendingBadgeText.includes("No convocado")) {
    throw new Error("Issue 4 failed: Tutor incorrectly sees 'No convocado' before callup is published!");
  }

  // Coach prepares and publishes callup
  await cdp.evaluate(`teamApp.switchMembership('coach')`);
  await delay(1000);
  const publishRes = await cdp.evaluate(`
    (async () => {
      try {
        const coachToken = localStorage.getItem('talde_token_coach');
        api.client.setToken(coachToken);
        const tsId = teamApp.beta.teamSeasonId;
        const evsRes = await api.events.getEvents(tsId);
        const ev = (evsRes.items || [])[0];
        const playersRes = await api.teams.getPlayers(tsId);
        const playerIds = (playersRes.items || []).map(p => p.id);

        let draft;
        try {
          draft = await api.callup.createDraft(ev.id, playerIds);
        } catch(e) {
          const existing = await api.callup.getCallup(ev.callup_id);
          draft = await api.callup.updateDraft(ev.callup_id, { playerIds, expectedVersion: existing.version });
        }
        const confirmKeys = (draft.warnings || []).map(w => w.key);
        const published = await api.callup.publishCallup(draft.id, { expectedVersion: draft.version, confirmWarnings: confirmKeys }, 'pub-1');
        return { draft, published };
      } catch (e) {
        return { error: e.message };
      }
    })()
  `);
  console.log("Publish result:", JSON.stringify(publishRes));
  await delay(2000);
  await cdp.evaluate(`teamApp.goToScreen('v2_02_coach_agenda', 'agenda')`);
  await delay(1200);
  await cdp.captureScreenshot("v4_12_coach_agenda_callup_published.png");

  // Tutor re-checks home & player detail -> sees "✓ Convocado"
  await cdp.evaluate(`teamApp.switchMembership('parent')`);
  await delay(1500);
  await cdp.captureScreenshot("v4_13_tutor_home_callup_published.png");

  await cdp.evaluate(`teamApp.goToScreen('v2_04_player_detail', 'hijos')`);
  await delay(1500);
  await cdp.captureScreenshot("v4_14_tutor_player_detail_callup_published.png");

  const publishedBadgeText = await cdp.evaluate(`document.getElementById('player-detail-parent-container').innerText`);
  console.log("Published badge text snippet:", publishedBadgeText);
  if (!publishedBadgeText.includes("Convocado")) {
    throw new Error("Issue 4 failed: Tutor does not see 'Convocado' after callup publication!");
  }

  // --- CHECK ISSUE 2: Avisos empty state without fake FAB ---
  console.log("Checking Issue 2: Avisos clean empty state without fake FAB...");
  await cdp.evaluate(`teamApp.goToScreen('screen_k_notices', 'avisos')`);
  await delay(1200);
  await cdp.captureScreenshot("v4_15_avisos_empty_no_fab.png");

  const fabHidden = await cdp.evaluate(`document.getElementById('notices-coach-fab').classList.contains('hidden')`);
  console.log("FAB hidden in Avisos:", fabHidden);
  if (!fabHidden) {
    throw new Error("Issue 2 failed: + Nuevo aviso FAB is not hidden!");
  }

  cdp.close();
  console.log("=== PHYSICAL VERIFICATION COMPLETED SUCCESSFULLY ===");
}

runVerification().catch(err => {
  console.error("VERIFICATION FAILED:", err);
  process.exit(1);
});
