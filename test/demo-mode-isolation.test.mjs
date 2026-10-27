import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const storage = new Map();
const nodes = new Map();
const timers = new Map();
let timerSeq = 0;
const recordedFetches = [];

globalThis.localStorage = {
  getItem: k => storage.get(k) ?? null,
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: k => storage.delete(k),
  clear: () => storage.clear()
};
globalThis.sessionStorage = {
  getItem: k => null,
  setItem: (k, v) => {},
  removeItem: k => {},
  clear() {}
};

function el(id) {
  if (!nodes.has(id)) {
    const classes = new Set();
    let html = '', text = '';
    nodes.set(id, {
      id,
      value: '',
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
      set innerHTML(v) { html = String(v); text = String(v).replace(/<[^>]*>/g, ''); },
      get textContent() { return text; },
      set textContent(v) { text = String(v); html = String(v); },
      focus() {},
      click() { if (typeof this.onclick === 'function') this.onclick(); },
      addEventListener() {},
      querySelector() { return null; },
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
  sessionStorage: globalThis.sessionStorage,
  location: { search: '', hash: '', pathname: '/', href: 'http://localhost/' },
  addEventListener() {},
  removeEventListener() {},
  history: {
    replaceState(_state, _title, url) {
      if (typeof url === 'string') {
        const u = new URL(url, 'http://localhost');
        globalThis.window.location.search = u.search;
        globalThis.window.location.pathname = u.pathname;
        globalThis.window.location.href = u.href;
      }
    }
  }
};

globalThis.fetch = async (url, options = {}) => {
  recordedFetches.push({ url, options });
  return {
    ok: true,
    status: 200,
    headers: new Map([['content-type', 'application/json']]),
    json: async () => ({ ok: true, items: [] }),
    text: async () => JSON.stringify({ ok: true, items: [] })
  };
};

globalThis.setTimeout = fn => {
  const id = ++timerSeq;
  timers.set(id, fn);
  return id;
};
globalThis.clearTimeout = id => timers.delete(id);
globalThis.setInterval = fn => {
  const id = ++timerSeq;
  timers.set(id, fn);
  return id;
};
globalThis.clearInterval = id => timers.delete(id);

const { TeamAppState } = await import(path.join(projectRoot, 'app.js'));
await import(path.join(projectRoot, 'demo.js'));
const { api } = await import(path.join(projectRoot, 'src/api/index.js'));
const { DomainError } = await import(path.join(projectRoot, 'src/api/errors.js'));

function resetEnv() {
  storage.clear();
  nodes.clear();
  timers.clear();
  recordedFetches.length = 0;
  if (api && api.client) {
    api.client.setToken(null);
    api.client.setAppMode('BETA_NORMAL');
  }
}

test('ZaQ Canary Token Scenario: DEMO mode purges real tokens and stashes without leaking to memory or client', async () => {
  resetEnv();
  const canaryToken = 'zaq-canary-secret-token-coach-998877';

  // 1. User was previously authenticated in BETA_NORMAL
  storage.set('talde_session_token', canaryToken);
  storage.set('talde_token_coach', canaryToken);

  // 2. User accesses ?demo=1&role=coach
  globalThis.window.location.search = '?demo=1&role=coach';
  const app = new TeamAppState();
  await app.init();

  assert.equal(app.appMode, 'DEMO', 'App mode must be DEMO');
  assert.equal(api.client.getAppMode(), 'DEMO', 'ApiClient mode must be DEMO');
  assert.equal(api.client.getToken(), null, 'ApiClient must have null token in DEMO');
  assert.equal(app.tokens.coach, null, 'Coach token must be null in DEMO');
  assert.equal(app.tokens.parent, null, 'Parent token must be null in DEMO');
  assert.equal(storage.get('talde_session_token') ?? null, null, 'Real session must be removed from active localStorage');
  assert.equal(storage.get('talde_token_coach') ?? null, null, 'Real coach token must be removed from active localStorage');
  assert.equal(storage.get('talde_saved_session_token'), canaryToken, 'Real session is safely stashed');
});

test('ZaQ Canary Token Scenario: Conflicto Versión simulation executes locally with ZERO network calls', async () => {
  resetEnv();
  const canaryToken = 'zaq-canary-secret-token-coach-998877';
  storage.set('talde_saved_session_token', canaryToken);

  globalThis.window.location.search = '?demo=1&role=coach';
  const app = new TeamAppState();
  await app.init();

  // Mock UI toast capture
  let lastToast = null;
  app.showToast = msg => { lastToast = msg; };

  recordedFetches.length = 0;

  // Trigger simulation button: Conflicto Versión
  await app.triggerTestConflictVersion();

  // Observable verification:
  assert.equal(recordedFetches.length, 0, 'No network requests may be dispatched by simulation in DEMO');
  assert.match(lastToast, /Conflicto detectado/, 'Toast should notify user about simulated conflict');
  assert.match(lastToast, /modificada por otra sesión/, 'Message should describe version conflict');
});

test('Suplente Ineligible simulation executes locally with ZERO network calls', async () => {
  resetEnv();
  globalThis.window.location.search = '?demo=1&role=coach';
  const app = new TeamAppState();
  await app.init();

  let lastToast = null;
  app.showToast = msg => { lastToast = msg; };
  app.live.activeActionItem = { id: 'injury-item-123' };

  recordedFetches.length = 0;

  await app.triggerTestConflictSubstitute();

  assert.equal(recordedFetches.length, 0, 'No network requests may be dispatched by substitute simulation in DEMO');
  assert.match(lastToast, /Error controlado/, 'Toast should notify user of handled simulation error');
  assert.match(lastToast, /no está disponible/, 'Message should state substitute is not eligible');
});

test('General DEMO Isolation: Blocks all mutating or authenticated API operations', async () => {
  resetEnv();
  globalThis.window.location.search = '?demo=1&role=coach';
  const app = new TeamAppState();
  await app.init();

  recordedFetches.length = 0;

  // Attempting publishCallup without simulation expectedVersion
  await assert.rejects(
    async () => {
      await api.callup.publishCallup('callup-123', { expectedVersion: 1, confirmWarnings: [] });
    },
    err => {
      assert.equal(err.code, 'DEMO_MODE_BLOCKED');
      assert.equal(err.status, 403);
      return true;
    },
    'Non-simulation publishCallup must be blocked with DEMO_MODE_BLOCKED'
  );

  // Attempting createNotice
  await assert.rejects(
    async () => {
      await api.notices.createNotice('season-123', { title: 'Test', message: 'Test message' });
    },
    err => {
      assert.equal(err.code, 'DEMO_MODE_BLOCKED');
      assert.equal(err.status, 403);
      return true;
    },
    'createNotice must be blocked with DEMO_MODE_BLOCKED'
  );

  // Attempting getPlayers
  await assert.rejects(
    async () => {
      await api.teams.getPlayers('season-123');
    },
    err => {
      assert.equal(err.code, 'DEMO_MODE_BLOCKED');
      assert.equal(err.status, 403);
      return true;
    },
    'getPlayers must be blocked in DEMO mode'
  );

  // Assert ZERO network calls reached fetch
  assert.equal(recordedFetches.length, 0, 'Zero network calls should have been made to backend in DEMO');
});

test('Safe Session Preservation: Exiting DEMO via exitDemo() restores real production session intact', async () => {
  resetEnv();
  const canaryToken = 'zaq-canary-secret-token-coach-998877';
  storage.set('talde_session_token', canaryToken);
  storage.set('talde_token_coach', canaryToken);

  // Enter DEMO
  globalThis.window.location.search = '?demo=1&role=coach';
  const app = new TeamAppState();
  await app.init();

  assert.equal(app.appMode, 'DEMO');
  assert.equal(api.client.getToken(), null);

  // Exit DEMO
  app.exitDemo();

  assert.equal(app.appMode, 'BETA_NORMAL', 'Exiting demo switches to BETA_NORMAL');
  assert.equal(api.client.getAppMode(), 'BETA_NORMAL', 'ApiClient switches to BETA_NORMAL');
  assert.equal(storage.get('talde_session_token'), canaryToken, 'Real session token restored to localStorage');
  assert.equal(storage.get('talde_saved_session_token') ?? null, null, 'Saved session token removed after restore');
  assert.equal(app.tokens.coach, canaryToken, 'Coach session token restored in app memory');
  assert.equal(api.client.getToken(), canaryToken, 'ApiClient bearer token restored with canary credential');
});

test('Ordinary Access: URL without ?demo=1 always starts in BETA_NORMAL even if stale storage was DEMO', async () => {
  resetEnv();
  storage.set('talde_app_mode', 'DEMO');
  globalThis.window.location.search = '';

  const app = new TeamAppState();
  await app.init();

  assert.equal(app.appMode, 'BETA_NORMAL', 'Ordinary access must ignore stale DEMO preference');
  assert.equal(storage.get('talde_app_mode'), 'BETA_NORMAL', 'Storage updated to BETA_NORMAL');
  assert.equal(api.client.getAppMode(), 'BETA_NORMAL');
});

test('Clean Beta Reset: startBetaClean() purges both active and stashed tokens', async () => {
  resetEnv();
  storage.set('talde_saved_session_token', 'stashed-token-xyz');
  storage.set('talde_saved_token_coach', 'stashed-coach-xyz');
  storage.set('talde_session_token', 'active-token-xyz');

  const app = new TeamAppState();
  app.startBetaClean();

  assert.equal(storage.get('talde_session_token') ?? null, null);
  assert.equal(storage.get('talde_saved_session_token') ?? null, null);
  assert.equal(storage.get('talde_saved_token_coach') ?? null, null);
  assert.equal(app.tokens.coach, null);
  assert.equal(api.client.getToken(), null);
});
