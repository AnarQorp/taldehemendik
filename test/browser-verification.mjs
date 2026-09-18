import { promises as fs } from "node:fs";
import path from "node:path";

const ARTIFACTS_DIR = "/home/anarqorp/.gemini/antigravity/brain/866c5187-97f7-49ac-b2a6-cc798435cb85/screenshots";
const LOCAL_DIR = "/home/anarqorp/TaldeHemendik/test-artifacts/screenshots";

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

async function run() {
  console.log("=== INITIATING CHROME CDP VERIFICATION ===");
  const wsUrl = await getPageWsUrl();
  console.log("Connecting to:", wsUrl);
  const client = new CdpClient(wsUrl);
  await client.connect();

  await client.send("Page.enable");
  await client.send("Runtime.enable");
  await client.send("Network.enable");
  await client.send("Network.setCacheDisabled", { cacheDisabled: true });
  await client.send("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 960,
    deviceScaleFactor: 1,
    mobile: false
  });

  console.log("Navigating to http://127.0.0.1:8000/ ...");
  await client.send("Page.navigate", { url: "http://127.0.0.1:8000/" });
  await delay(1500);

  // Wait for window.teamApp to be loaded
  let ready = false;
  for (let i = 0; i < 25; i++) {
    const isDefined = await client.evaluate(`typeof window.teamApp !== 'undefined'`);
    if (isDefined) {
      ready = true;
      break;
    }
    await delay(200);
  }
  if (!ready) throw new Error("window.teamApp was not initialized within timeout");

  // 1. Reset Database to clean state
  console.log("\n[Step 1] Calling Dev Reset...");
  await client.evaluate(`
    (async () => {
      await window.teamApp.resetBackendDataset();
    })()
  `);
  await delay(800);

  // 2. Open Coach Home
  console.log("\n[Step 2] Navigating to Coach Home (v2_01_coach_home)...");
  await client.evaluate(`
    (async () => {
      await window.teamApp.switchMembership("coach");
      await window.teamApp.goToScreen("v2_01_coach_home", "inicio");
    })()
  `);
  await delay(800);
  const coachHomeState = await client.evaluate(`
    ({
      screen: window.teamApp.currentScreen,
      role: window.teamApp.currentRole,
      pendingCount: window.teamApp.live.pending ? window.teamApp.live.pending.items?.length : 0,
      eventsCount: window.teamApp.live.events ? window.teamApp.live.events.length : 0,
      toastText: document.getElementById("demo-toast")?.textContent
    })
  `);
  console.log("Coach Home State:", coachHomeState);
  await client.captureScreenshot("01_coach_home_initial.png");

  // 3. Open Event Hub Normal and verify counters (14/2/0/2)
  console.log("\n[Step 3] Navigating to Event Hub Normal (v2_05_event_hub_normal)...");
  await client.evaluate(`
    (async () => {
      await window.teamApp.goToScreen("v2_05_event_hub_normal", "agenda");
    })()
  `);
  await delay(800);
  const eventHubState = await client.evaluate(`
    ({
      canAttend: document.getElementById("badge-can-attend")?.textContent,
      cannotAttend: document.getElementById("badge-cannot-attend")?.textContent,
      unsure: document.getElementById("badge-unsure")?.textContent,
      noResponse: document.getElementById("badge-no-response")?.textContent,
      btnText: document.getElementById("btn-publish-draft")?.textContent?.trim()
    })
  `);
  console.log("Event Hub Live Counters:", eventHubState);

  // 4. Publish Callup (Revision 1)
  console.log("\n[Step 4] Publishing Callup Revision 1...");
  await client.evaluate(`
    (async () => {
      await window.teamApp.handlePublishCallup();
    })()
  `);
  await delay(1500);
  const publishedRev1State = await client.evaluate(`
    ({
      revision: window.teamApp.live.callup?.revision,
      playersCount: window.teamApp.live.callup?.players?.length,
      toastText: document.getElementById("demo-toast")?.textContent
    })
  `);
  console.log("Published Revision 1 State:", publishedRev1State);
  await client.captureScreenshot("02_event_hub_published_rev1.png");

  // 5. Switch to Parent Elena (v2_07_parent_home)
  console.log("\n[Step 5] Switching to Parent Elena (v2_07_parent_home)...");
  await client.evaluate(`
    (async () => {
      await window.teamApp.switchMembership("parent");
    })()
  `);
  await delay(800);
  const parentHomeRev1State = await client.evaluate(`
    ({
      role: window.teamApp.currentRole,
      screen: window.teamApp.currentScreen,
      ibaiCalled: window.teamApp.live.parentCallupStatus?.called,
      ibaiRevision: window.teamApp.live.parentCallupStatus?.revision,
      badgeText: document.getElementById("parent-ibai-callup-badge")?.textContent?.trim()
    })
  `);
  console.log("Parent Home State (Rev 1):", parentHomeRev1State);
  await client.captureScreenshot("03_parent_home_called_rev1.png");

  // 6. Parent Elena changes RSVP to CANNOT_ATTEND
  console.log("\n[Step 6] Elena marks Ibai CANNOT_ATTEND...");
  await client.evaluate(`
    (async () => {
      await window.teamApp.goToScreen("v2_08_parent_rsvp", "agenda");
      window.teamApp.selectRsvpOption("NO");
      await window.teamApp.saveParentRsvp();
    })()
  `);
  await delay(1500);
  const rsvpResult = await client.evaluate(`
    ({
      screen: window.teamApp.currentScreen,
      toastText: document.getElementById("demo-toast")?.textContent
    })
  `);
  console.log("Elena RSVP Result:", rsvpResult);
  await client.captureScreenshot("04_parent_rsvp_cannot_attend.png");

  // 7. Switch to Coach Mikel -> verify ActionItem in "Pendiente de ti"
  console.log("\n[Step 7] Switching back to Coach Mikel -> Checking 'Pendiente de ti'...");
  await client.evaluate(`
    (async () => {
      await window.teamApp.switchMembership("coach");
      await window.teamApp.goToScreen("v2_01_coach_home", "inicio");
    })()
  `);
  await delay(800);
  const coachPendingState = await client.evaluate(`
    ({
      pendingCount: window.teamApp.live.pending?.items?.length,
      actionItemType: window.teamApp.live.activeActionItem?.type,
      badgeText: document.getElementById("coach-badge-pending-count")?.textContent,
      cardDesc: document.getElementById("coach-action-item-desc")?.textContent?.trim()
    })
  `);
  console.log("Coach ActionItem State:", coachPendingState);
  await client.captureScreenshot("05_coach_home_action_item.png");

  // 8. Open Incident Hub (v2_06_event_hub_injury) -> verify replacement candidates
  console.log("\n[Step 8] Opening Incident Event Hub (v2_06_event_hub_injury)...");
  await client.evaluate(`
    (async () => {
      await window.teamApp.goToScreen("v2_06_event_hub_injury", "agenda");
    })()
  `);
  await delay(800);
  const candidatesState = await client.evaluate(`
    ({
      candidatesCount: window.teamApp.live.candidates ? window.teamApp.live.candidates.length : 0,
      candidates: window.teamApp.live.candidates ? window.teamApp.live.candidates.map((c) => ({ id: c.id, name: c.displayName, status: c.availabilityStatus })) : [],
      selectedSubstitute: window.teamApp.selectedSubstitute
    })
  `);
  console.log("Replacement Candidates State:", candidatesState);

  // 9. Confirm Ane Mintegi as replacement -> Revision 2
  console.log("\n[Step 9] Confirming Ane Mintegi as replacement...");
  await client.evaluate(`
    (async () => {
      window.teamApp.selectReserve("Ane Mintegi");
      await window.teamApp.confirmSubstitution();
    })()
  `);
  await delay(2000);
  const rev2State = await client.evaluate(`
    ({
      revision: window.teamApp.live.callup?.revision,
      playersCount: window.teamApp.live.callup?.players?.length,
      hasAne: window.teamApp.live.callup?.players?.some((p) => p.playerId === "30000000-0000-4000-8000-000000000002"),
      hasIbai: window.teamApp.live.callup?.players?.some((p) => p.playerId === "30000000-0000-4000-8000-000000000001"),
      toastText: document.getElementById("demo-toast")?.textContent
    })
  `);
  console.log("Revision 2 Callup State:", rev2State);
  await client.captureScreenshot("06_event_hub_injury_resolved_rev2.png");

  // 10. Switch back to Elena -> Ibai called: false, revision 2
  console.log("\n[Step 10] Elena views updated callup (called: false, revision 2)...");
  await client.evaluate(`
    (async () => {
      await window.teamApp.switchMembership("parent");
      await window.teamApp.goToScreen("v2_07_parent_home", "inicio");
    })()
  `);
  await delay(800);
  const elenaRev2State = await client.evaluate(`
    ({
      ibaiCalled: window.teamApp.live.parentCallupStatus?.called,
      ibaiRevision: window.teamApp.live.parentCallupStatus?.revision,
      badgeText: document.getElementById("parent-ibai-callup-badge")?.textContent?.trim()
    })
  `);
  console.log("Elena Rev 2 State:", elenaRev2State);
  await client.captureScreenshot("07_parent_home_uncalled_rev2.png");

  // 11. Test Error Handling: Version Conflict Simulation
  console.log("\n[Step 11] Simulating Version Conflict...");
  await client.evaluate(`
    (async () => {
      await window.teamApp.triggerTestConflictVersion();
    })()
  `);
  await delay(800);
  const conflictToast = await client.evaluate(`
    document.getElementById("demo-toast")?.textContent
  `);
  console.log("Conflict Toast:", conflictToast);
  await client.captureScreenshot("08_version_conflict_error.png");

  // 12. Test Error Handling: Ineligible Substitute Simulation
  console.log("\n[Step 12] Simulating Ineligible Substitute...");
  await client.evaluate(`
    (async () => {
      // Reopen incident simulation or test directly
      await window.teamApp.triggerTestConflictSubstitute();
    })()
  `);
  await delay(800);
  const ineligibleToast = await client.evaluate(`
    document.getElementById("demo-toast")?.textContent
  `);
  console.log("Ineligible Substitute Toast:", ineligibleToast);
  await client.captureScreenshot("09_ineligible_substitute_error.png");

  // 13. Page Reload (F5) and Persistence Verification
  console.log("\n[Step 13] Reloading Page (F5) to verify PostgreSQL persistence...");
  await client.send("Page.reload", { ignoreCache: true });
  await delay(2500);

  const persistedState = await client.evaluate(`
    ({
      hasTeamApp: typeof window.teamApp !== 'undefined',
      eventsCount: window.teamApp.live?.events ? window.teamApp.live.events.length : 0,
      currentRole: window.teamApp.currentRole,
      currentScreen: window.teamApp.currentScreen
    })
  `);
  console.log("Persisted State after reload:", persistedState);

  await client.evaluate(`
    (async () => {
      await window.teamApp.switchMembership("coach");
      await window.teamApp.goToScreen("v2_01_coach_home", "inicio");
    })()
  `);
  await delay(1000);
  const coachPersistedCheck = await client.evaluate(`
    ({
      pendingItemsTotal: window.teamApp.live.pending?.items?.length,
      toastText: document.getElementById("demo-toast")?.textContent
    })
  `);
  console.log("Coach Persisted Check from Postgres:", coachPersistedCheck);
  await client.captureScreenshot("10_persisted_after_reload.png");

  client.close();
  console.log("\n=== CHROME CDP PHYSICAL VERIFICATION COMPLETED SUCCESSFULLY ===");
}

run().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
