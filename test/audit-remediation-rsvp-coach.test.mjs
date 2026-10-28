import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

// Environment Mocking for Node.js test execution
const storage = new Map();
const nodes = new Map();

globalThis.localStorage = {
  getItem: k => storage.get(k) ?? null,
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: k => storage.delete(k),
  clear: () => storage.clear()
};
globalThis.sessionStorage = { clear() {} };

function el(id) {
  if (!nodes.has(id)) {
    const classes = new Set();
    let html = "", text = "";
    nodes.set(id, {
      id,
      value: "",
      disabled: false,
      style: {},
      dataset: {},
      classList: {
        add(...xs) { xs.forEach(x => classes.add(x)); },
        remove(...xs) { xs.forEach(x => classes.delete(x)); },
        contains: x => classes.has(x),
        toggle(x, on) { if (on ?? !classes.has(x)) classes.add(x); else classes.delete(x); }
      },
      get innerHTML() { return html; },
      set innerHTML(v) { html = String(v); text = String(v).replace(/<[^>]*>/g, ""); },
      get textContent() { return text; },
      set textContent(v) { text = String(v); html = String(v); },
      focus() {},
      click() { if (typeof this.onclick === "function") this.onclick(); },
      addEventListener() {},
      querySelector() {
        return null;
      },
      querySelectorAll() { return []; },
      setAttribute() {},
      removeAttribute() {}
    });
  }
  return nodes.get(id);
}

globalThis.document = {
  getElementById: el,
  addEventListener() {},
  querySelectorAll() { return []; },
  querySelector() { return null; }
};

globalThis.window = {
  localStorage: globalThis.localStorage,
  location: { search: "", hash: "", pathname: "/" },
  history: { replaceState() {} }
};

test("1. Production index.html strictly eliminates fake Pasar Lista toast, hardcoded 14/2/2 stats, and wrong parent RSVP links", () => {
  const indexHtml = fs.readFileSync(path.join(rootDir, "index.html"), "utf-8");

  // Verify fake toast "16 de 18 jugadores presentes hoy" is absent
  assert.equal(
    indexHtml.includes("16 de 18 jugadores presentes hoy"),
    false,
    "index.html must not contain fake Pasar Lista toast '16 de 18 jugadores presentes hoy'"
  );

  // Verify coach home does not have hardcoded Next Match Hero card with 14 Convocados
  assert.equal(
    indexHtml.includes("NEXT MATCH HERO CARD"),
    false,
    "index.html must not contain static NEXT MATCH HERO CARD on coach home"
  );
  assert.equal(
    indexHtml.includes("Acciones de Banquillo"),
    false,
    "index.html must not contain static Acciones de Banquillo section"
  );

  // Verify Screen 1 does not link to v2_08_parent_rsvp
  const screen1Match = indexHtml.match(/<section id="v2_01_coach_home"[\s\S]*?<\/section>\s*<!-- RESPONSIVE 2-COLUMN/);
  assert.ok(screen1Match, "v2_01_coach_home section must exist");
  assert.equal(
    screen1Match[0].includes("v2_08_parent_rsvp"),
    false,
    "Coach home must not link to v2_08_parent_rsvp"
  );

  // Verify Screen 6 (v2_06_event_hub_injury) does not have static 14/2/2 pills
  const screen6Match = indexHtml.match(/<section id="v2_06_event_hub_injury"[\s\S]*?<\/section>\s*<!-- SECTION 1: ALERTA/);
  assert.ok(screen6Match, "v2_06_event_hub_injury header must exist");
  assert.equal(
    screen6Match[0].includes("14 Convocados"),
    false,
    "Screen 6 must not contain hardcoded 14 Convocados pill"
  );
  assert.equal(
    screen6Match[0].includes('style="width: 77.7%"'),
    false,
    "Screen 6 must not contain hardcoded 77.7% width bar"
  );
});

test("2. Screen 8 RSVP options provide full keyboard accessibility, radiogroup semantics, and native radio inputs", () => {
  const indexHtml = fs.readFileSync(path.join(rootDir, "index.html"), "utf-8");

  // Verify radiogroup wrapper
  assert.ok(indexHtml.includes('id="rsvp-options" role="radiogroup"'), "rsvp-options must have role='radiogroup'");

  // Verify each option is a <label> with role="radio", tabindex="0", and onkeydown handler
  const yesOptionMatch = indexHtml.match(/<label id="rsvp-yes-label"[\s\S]*?<\/label>/);
  assert.ok(yesOptionMatch, "rsvp-yes-label must be a <label>");
  assert.ok(yesOptionMatch[0].includes('role="radio"'), "rsvp-yes-label must have role='radio'");
  assert.ok(yesOptionMatch[0].includes('tabindex="0"'), "rsvp-yes-label must have tabindex='0'");
  assert.ok(yesOptionMatch[0].includes("onkeydown="), "rsvp-yes-label must have onkeydown handler");
  assert.ok(yesOptionMatch[0].includes('input type="radio"'), "rsvp-yes-label must contain radio input");

  const noOptionMatch = indexHtml.match(/<label id="rsvp-no-label"[\s\S]*?<\/label>/);
  assert.ok(noOptionMatch, "rsvp-no-label must be a <label>");
  assert.ok(noOptionMatch[0].includes('role="radio"'), "rsvp-no-label must have role='radio'");
  assert.ok(noOptionMatch[0].includes('tabindex="0"'), "rsvp-no-label must have tabindex='0'");
  assert.ok(noOptionMatch[0].includes("onkeydown="), "rsvp-no-label must have onkeydown handler");
  assert.ok(noOptionMatch[0].includes('input type="radio"'), "rsvp-no-label must contain radio input");

  const maybeOptionMatch = indexHtml.match(/<label id="rsvp-maybe-label"[\s\S]*?<\/label>/);
  assert.ok(maybeOptionMatch, "rsvp-maybe-label must be a <label>");
  assert.ok(maybeOptionMatch[0].includes('role="radio"'), "rsvp-maybe-label must have role='radio'");
  assert.ok(maybeOptionMatch[0].includes('tabindex="0"'), "rsvp-maybe-label must have tabindex='0'");
  assert.ok(maybeOptionMatch[0].includes("onkeydown="), "rsvp-maybe-label must have onkeydown handler");
  assert.ok(maybeOptionMatch[0].includes('input type="radio"'), "rsvp-maybe-label must contain radio input");
});

