import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

// Helper to interact with Google Chrome via Chrome DevTools Protocol (CDP) WebSocket
class CdpSession {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.callbacks = new Map();
    this.events = [];
    this.consoleErrors = [];

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.callbacks.has(msg.id)) {
        const { resolve, reject } = this.callbacks.get(msg.id);
        this.callbacks.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      } else if (msg.method) {
        this.events.push(msg);
        if (msg.method === "Runtime.exceptionThrown") {
          this.consoleErrors.push(msg.params.exceptionDetails);
        } else if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
          this.consoleErrors.push(msg.params.args.map((a) => a.value || a.description).join(" "));
        }
      }
    };
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression) {
    const res = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    if (res.exceptionDetails) {
      throw new Error(`Eval error: ${res.exceptionDetails.exception?.description || res.exceptionDetails.text || JSON.stringify(res.exceptionDetails)}`);
    }
    return res.result?.value;
  }
}

test("Real Browser Verification: Complete Coach and Family Journeys on Chrome 155 (raQel Validation)", async () => {
  // 1. Static server serving application files with production security headers
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    let filePath;
    let contentType = "text/plain";

    if (url.pathname === "/" || url.pathname === "/index.html") {
      filePath = path.join(projectRoot, "index.html");
      contentType = "text/html; charset=utf-8";
    } else {
      filePath = path.join(projectRoot, url.pathname.replace(/^\//, ""));
      if (url.pathname.endsWith(".html")) {
        contentType = "text/html; charset=utf-8";
      } else if (url.pathname.endsWith(".js") || url.pathname.endsWith(".mjs")) {
        contentType = "application/javascript; charset=utf-8";
      } else if (url.pathname.endsWith(".css")) {
        contentType = "text/css; charset=utf-8";
      } else if (url.pathname.endsWith(".json")) {
        contentType = "application/json; charset=utf-8";
      } else if (url.pathname.endsWith(".png")) {
        contentType = "image/png";
      } else if (url.pathname.endsWith(".svg")) {
        contentType = "image/svg+xml";
      }
    }

    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      res.writeHead(404);
      res.end("Not Found");
      return;
    }

    const content = fs.readFileSync(filePath);
    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: https:; connect-src 'self' http://127.0.0.1:* http://localhost:* https:; object-src 'none'; base-uri 'self';",
      "X-Content-Type-Options": "nosniff"
    });
    res.end(content);
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const serverPort = server.address().port;
  const baseUrl = `http://127.0.0.1:${serverPort}/demo.html?demo=1&role=coach`;

  // 2. Launch Google Chrome headless with CDP enabled
  const chromePort = 9224;
  const chromeProcess = spawn("/usr/bin/google-chrome", [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    `--remote-debugging-port=${chromePort}`,
    "--window-size=412,915" // Mobile viewport matching sideline coach testing
  ], { stdio: "ignore" });

  try {
    // Wait for Chrome CDP port to accept HTTP
    let cdpReady = false;
    for (let i = 0; i < 20; i++) {
      try {
        const check = await fetch(`http://127.0.0.1:${chromePort}/json/version`);
        if (check.ok) { cdpReady = true; break; }
      } catch {}
      await new Promise((r) => setTimeout(r, 200));
    }
    assert.ok(cdpReady, "Google Chrome CDP must be ready on port " + chromePort);

    // Create a new target/page
    const newPageRes = await fetch(`http://127.0.0.1:${chromePort}/json/new`, { method: "PUT" });
    const target = await newPageRes.json();
    assert.ok(target.webSocketDebuggerUrl, "Target must expose webSocketDebuggerUrl");

    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve) => { ws.onopen = resolve; });
    const cdp = new CdpSession(ws);

    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");

    // 3. Navigate real browser to application
    await cdp.send("Page.navigate", { url: baseUrl });

    // Wait for Page.loadEventFired
    await new Promise((resolve) => {
      const interval = setInterval(() => {
        if (cdp.events.some((e) => e.method === "Page.loadEventFired")) {
          clearInterval(interval);
          resolve();
        }
      }, 50);
    });

    // Wait 600ms for Tailwind and initialization scripts to mount
    await new Promise((r) => setTimeout(r, 600));

    // Verify title and main root
    const pageTitle = await cdp.eval("document.title");
    assert.ok(pageTitle.includes("Talde Hemendik!"), "Title must contain Talde Hemendik!");

    const teamAppDefined = await cdp.eval("typeof window.teamApp === 'object' && window.teamApp !== null");
    assert.equal(teamAppDefined, true, "window.teamApp must be mounted in DOM");

    // 4. COACH JOURNEY: Notice Publishing Flow in Real DOM
    // Verify opening Notice modal
    await cdp.eval("window.teamApp.openCreateNoticeModal()");
    const noticeModalVisible = await cdp.eval("!document.getElementById('modal-create-notice').classList.contains('hidden')");
    assert.equal(noticeModalVisible, true, "Notice modal must be visible after openCreateNoticeModal()");

    // Fill form fields in real DOM
    await cdp.eval(`
      document.getElementById('notice-title').value = 'Entrenamiento adelantado 30 minutos';
      document.getElementById('notice-body').value = 'Mañana empezamos a las 17:30 en el campo principal.';
      document.getElementById('notice-category').value = 'SCHEDULE_CHANGE';
      document.getElementById('notice-urgent').checked = true;
    `);

    const formValues = await cdp.eval(`({
      title: document.getElementById('notice-title').value,
      body: document.getElementById('notice-body').value,
      category: document.getElementById('notice-category').value,
      urgent: document.getElementById('notice-urgent').checked
    })`);
    assert.equal(formValues.title, "Entrenamiento adelantado 30 minutos");
    assert.equal(formValues.urgent, true);

    // Close Notice modal
    await cdp.eval("window.teamApp.closeCreateNoticeModal()");
    const noticeModalHidden = await cdp.eval("document.getElementById('modal-create-notice').classList.contains('hidden')");
    assert.equal(noticeModalHidden, true, "Notice modal must be hidden after closeCreateNoticeModal()");

    // 5. EVENT HUB: Verify 'Enviar aviso a familias' button trigger
    await cdp.eval("window.teamApp.goToScreen('v2_05_event_hub_normal', 'agenda');");
    const sendNoticeBtnExists = await cdp.eval("Boolean(document.getElementById('hub-btn-send-notice'))");
    assert.equal(sendNoticeBtnExists, true, "hub-btn-send-notice button must exist in Event Hub");

    // Click 'Enviar aviso a familias' button
    await cdp.eval("document.getElementById('hub-btn-send-notice').click()");
    const noticeModalOpenedFromHub = await cdp.eval("!document.getElementById('modal-create-notice').classList.contains('hidden')");
    assert.equal(noticeModalOpenedFromHub, true, "Clicking 'Enviar aviso a familias' in Event Hub must open #modal-create-notice");
    await cdp.eval("window.teamApp.closeCreateNoticeModal()");

    // 6. COACH DOSSIER & DIRECT COMMUNICATIONS: Ficha del Jugador
    await cdp.eval("window.teamApp.goToScreen('v2_04_player_detail', 'equipo');");
    const demoPlayerDetailVisible = await cdp.eval("!document.getElementById('player-detail-demo-container').classList.contains('hidden')");
    assert.equal(demoPlayerDetailVisible, true, "player-detail-demo-container must be visible in demo coach mode");

    // Open Player Direct Message Modal
    await cdp.eval("window.teamApp.openPlayerDirectMessageModal('p1', 'Ibai Aranguren')");
    const directMsgModalVisible = await cdp.eval("!document.getElementById('modal-player-direct-message').classList.contains('hidden')");
    assert.equal(directMsgModalVisible, true, "Direct message modal must open for player");

    // Verify textarea exists
    const directMsgTextarea = await cdp.eval("Boolean(document.getElementById('pdm-input-message'))");
    assert.equal(directMsgTextarea, true, "pdm-input-message textarea must exist in modal");
    await cdp.eval("window.teamApp.closePlayerDirectMessageModal()");

    // 7. MULTI-MEMBERSHIP & ROLE SWITCHING: Coach <-> Guardian
    await cdp.eval(`
      window.teamApp.beta.memberships = [
        { team_season_id: 'season-demo-1', role: 'COACH', team_name: 'S.D. Indautxu', display_label: 'Infantil A' },
        { team_season_id: 'season-demo-2', role: 'GUARDIAN', team_name: 'Danok Bat', display_label: 'Alevín B' }
      ];
      window.teamApp.openRoleSwitcherModal();
    `);
    const roleSwitcherVisible = await cdp.eval("!document.getElementById('modal-role-switcher').classList.contains('hidden')");
    assert.equal(roleSwitcherVisible, true, "Role switcher modal must open with memberships");

    const switcherItemsCount = await cdp.eval("document.getElementById('modal-switcher-items').children.length");
    assert.equal(switcherItemsCount, 2, "Role switcher must render 2 membership cards");

    // Switch role to GUARDIAN
    await cdp.eval("window.teamApp.selectActiveMembership('season-demo-2', 'GUARDIAN')");
    const roleSwitcherClosed = await cdp.eval("document.getElementById('modal-role-switcher').classList.contains('hidden')");
    assert.equal(roleSwitcherClosed, true, "Role switcher modal must close upon selecting membership");

    const currentRole = await cdp.eval("window.teamApp.currentRole");
    assert.equal(currentRole, "parent", "Active role must be updated to parent/guardian");

    // 8. FAMILY JOURNEY: Parent Home & Feeds
    const parentHomeActive = await cdp.eval("!document.getElementById('v2_07_parent_home').classList.contains('hidden')");
    assert.equal(parentHomeActive, true, "Parent home screen must be active in DOM");

    const noticesFeedExists = await cdp.eval("Boolean(document.getElementById('parent-notices-container'))");
    assert.equal(noticesFeedExists, true, "parent-notices-container must exist on parent home");

    const directMessagesFeedExists = await cdp.eval("Boolean(document.getElementById('parent-direct-messages-container'))");
    assert.equal(directMessagesFeedExists, true, "parent-direct-messages-container must exist on parent home");

    // 8b. BETA 0.2 COACH JOURNEY: Equipo -> Jugador -> Ficha -> Notas Privadas (Validating Root JSON Contract Fix)
    await cdp.eval(`
      window.teamApp.appMode = "BETA_NORMAL";
      window.teamApp.currentRole = "coach";
      window.teamApp.beta.teamSeasonId = "ts-beta-01";
      window.teamApp.beta.team = { name: "Talde Gazteak", sport: "FOOTBALL" };
      window.teamApp.beta.teamSeason = { id: "ts-beta-01", display_label: "Cadete A", category: "CADETE" };
      window.teamApp.beta.players = [
        { id: "p-beta-01", first_name: "Aimar", last_name: "Olaizola", shirt_number: 7, position: "Delantero" }
      ];

      // Mock API returning real backend JSON contract (player object at ROOT, no .item wrapper)
      window.api.teams.getPlayers = async () => ({
        items: [
          { id: "p-beta-01", first_name: "Aimar", last_name: "Olaizola", shirt_number: 7, position: "Delantero" }
        ]
      });

      window.api.teams.getPlayer = async (tsId, pId) => ({
        id: "p-beta-01",
        first_name: "Aimar",
        last_name: "Olaizola",
        short_name: "Aimar",
        shirt_number: 7,
        position: "Delantero",
        team_season_id: "ts-beta-01",
        guardians: [
          {
            id: "u-tutor-01",
            userId: "u-tutor-01",
            displayName: "Miren Goikoetxea",
            email: "miren@example.test",
            phone: "+34600112233",
            relationship: "Madre",
            createdAt: "2026-10-26T18:00:00Z"
          }
        ],
        linked_guardians: [
          {
            id: "u-tutor-01",
            userId: "u-tutor-01",
            displayName: "Miren Goikoetxea",
            email: "miren@example.test",
            phone: "+34600112233",
            relationship: "Madre",
            createdAt: "2026-10-26T18:00:00Z"
          }
        ]
      });

      window.api.teams.getPlayerMessages = async (tsId, pId) => ({
        items: [
          {
            id: "msg-01",
            message: "Por favor confirmar viaje en autobús para el partido del sábado.",
            author_name: "Entrenador",
            created_at: new Date().toISOString()
          }
        ]
      });

      window.api.teams.sendPlayerMessage = async (tsId, pId, message) => ({
        id: "msg-02",
        message,
        author_name: "Entrenador",
        created_at: new Date().toISOString()
      });
    `);

    // Step A: Navigate to Equipo (Plantilla)
    await cdp.eval("window.teamApp.goToScreen('v2_03_coach_roster', 'equipo');");
    await new Promise((r) => setTimeout(r, 200));

    // Step B: Click on player to open ficha
    await cdp.eval("window.teamApp.viewPlayerDetail('p-beta-01');");
    await new Promise((r) => setTimeout(r, 300));

    // Step C: Verify Ficha content in real DOM
    const dossierHtml = await cdp.eval("document.getElementById('player-detail-coach-dynamic-container').innerHTML");
    assert.ok(!dossierHtml.includes("Deportista no encontrado"), "Dossier must NOT show 'Deportista no encontrado'");
    assert.ok(!dossierHtml.includes("Error al cargar la ficha"), "Dossier must NOT show 'Error al cargar la ficha'");
    assert.ok(dossierHtml.includes("Aimar Olaizola"), "Dossier must render player full name 'Aimar Olaizola'");
    assert.ok(dossierHtml.includes("#7"), "Dossier must render dorsal '#7'");
    assert.ok(dossierHtml.includes("Miren Goikoetxea"), "Dossier must render guardian name 'Miren Goikoetxea'");
    assert.ok(dossierHtml.includes("+34600112233"), "Dossier must render guardian phone '+34600112233'");
    assert.ok(dossierHtml.includes("Por favor confirmar viaje en autobús"), "Dossier must render direct message");

    // Step D: Open and submit private note to family
    await cdp.eval("window.teamApp.openPlayerDirectMessageModal('p-beta-01', 'Aimar Olaizola')");
    const pdmModalActive = await cdp.eval("!document.getElementById('modal-player-direct-message').classList.contains('hidden')");
    assert.equal(pdmModalActive, true, "Player direct message modal must be visible");

    await cdp.eval("document.getElementById('pdm-input-message').value = 'Confirmado viaje en autobús para Aimar.'");
    await cdp.eval("window.teamApp.submitPlayerDirectMessage()");
    await new Promise((r) => setTimeout(r, 200));
    await cdp.eval("window.teamApp.closePlayerDirectMessageModal()");

    // 9. Capture screenshot of real browser view for evidence artifact
    const screenshot = await cdp.send("Page.captureScreenshot", { format: "png" });
    const screenshotPath = path.join(
      "/home/anarqorp/.gemini/antigravity/brain/26766cc8-3766-4efc-8e41-a867265f8586",
      "real_browser_validation.png"
    );
    fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));
    assert.ok(fs.existsSync(screenshotPath), "Browser screenshot must be captured and saved");

    // 10. Zero Console Exceptions or Script Failures
    assert.equal(cdp.consoleErrors.length, 0, `Real browser must have 0 uncaught exceptions. Got: ${JSON.stringify(cdp.consoleErrors)}`);

    ws.close();
  } finally {
    chromeProcess.kill("SIGKILL");
    server.close();
  }
});
