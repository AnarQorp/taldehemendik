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
  console.log("=== STARTING EVENT HUB HYDRATION VERIFICATION ===");

  // 1. Clean BETA Database with /v1/dev/empty
  const emptyRes = await fetch(`${API_BASE}/v1/dev/empty`, { method: "POST" });
  console.log("Dev empty status:", emptyRes.status);

  const wsUrl = await getPageWsUrl();
  const cdp = new CdpClient(wsUrl);
  await cdp.connect();

  console.log("Reloading page in Chrome to load fresh code...");
  await cdp.send("Page.reload");
  await delay(2000);

  // --- STEP 1: BETA NORMAL with 1 Player & 1 Event ---
  console.log("Checking BETA NORMAL mode with 1 player & 1 event...");
  await cdp.evaluate("teamApp.startBetaClean()");
  await delay(1000);
  await cdp.evaluate("teamApp.goToScreen('v2_00_coach_create_team')");
  await delay(1000);

  // Bootstrap Coach
  await cdp.evaluate(`
    (async () => {
      document.getElementById('club-name').value = 'Barakaldo CF';
      document.getElementById('team-name').value = 'Infantil A';
      document.getElementById('coach-name').value = 'Mikel Mister';
      document.getElementById('coach-email').value = 'mister@barakaldo.test';
      await teamApp.submitCoachBootstrap();
    })()
  `);
  await delay(2000);

  // Add EXACTLY 1 Player: Unai Lopez
  const playerAddRes = await cdp.evaluate(`
    (async () => {
      document.getElementById('player-firstname').value = 'Unai';
      document.getElementById('player-lastname').value = 'Lopez';
      document.getElementById('player-number').value = '10';
      document.getElementById('player-position').value = 'Centrocampista';
      await teamApp.submitAddPlayer();
      const tsId = localStorage.getItem('talde_team_season_id');
      const psRes = await api.teams.getPlayers(tsId);
      return psRes.items[0];
    })()
  `);
  console.log("Added player ID:", playerAddRes.id);
  await delay(1500);

  // Create 1 Match Event
  const createEvRes = await cdp.evaluate(`
    (async () => {
      const coachToken = localStorage.getItem('talde_token_coach');
      const tsId = localStorage.getItem('talde_team_season_id');
      const res = await fetch('${API_BASE}/v1/team-seasons/' + tsId + '/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + coachToken },
        body: JSON.stringify({
          type: 'MATCH',
          title: 'Partido de Liga vs Santutxu',
          startsAt: '2026-10-20T10:00:00.000Z',
          arrivalAt: '2026-10-20T09:15:00.000Z',
          location: 'Campo de Lasesarre',
          notes: '1ª Equipación Oficial',
          availabilityEnabled: true,
          callupEnabled: true
        })
      });
      return await res.json();
    })()
  `);
  console.log("Created event ID:", createEvRes.id);
  await delay(1200);

  // Set active event ID and navigate to Event Hub
  const syncNavRes = await cdp.evaluate(`
    (async () => {
      try {
        teamApp.currentRole = 'coach';
        teamApp.beta.activeEventId = '${createEvRes.id}';
        localStorage.setItem('talde_active_event_id', '${createEvRes.id}');
        await teamApp.goToScreen('v2_05_event_hub_normal', 'agenda');
        return { success: true, activeEvId: teamApp.beta.activeEventId, appMode: teamApp.appMode };
      } catch (e) {
        return { error: e.message, stack: e.stack };
      }
    })()
  `);
  console.log("Nav to Event Hub result:", JSON.stringify(syncNavRes));
  await delay(1500);
  await cdp.captureScreenshot("v5_01_beta_1player_event_hub.png");

  // Read Hub Values
  const heroTitle = await cdp.evaluate(`document.getElementById('hub-hero-title')?.innerText`);
  const progressHeader = await cdp.evaluate(`document.getElementById('hub-progress-header')?.innerText`);
  const dispCount = await cdp.evaluate(`document.getElementById('hub-count-disponibles')?.innerText`);
  const bajasCount = await cdp.evaluate(`document.getElementById('hub-count-bajas')?.innerText`);
  const pendCount = await cdp.evaluate(`document.getElementById('hub-count-pendientes')?.innerText`);
  const pendingNamesText = await cdp.evaluate(`document.getElementById('hub-pending-names')?.innerText`);
  const callupBadgeText = await cdp.evaluate(`document.getElementById('hub-callup-phase-badge')?.innerText`);
  const callupBtnText = await cdp.evaluate(`document.getElementById('hub-callup-btn-text')?.innerText`);
  const nudgeHidden = await cdp.evaluate(`document.getElementById('hub-btn-nudge')?.classList.contains('hidden')`);
  const sendNoticeHidden = await cdp.evaluate(`document.getElementById('hub-btn-send-notice')?.classList.contains('hidden')`);

  console.log("BETA Hub Verification:");
  console.log("- Hero Title:", heroTitle);
  console.log("- Progress Header:", progressHeader);
  console.log("- Counts (Disp / Bajas / Pend):", dispCount, "/", bajasCount, "/", pendCount);
  console.log("- Pending Names Text:", pendingNamesText);
  console.log("- Callup Badge:", callupBadgeText);
  console.log("- Callup Button Text:", callupBtnText);
  console.log("- Communication Buttons Hidden (Nudge / Notice):", nudgeHidden, "/", sendNoticeHidden);

  if (heroTitle.includes("Indautxu")) {
    throw new Error("BETA Hub failed: Hero title leaked Indautxu!");
  }
  if (pendingNamesText.includes("Ane Mintegi") || pendingNamesText.includes("Peio")) {
    throw new Error("BETA Hub failed: Pending names leaked Indautxu demo players (Ane/Peio)!");
  }
  if (!progressHeader.includes("1 jugador")) {
    throw new Error(`BETA Hub failed: Progress header expected '1 jugador', got '${progressHeader}'!`);
  }
  if (dispCount !== "0" || bajasCount !== "0" || pendCount !== "1") {
    throw new Error(`BETA Hub failed: Counts expected 0/0/1, got ${dispCount}/${bajasCount}/${pendCount}!`);
  }
  if (!callupBadgeText.includes("Convocatoria Pendiente")) {
    throw new Error(`BETA Hub failed: Callup badge expected 'Convocatoria Pendiente', got '${callupBadgeText}'!`);
  }
  if (!callupBtnText.includes("Preparar convocatoria")) {
    throw new Error(`BETA Hub failed: Callup button text expected 'Preparar convocatoria', got '${callupBtnText}'!`);
  }
  if (!nudgeHidden || !sendNoticeHidden) {
    throw new Error("BETA Hub failed: Unbacked communication buttons should be hidden in BETA!");
  }

  // --- STEP 2: Register Staff Availability (Authorized API) & Publish Callup ---
  console.log("Registering staff availability for Unai Lopez (STAFF_RECORDED)...");
  await cdp.evaluate(`
    (async () => {
      await api.availability.setStaffAvailability('${createEvRes.id}', '${playerAddRes.id}', {
        status: 'CAN_ATTEND',
        expectedVersion: 0,
        note: 'Registrado por entrenador en BETA'
      });
      await teamApp.syncEventHubNormal();
    })()
  `);
  await delay(1200);

  const postAvailDispCount = await cdp.evaluate(`document.getElementById('hub-count-disponibles')?.innerText`);
  console.log("Post-staff availability Disponibles count:", postAvailDispCount);
  if (postAvailDispCount !== "1") {
    throw new Error(`BETA Hub failed: Post-staff availability expected 1 disponible, got ${postAvailDispCount}!`);
  }

  // Click 'Preparar convocatoria' -> Navigates to screen_e_create_squad -> Execute Publish
  console.log("Executing Callup preparation & publication from squad screen...");
  await cdp.evaluate(`
    (async () => {
      await teamApp.handlePrepareCallup('${createEvRes.id}');
    })()
  `);
  await delay(1200);

  await cdp.evaluate(`
    (async () => {
      await teamApp.executePublishCallupFromSquad();
    })()
  `);
  await delay(1500);

  await cdp.captureScreenshot("v5_02_beta_1player_callup_published.png");

  const pubBadgeText = await cdp.evaluate(`document.getElementById('hub-callup-phase-badge')?.innerText`);
  const pubBtnText = await cdp.evaluate(`document.getElementById('hub-callup-btn-text')?.innerText`);
  console.log("Post-publish Callup Badge:", pubBadgeText);
  console.log("Post-publish Callup Button Text:", pubBtnText);

  if (!pubBadgeText.includes("Convocatoria Publicada")) {
    throw new Error(`BETA Hub failed: Post-publish badge expected 'Convocatoria Publicada', got '${pubBadgeText}'!`);
  }

  // --- STEP 3: DEMO Mode Verification with startDemoMode ---
  console.log("Transitioning to DEMO mode via teamApp.startDemoMode()...");
  await cdp.evaluate(`(async () => { await teamApp.startDemoMode(); })()`);
  await delay(1500);
  await cdp.evaluate(`(async () => { await teamApp.goToScreen('v2_05_event_hub_normal', 'agenda'); })()`);
  await delay(1500);
  await cdp.captureScreenshot("v5_03_demo_indautxu_event_hub.png");

  const demoTitle = await cdp.evaluate(`document.getElementById('hub-hero-title')?.innerText`);
  const demoPendingNames = await cdp.evaluate(`document.getElementById('hub-pending-names')?.innerText`);
  const demoDispCount = await cdp.evaluate(`document.getElementById('hub-count-disponibles')?.innerText`);
  const demoBajasCount = await cdp.evaluate(`document.getElementById('hub-count-bajas')?.innerText`);
  const demoPendCount = await cdp.evaluate(`document.getElementById('hub-count-pendientes')?.innerText`);

  console.log("DEMO Hub Title:", demoTitle);
  console.log("DEMO Pending Names:", demoPendingNames);
  console.log("DEMO Counts (Disp / Bajas / Pend):", demoDispCount, "/", demoBajasCount, "/", demoPendCount);

  if (!demoTitle.includes("Indautxu")) {
    throw new Error("DEMO Hub failed: Hero title missing Indautxu!");
  }
  if (!demoPendingNames.includes("aún no han respondido al aviso")) {
    throw new Error(`DEMO Hub failed: Pending names expected pending text, got '${demoPendingNames}'!`);
  }
  if (demoDispCount !== "14" || demoBajasCount !== "2" || demoPendCount !== "2") {
    throw new Error(`DEMO Hub failed: DEMO counts expected 14/2/2, got ${demoDispCount}/${demoBajasCount}/${demoPendCount}!`);
  }

  cdp.close();
  console.log("=== EVENT HUB HYDRATION VERIFICATION COMPLETED SUCCESSFULLY ===");
}

runVerification().catch(err => {
  console.error("VERIFICATION FAILED:", err);
  process.exit(1);
});