test("3. Single save invocation: button uses handleSaveParentRsvp() with no duplicate onclick calls", () => {
  const indexHtml = fs.readFileSync(path.join(rootDir, "index.html"), "utf-8");

  // Save button must only call handleSaveParentRsvp()
  const saveBtnMatch = indexHtml.match(/<button id="save-btn"[\s\S]*?<\/button>/);
  assert.ok(saveBtnMatch, "save-btn must exist");
  assert.ok(saveBtnMatch[0].includes('onclick="handleSaveParentRsvp()"'), "save-btn must have single onclick='handleSaveParentRsvp()'");
  assert.equal(
    saveBtnMatch[0].includes("triggerSaveFeedback(); teamApp.saveParentRsvp();"),
    false,
    "save-btn must not have duplicate inline invocation"
  );
});

test("4. Race condition prevention in TeamAppState: User selection 'NO' is NOT overwritten by delayed GET 'CAN_ATTEND'", async () => {
  const { TeamAppState } = await import("../app.js");
  const { api } = await import("../src/api/index.js");

  const app = new TeamAppState();
  app.appMode = "DEMO";
  app.currentRole = "parent";
  app.currentScreen = "v2_08_parent_rsvp";

  let resolveGet;
  const delayedPromise = new Promise(resolve => {
    resolveGet = resolve;
  });

  // Mock getPlayerAvailability to delay its resolution
  const originalGet = api.availability.getPlayerAvailability;
  api.availability.getPlayerAvailability = async () => delayedPromise;

  try {
    // 1. Enter screen - user has not modified choice yet
    app.parentRsvpUserModified = false;
    app.parentRsvpChoice = "SI";

    // 2. Start syncParentRsvp (simulating in-flight GET)
    const syncPromise = app.syncParentRsvp();

    // 3. User actively chooses "NO" WHILE the GET request is still in flight
    app.selectRsvpOption("NO");
    assert.equal(app.parentRsvpChoice, "NO", "User choice must be 'NO'");
    assert.equal(app.parentRsvpUserModified, true, "parentRsvpUserModified must be set to true on user action");

    // 4. Stale GET now resolves with CAN_ATTEND (the old state from the server)
    resolveGet({
      current: {
        event_id: "evt-1",
        player_id: "p-1",
        team_season_id: "ts-1",
        status: "CAN_ATTEND",
        version: 1
      }
    });

    await syncPromise;

    // 5. Invariant check: User choice "NO" MUST be preserved and NOT overwritten back to "SI"
    assert.equal(
      app.parentRsvpChoice,
      "NO",
      "Race condition guard must prevent stale GET from overwriting user choice 'NO' back to 'SI'"
    );
  } finally {
    api.availability.getPlayerAvailability = originalGet;
  }
});

test("5. FamiliesDomainController.saveParentRsvp() returns { success: true } on confirmed write and false on guards", async () => {
  const { TeamAppState } = await import("../app.js");
  const { api } = await import("../src/api/index.js");

  const app = new TeamAppState();
  app.appMode = "BETA_NORMAL";
  app.currentRole = "parent";
  app.currentSessionId = "SESSION_TEST_1";
  app.tokens.parent = "TOKEN_TEST_ACTIVE";
  app.beta.teamSeasonId = "ts-test-1";
  app.beta.activeEventId = "evt-test-1";
  app.beta.guardianPlayer = { id: "p-test-1", playerId: "p-test-1" };
  app.currentScreen = "v2_08_parent_rsvp";
  app.parentRsvpChoice = "NO";
  app.parentRsvpUserModified = true;

  // Mock setGuardianAvailability to return confirmed write version 2
  const originalSet = api.availability.setGuardianAvailability;
  api.availability.setGuardianAvailability = async () => ({
    status: "CANNOT_ATTEND",
    version: 2
  });

  try {
    const result = await app.saveParentRsvp();
    assert.ok(result, "saveParentRsvp must return a truthy result");
    assert.equal(result.success, true, "saveParentRsvp must return success: true");
    assert.equal(result.status, "CANNOT_ATTEND", "Confirmed status must match opContext");
    assert.equal(result.version, 2, "Confirmed version must match backend version");
    assert.equal(app.parentRsvpUserModified, false, "parentRsvpUserModified must reset to false after confirmed save");
  } finally {
    api.availability.setGuardianAvailability = originalSet;
  }
});
