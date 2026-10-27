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
const brainDir = "/home/anarqorp/.gemini/antigravity/brain/26766cc8-3766-4efc-8e41-a867265f8586";

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

test("Responsive Viewports & Simulation Decoupling on Chrome CDP (360px, 390px, 768px, 1366px, 1920px)", async () => {
  // 1. Static HTTP Server with security headers
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

  // 2. Launch Headless Chrome
  const chromePort = 9225;
  const chromeProcess = spawn("/usr/bin/google-chrome", [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    `--remote-debugging-port=${chromePort}`,
    "--window-size=1920,1080"
  ], { stdio: "ignore" });

  try {
    let cdpReady = false;
    for (let i = 0; i < 20; i++) {
      try {
        const check = await fetch(`http://127.0.0.1:${chromePort}/json/version`);
        if (check.ok) { cdpReady = true; break; }
      } catch {}
      await new Promise((r) => setTimeout(r, 200));
    }
    assert.ok(cdpReady, "Google Chrome CDP must be ready on port " + chromePort);

    const newPageRes = await fetch(`http://127.0.0.1:${chromePort}/json/new`, { method: "PUT" });
    const target = await newPageRes.json();
    assert.ok(target.webSocketDebuggerUrl, "Target must expose webSocketDebuggerUrl");

    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve) => { ws.onopen = resolve; });
    const cdp = new CdpSession(ws);

    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");

    // =========================================================================
    // PART A: Production Normal Mode (No ?demo=1 query parameter)
    // =========================================================================
    const prodUrl = `http://127.0.0.1:${serverPort}/`;
    await cdp.send("Page.navigate", { url: prodUrl });

    await new Promise((resolve) => {
      const interval = setInterval(() => {
        if (cdp.events.some((e) => e.method === "Page.loadEventFired")) {
          clearInterval(interval);
          resolve();
        }
      }, 50);
    });
    await new Promise((r) => setTimeout(r, 600));

    // Verify mode is BETA_NORMAL and simulation phone frame is gone
    const appMode = await cdp.eval("window.teamApp.appMode");
    assert.equal(appMode, "BETA_NORMAL", "Production entry must default strictly to BETA_NORMAL mode");

    const demoToolsAbsentOrHidden = await cdp.eval("!document.getElementById('demo-tools-wrapper') || document.getElementById('demo-tools-wrapper').classList.contains('hidden')");
    assert.equal(demoToolsAbsentOrHidden, true, "#demo-tools-wrapper must be absent or hidden in production normal access");

    const demoToolbarAbsentOrHidden = await cdp.eval("!document.getElementById('demo-toolbar') || document.getElementById('demo-toolbar').classList.contains('hidden')");
    assert.equal(demoToolbarAbsentOrHidden, true, "#demo-toolbar must be absent or hidden in production normal access");

    const hasPhoneMockupWrapper = await cdp.eval("Boolean(document.querySelector('.mockup-wrapper'))");
    assert.equal(hasPhoneMockupWrapper, false, "Phone simulator wrapper .mockup-wrapper must be completely removed");

    const hasNotch = await cdp.eval("Boolean(document.querySelector('.camera-notch'))");
    assert.equal(hasNotch, false, "Camera notch element must be completely removed");

    // =========================================================================
    // PART B: Multi-Viewport Responsive Matrix Verification & Screenshots
    // =========================================================================
    // We will test 5 viewports in Coach view (with ?demo=1 to load demo data for inspection)
    const viewports = [
      { name: "mobile_360", width: 360, height: 640, isMobile: true },
      { name: "mobile_390", width: 390, height: 844, isMobile: true },
      { name: "tablet_768", width: 768, height: 1024, isMobile: false },
      { name: "laptop_1366", width: 1366, height: 768, isMobile: false },
      { name: "desktop_1920", width: 1920, height: 1080, isMobile: false }
    ];

    const demoCoachUrl = `http://127.0.0.1:${serverPort}/demo.html?demo=1&role=coach`;
    await cdp.send("Page.navigate", { url: demoCoachUrl });
    await new Promise((resolve) => {
      const interval = setInterval(() => {
        if (cdp.events.filter((e) => e.method === "Page.loadEventFired").length >= 2) {
          clearInterval(interval);
          resolve();
        }
      }, 50);
    });
    await new Promise((r) => setTimeout(r, 600));

    for (const vp of viewports) {
      // 1. Set emulation metrics
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: vp.width,
        height: vp.height,
        deviceScaleFactor: 1,
        mobile: vp.isMobile
      });
      await new Promise((r) => setTimeout(r, 250));

      // 2. Check Coach Home
      await cdp.eval("window.teamApp.goToTab('hoy')");
      await new Promise((r) => setTimeout(r, 200));

      // Verify zero horizontal overflow on root and document
      const overflow = await cdp.eval(`(() => {
        const sw = document.documentElement.scrollWidth;
        const cw = document.documentElement.clientWidth;
        const iw = window.innerWidth;
        const overflowing = [];
        if (sw > iw) {
          const all = document.querySelectorAll('*');
          for (const el of all) {
            const r = el.getBoundingClientRect();
            if (r.right > iw + 1) {
              overflowing.push({
                tag: el.tagName,
                id: el.id,
                className: el.className ? (typeof el.className === 'string' ? el.className.slice(0, 100) : '') : '',
                right: r.right,
                width: r.width
              });
            }
          }
        }
        return {
          scrollWidth: sw,
          clientWidth: cw,
          innerWidth: iw,
          hasOverflow: sw > iw,
          overflowing: overflowing.slice(0, 10)
        };
      })()`);
      if (overflow.hasOverflow) {
        console.error("OVERFLOW DETECTED on " + vp.name + ":", JSON.stringify(overflow, null, 2));
      }
      assert.equal(overflow.hasOverflow, false, `Viewport ${vp.name} (${vp.width}px) must have NO horizontal overflow: scrollWidth=${overflow.scrollWidth}, innerWidth=${overflow.innerWidth}`);

      // 3. Check Coach Roster
      await cdp.eval("window.teamApp.goToTab('equipo')");
      await new Promise((r) => setTimeout(r, 200));

      const rosterOverflow = await cdp.eval(`({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
        hasOverflow: document.documentElement.scrollWidth > window.innerWidth
      })`);
      assert.equal(rosterOverflow.hasOverflow, false, `Roster view on ${vp.name} must have NO horizontal overflow`);

      // 4. Check Bottom Nav alignment
      const navBounds = await cdp.eval(`(() => {
        const nav = document.getElementById('master-bottom-nav');
        if (!nav) return null;
        const rect = nav.getBoundingClientRect();
        return { left: rect.left, right: rect.right, width: rect.width };
      })()`);
      assert.ok(navBounds, "master-bottom-nav must be present");
      assert.ok(navBounds.width <= vp.width + 1, `Bottom nav width (${navBounds.width}) must not exceed viewport width (${vp.width})`);

      // 5. Open and check modal responsive sizing (modal-create-notice)
      await cdp.eval("window.teamApp.openCreateNoticeModal()");
      await new Promise((r) => setTimeout(r, 150));
      const modalBounds = await cdp.eval(`(() => {
        const modal = document.querySelector('#modal-create-notice > div');
        if (!modal) return null;
        const rect = modal.getBoundingClientRect();
        return { width: rect.width, left: rect.left, right: rect.right };
      })()`);
      assert.ok(modalBounds, "modal-create-notice inner div must exist");
      assert.ok(modalBounds.width <= vp.width, `Modal width (${modalBounds.width}) must fit inside viewport width (${vp.width})`);
      await cdp.eval("window.teamApp.closeCreateNoticeModal()");
      await new Promise((r) => setTimeout(r, 150));

      // 6. Capture screenshot for each viewport
      const screenshot = await cdp.send("Page.captureScreenshot", { format: "png" });
      const screenshotFilename = `responsive_${vp.name}_${vp.width}x${vp.height}.png`;
      const screenshotPath = path.join(brainDir, screenshotFilename);
      fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));
      assert.ok(fs.existsSync(screenshotPath), `Screenshot ${screenshotFilename} must be saved`);
    }

    // Zero Console Errors
    assert.equal(cdp.consoleErrors.length, 0, `Zero uncaught console errors expected. Got: ${JSON.stringify(cdp.consoleErrors)}`);

    ws.close();
  } finally {
    chromeProcess.kill("SIGKILL");
    server.close();
  }
});
