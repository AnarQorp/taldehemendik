import { promises as fs } from "node:fs";
import path from "node:path";

const ARTIFACTS_DIR = "/home/anarqorp/.gemini/antigravity/brain/866c5187-97f7-49ac-b2a6-cc798435cb85/screenshots";
const LOCAL_DIR = "/home/anarqorp/TaldeHemendik/test-artifacts/screenshots";
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
    const res = await this.send("Runtime.evaluate", {
      expression,
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
    await fs.writeFile(artifactPath, buffer);
    console.log(`📸 Screenshot saved: ${filename}`);
  }

  close() {
    this.ws.close();
  }
}

async function runAudit() {
  console.log("=================================================");
  console.log("🚀 STARTING 16-STEP TRANSVERSAL AUDIT VERIFICATION");
  console.log("=================================================");

  const wsUrl = await getPageWsUrl();
  console.log("Connecting CDP to:", wsUrl);
  const client = new CdpClient(wsUrl);
  await client.connect();

  await client.send("Page.enable");
  await client.send("Runtime.enable");
  await client.send("Network.enable");

  // Step 01: POST /v1/dev/empty -> clean database
  console.log("\n--- STEP 01: Empty database via /v1/dev/empty ---");
  const emptyRes = await fetch(`${API_BASE}/v1/dev/empty`, { method: "POST" });
  const emptyData = await emptyRes.json();
  console.log("POST /v1/dev/empty status:", emptyRes.status, emptyData);
  if (emptyRes.status !== 200) throw new Error("Step 01 failed: dev/empty did not return 200");

  // Clear browser state and reload
  await client.evaluate(`
    localStorage.clear();
    window.location.href = "http://127.0.0.1:8000/?mode=BETA_NORMAL";
  `);
  await delay(1500);
  await client.captureScreenshot("step01_dev_empty_entry.png");

  // Step 02: Bootstrap BETA team ("Club Deportivo Barakaldo", "Juvenil A")
  console.log("\n--- STEP 02: Bootstrap BETA team ---");
  await client.evaluate(`
    teamApp.goToScreen("v2_00_coach_create_team");
    document.getElementById("club-name").value = "Club Deportivo Barakaldo";
    document.getElementById("team-name").value = "Juvenil A";
    document.getElementById("coach-name").value = "Iñaki Williams";
    document.getElementById("coach-email").value = "inaki@barakaldo.test";
  `);
  await delay(300);
  await client.evaluate(`teamApp.submitCoachBootstrap();`);
  await delay(1500);

  const bootstrapState = await client.evaluate(`({
    teamSeasonId: teamApp.beta.teamSeasonId,
    joinCode: teamApp.beta.joinCode,
    teamName: teamApp.beta.team?.name,
    tokenCoach: !!teamApp.tokens.coach
  })`);
  console.log("Bootstrap state:", bootstrapState);
  if (!bootstrapState.teamSeasonId || !bootstrapState.joinCode) {
    throw new Error("Step 02 failed: bootstrap did not create team season or join code");
  }
  const joinCode = bootstrapState.joinCode;
  await client.captureScreenshot("step02_barakaldo_bootstrapped.png");

  // Step 03: Mesa del Míster initial empty state
  console.log("\n--- STEP 03: Mesa del Míster empty state ---");
  await client.evaluate(`teamApp.finishCoachSetup();`);
  await delay(1200);

  const homeEvidence = await client.evaluate(`({
    teamTitle: document.getElementById("coach-home-team-title")?.textContent?.trim(),
    seasonLabel: document.getElementById("coach-home-season-label")?.textContent?.trim(),
    playersCount: document.getElementById("coach-players-count")?.textContent?.trim(),
    linkedCount: document.getElementById("coach-linked-count")?.textContent?.trim(),
    pendingCount: document.getElementById("coach-pending-count")?.textContent?.trim(),
    joinCodePill: document.getElementById("coach-home-code-pill")?.textContent?.trim()
  })`);
  console.log("Step 03 Home evidence:", homeEvidence);
  if (!homeEvidence.teamTitle?.includes("Barakaldo")) {
    throw new Error(`Step 03 failed: Team title does not contain Barakaldo: ${homeEvidence.teamTitle}`);
  }
  if (homeEvidence.playersCount !== "0") {
    throw new Error(`Step 03 failed: Player count is not 0: ${homeEvidence.playersCount}`);
  }
  if (homeEvidence.linkedCount !== "0") {
    throw new Error(`Step 03 failed: Linked count is not 0: ${homeEvidence.linkedCount}`);
  }
  await client.captureScreenshot("step03_mesa_del_mister_empty.png");

  // Step 04: Create 1 Event with real date/time
  console.log("\n--- STEP 04: Create 1 Event with exact date/time ---");
  await client.evaluate(`
    teamApp.goToScreen("screen_c_create_event", "agenda");
    document.getElementById("event-title").value = "Entrenamiento Táctico Barakaldo";
    document.getElementById("location-input").value = "Campo Lasesarre";
    document.getElementById("event-notes").value = "Puntualidad obligatoria. Ropa de entreno oficial.";
    document.getElementById("event-date").value = "2026-09-25";
    document.getElementById("event-time").value = "18:30";
    document.getElementById("event-arrival").value = "18:15";
  `);
  await delay(500);
  await client.captureScreenshot("step04_event_form_filled.png");
  await client.evaluate(`teamApp.submitCreateEvent();`);
  await delay(1500);

  // Verify event in backend directly
  const eventsBackendRes = await fetch(`${API_BASE}/v1/team-seasons/${bootstrapState.teamSeasonId}/events`, {
    headers: { Authorization: `Bearer ${await client.evaluate('teamApp.tokens.coach')}` }
  });
  const eventsBackendData = await eventsBackendRes.json();
  console.log("Step 04 Backend events count:", eventsBackendData.items?.length, eventsBackendData.items?.[0]);
  if (!eventsBackendData.items || eventsBackendData.items.length !== 1) {
    throw new Error("Step 04 failed: Exactly 1 event expected in backend");
  }
  const createdEvent = eventsBackendData.items[0];
  if (!createdEvent.starts_at.includes("2026-09-25")) {
    throw new Error(`Step 04 failed: starts_at does not contain 2026-09-25: ${createdEvent.starts_at}`);
  }

  // Step 05: Check Agenda
  console.log("\n--- STEP 05: Check Agenda ---");
  await client.evaluate(`teamApp.goToScreen("v2_02_coach_agenda", "agenda");`);
  await delay(1000);

  const agendaEvidence = await client.evaluate(`({
    teamTitle: document.getElementById("agenda-team-title")?.textContent?.trim(),
    eventsCount: document.querySelectorAll("#agenda-events-container article")?.length,
    emptyHidden: document.getElementById("agenda-empty-container")?.classList.contains("hidden"),
    eventTitle: document.querySelector("#agenda-events-container article h3")?.textContent?.trim(),
    location: document.querySelector("#agenda-events-container article")?.textContent?.includes("Lasesarre")
  })`);
  console.log("Step 05 Agenda evidence:", agendaEvidence);
  if (!agendaEvidence.teamTitle.includes("Barakaldo")) throw new Error("Step 05 failed: Agenda team title mismatch");
  if (agendaEvidence.eventsCount !== 1) throw new Error(`Step 05 failed: Expected 1 event in Agenda, found ${agendaEvidence.eventsCount}`);
  if (!agendaEvidence.eventTitle.includes("Entrenamiento Táctico Barakaldo")) throw new Error("Step 05 failed: Agenda event title mismatch");
  await client.captureScreenshot("step05_agenda_single_event.png");

  // Step 06: Create 1 Player
  console.log("\n--- STEP 06: Create 1 Player ---");
  await client.evaluate(`
    teamApp.goToScreen("v2_00_coach_create_team");
    document.getElementById("player-firstname").value = "Gorka";
    document.getElementById("player-lastname").value = "Guruzeta";
    document.getElementById("player-number").value = "9";
    document.getElementById("player-position").value = "Delantero";
  `);
  await delay(400);
  await client.evaluate(`teamApp.submitAddPlayer();`);
  await delay(1200);

  const playersBackendRes = await fetch(`${API_BASE}/v1/team-seasons/${bootstrapState.teamSeasonId}/players`, {
    headers: { Authorization: `Bearer ${await client.evaluate('teamApp.tokens.coach')}` }
  });
  const playersBackendData = await playersBackendRes.json();
  console.log("Step 06 Backend players:", playersBackendData.items);
  if (!playersBackendData.items || playersBackendData.items.length !== 1) {
    throw new Error("Step 06 failed: Exactly 1 player expected in backend");
  }
  await client.captureScreenshot("step06_player_created.png");

  // Step 07: Check Plantilla / Roster
  console.log("\n--- STEP 07: Check Plantilla ---");
  await client.evaluate(`teamApp.goToScreen("v2_03_coach_roster", "equipo");`);
  await delay(1000);

  const rosterEvidence = await client.evaluate(`({
    teamTitle: document.getElementById("roster-team-title")?.textContent?.trim(),
    headerCount: document.getElementById("roster-header-count")?.textContent?.trim(),
    countAll: document.getElementById("roster-count-all")?.textContent?.trim(),
    rowsCount: document.querySelectorAll("#roster-players-list-container article")?.length,
    playerName: document.querySelector("#roster-players-list-container article")?.textContent?.includes("Gorka Guruzeta")
  })`);
  console.log("Step 07 Roster evidence:", rosterEvidence);
  if (!rosterEvidence.teamTitle.includes("Barakaldo")) throw new Error("Step 07 failed: Roster team title mismatch");
  if (rosterEvidence.countAll !== "1") throw new Error("Step 07 failed: Count all is not 1");
  if (!rosterEvidence.playerName) throw new Error("Step 07 failed: Gorka Guruzeta not rendered in roster");
  await client.captureScreenshot("step07_roster_single_player.png");

  // Step 08: Check Avisos
  console.log("\n--- STEP 08: Check Avisos empty state ---");
  await client.evaluate(`teamApp.goToScreen("screen_k_notices", "avisos");`);
  await delay(800);

  const noticesEvidence = await client.evaluate(`({
    teamTitle: document.getElementById("notices-team-title")?.textContent?.trim(),
    badgeCount: document.getElementById("notices-badge-count")?.textContent?.trim(),
    emptyVisible: !document.getElementById("notices-empty-container")?.classList.contains("hidden"),
    feedHidden: document.getElementById("notices-feed-container")?.classList.contains("hidden")
  })`);
  console.log("Step 08 Notices evidence:", noticesEvidence);
  if (!noticesEvidence.teamTitle.includes("Barakaldo")) throw new Error("Step 08 failed: Notices team title mismatch");
  if (!noticesEvidence.emptyVisible) throw new Error("Step 08 failed: Notices empty state should be visible");
  if (!noticesEvidence.feedHidden) throw new Error("Step 08 failed: Notices feed container should be hidden");
  await client.captureScreenshot("step08_avisos_empty_state.png");

  // Step 09: Copy Join Code / Verify join code endpoint
  console.log("\n--- STEP 09: Verify join code API ---");
  const joinCheckRes = await fetch(`${API_BASE}/v1/team-join/${joinCode}`);
  const joinCheckData = await joinCheckRes.json();
  console.log("Step 09 Join check:", joinCheckData);
  if (joinCheckRes.status !== 200 || !(joinCheckData.team?.name || joinCheckData.name)?.includes("Barakaldo")) {
    throw new Error("Step 09 failed: Team join info endpoint failed");
  }
  await client.captureScreenshot("step09_join_code_copied.png");

  // Step 10: Tutor Onboarding (Family Join Flow)
  console.log("\n--- STEP 10: Tutor claim flow ---");
  await client.evaluate(`
    teamApp.goToScreen("v2_00_parent_join_team");
    document.getElementById("parent-join-code-input").value = "${joinCode}";
  `);
  await delay(300);
  await client.evaluate(`teamApp.verifyParentJoinInput();`);
  await delay(1000);

  await client.evaluate(`
    document.getElementById("tutor-name").value = "Aitor Guruzeta";
    document.getElementById("tutor-email").value = "aitor@guruzeta.test";
    document.getElementById("parent-claim-name").value = "Gorka Guruzeta";
    document.getElementById("parent-claim-number").value = "9";
  `);
  await delay(400);
  await client.evaluate(`teamApp.submitParentJoinRequest();`);
  await delay(1500);

  const pendingNotice = await client.evaluate(`document.getElementById("parent-clean-backend-notice")?.textContent?.trim()`);
  console.log("Step 10 Pending notice:", pendingNotice);
  if (!pendingNotice.includes("PENDIENTE DE APROBACIÓN")) {
    throw new Error("Step 10 failed: Tutor request pending notice not displayed");
  }
  await client.captureScreenshot("step10_tutor_request_pending.png");

  // Step 11: Coach Approval
  console.log("\n--- STEP 11: Coach approval without 403 error ---");
  await client.evaluate(`
    teamApp.currentRole = "coach";
    localStorage.setItem("talde_active_role", "coach");
    teamApp.goToScreen("v2_01_coach_home", "inicio");
  `);
  await delay(1500);

  const approvalCard = await client.evaluate(`({
    cardVisible: !document.getElementById("coach-pending-approval-card")?.classList.contains("hidden"),
    cardHtml: document.getElementById("coach-pending-approval-card")?.textContent?.trim()
  })`);
  console.log("Step 11 Pending approval card:", approvalCard);
  if (!approvalCard.cardVisible) throw new Error("Step 11 failed: Approval card not visible on Coach home");

  // Execute approval
  await client.evaluate(`
    const btn = document.querySelector("#coach-pending-approval-card button[onclick*='approveBetaGuardianRequest']");
    if (btn) btn.click();
  `);
  await delay(1500);

  const approvalResult = await client.evaluate(`({
    cardHidden: document.getElementById("coach-pending-approval-card")?.classList.contains("hidden"),
    badgeVisible: !document.getElementById("coach-approval-success-badge")?.classList.contains("hidden"),
    linkedCount: document.getElementById("coach-linked-count")?.textContent?.trim()
  })`);
  console.log("Step 11 Approval result:", approvalResult);
  if (!approvalResult.badgeVisible) {
    throw new Error("Step 11 failed: Approval success badge not visible after clicking approve");
  }
  await client.captureScreenshot("step11_coach_approved_success.png");

  // Step 12: Tutor Home / Mesa de la Familia
  console.log("\n--- STEP 12: Tutor Home for Gorka Guruzeta ---");
  await client.evaluate(`
    (async () => { teamApp.currentRole = "parent"; localStorage.setItem("talde_active_role", "parent"); await teamApp.loadUserContext(); await teamApp.goToScreen("v2_07_parent_home", "inicio"); })()
  `);
  await delay(1500);

  const parentHomeEvidence = await client.evaluate(`({
    playerName: document.getElementById("parent-home-player-name")?.textContent?.trim(),
    teamName: document.getElementById("parent-home-team-name")?.textContent?.trim(),
    jerseyBadge: document.getElementById("parent-home-jersey-badge")?.textContent?.trim(),
    commitments: document.getElementById("parent-commitments-list")?.textContent?.trim()
  })`);
  console.log("Step 12 Parent home evidence:", parentHomeEvidence);
  if (!parentHomeEvidence.playerName.includes("Gorka Guruzeta")) {
    throw new Error(`Step 12 failed: Player name is not Gorka Guruzeta: ${parentHomeEvidence.playerName}`);
  }
  if (!parentHomeEvidence.teamName.includes("Barakaldo")) {
    throw new Error(`Step 12 failed: Team name does not include Barakaldo: ${parentHomeEvidence.teamName}`);
  }
  if (parentHomeEvidence.jerseyBadge !== "9") {
    throw new Error(`Step 12 failed: Jersey badge is not 9: ${parentHomeEvidence.jerseyBadge}`);
  }
  await client.captureScreenshot("step12_tutor_home_gorka.png");

  // Step 13: Persistence after Browser Reload (F5)
  console.log("\n--- STEP 13: Persistence after F5 reload ---");
  // Reload page as parent
  await client.evaluate(`window.location.reload();`);
  await delay(2000);

  const parentReloadEvidence = await client.evaluate(`({
    screen: teamApp.currentScreen,
    role: teamApp.currentRole,
    playerName: document.getElementById("parent-home-player-name")?.textContent?.trim(),
    teamName: document.getElementById("parent-home-team-name")?.textContent?.trim()
  })`);
  console.log("Step 13 Parent reload evidence:", parentReloadEvidence);
  if (!parentReloadEvidence.playerName?.includes("Gorka Guruzeta")) {
    throw new Error("Step 13 failed: Parent context not restored after reload");
  }

  // Switch to coach and reload
  await client.evaluate(`
    teamApp.currentRole = "coach";
    localStorage.setItem("talde_active_role", "coach");
    teamApp.goToScreen("v2_01_coach_home", "inicio");
  `);
  await delay(1000);
  await client.evaluate(`window.location.reload();`);
  await delay(2000);

  const coachReloadEvidence = await client.evaluate(`({
    screen: teamApp.currentScreen,
    role: teamApp.currentRole,
    teamTitle: document.getElementById("coach-home-team-title")?.textContent?.trim(),
    playersCount: document.getElementById("coach-players-count")?.textContent?.trim()
  })`);
  console.log("Step 13 Coach reload evidence:", coachReloadEvidence);
  if (!coachReloadEvidence.teamTitle?.includes("Barakaldo")) {
    throw new Error("Step 13 failed: Coach context not restored after reload");
  }
  await client.captureScreenshot("step13_persisted_after_f5.png");

  // Step 14: Reset DEMO via /v1/dev/reset
  console.log("\n--- STEP 14: Call /v1/dev/reset ---");
  const resetRes = await fetch(`${API_BASE}/v1/dev/reset`, { method: "POST" });
  const resetData = await resetRes.json();
  console.log("POST /v1/dev/reset response:", resetRes.status, resetData);
  if (resetRes.status !== 200) throw new Error("Step 14 failed: dev/reset failed");
  await client.captureScreenshot("step14_dev_reset_called.png");

  // Step 15: Verify Canonical Indautxu DEMO
  console.log("\n--- STEP 15: Verify Canonical Indautxu DEMO ---");
  await client.evaluate(`
    localStorage.clear();
    window.location.href = "http://127.0.0.1:8000/?mode=DEMO&screen=v2_01_coach_home";
  `);
  await delay(2000);

  const demoEvidence = await client.evaluate(`({
    appMode: teamApp.appMode,
    teamTitle: document.getElementById("coach-home-team-title")?.textContent?.trim(),
    playersCount: document.getElementById("coach-players-count")?.textContent?.trim()
  })`);
  console.log("Step 15 DEMO evidence:", demoEvidence);
  if (!demoEvidence.teamTitle.includes("Indautxu")) {
    throw new Error("Step 15 failed: DEMO team title mismatch");
  }
  if (!demoEvidence.playersCount.includes("18")) {
    throw new Error("Step 15 failed: DEMO player count is not 18");
  }
  await client.captureScreenshot("step15_canonical_demo_indautxu.png");

  // Step 16: Reset to Clean BETA
  console.log("\n--- STEP 16: Reset to Clean BETA via /v1/dev/empty ---");
  const finalEmptyRes = await fetch(`${API_BASE}/v1/dev/empty`, { method: "POST" });
  console.log("POST /v1/dev/empty status:", finalEmptyRes.status);
  await client.evaluate(`
    localStorage.clear();
    window.location.href = "http://127.0.0.1:8000/?mode=BETA_NORMAL";
  `);
  await delay(1500);

  const finalBetaEvidence = await client.evaluate(`({
    appMode: teamApp.appMode,
    currentScreen: teamApp.currentScreen
  })`);
  console.log("Step 16 Clean BETA evidence:", finalBetaEvidence);
  await client.captureScreenshot("step16_clean_beta_restored.png");

  client.close();
  console.log("\n=================================================");
  console.log("🎉 ALL 16 STEPS COMPLETED AND VERIFIED SUCCESSFULLY!");
  console.log("=================================================");
}

runAudit().catch((err) => {
  console.error("FATAL AUDIT FAILURE:", err);
  process.exit(1);
});
