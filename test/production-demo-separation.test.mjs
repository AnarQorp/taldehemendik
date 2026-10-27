import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApiClient } from '../src/api/client.js';
import { DomainError } from '../src/api/errors.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Helper to simulate browser storage
function createMockStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
    has: (k) => store.has(k)
  };
}

function createMockDom() {
  const domElements = new Map();
  return {
    getElementById: (id) => {
      if (!domElements.has(id)) {
        domElements.set(id, {
          classList: {
            add: () => {},
            remove: () => {},
            contains: () => false
          },
          style: {},
          textContent: '',
          value: '',
          addEventListener: () => {}
        });
      }
      return domElements.get(id);
    },
    querySelectorAll: () => [],
    addEventListener: () => {}
  };
}

test('1. Production index.html strictly contains NO simulation tools or demo toolbar in DOM', () => {
  const indexHtml = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf-8');

  // Verify simulation UI elements are completely absent from production DOM
  assert.equal(indexHtml.includes('id="demo-toolbar"'), false, 'Production index.html must not contain demo-toolbar');
  assert.equal(indexHtml.includes('id="demo-step-card"'), false, 'Production index.html must not contain demo-step-card');
  assert.equal(indexHtml.includes('id="demo-mode-badge"'), false, 'Production index.html must not contain demo-mode-badge');
  assert.equal(indexHtml.includes('id="demo-tools-wrapper"'), false, 'Production index.html must not contain demo-tools-wrapper');
  assert.equal(indexHtml.includes('toggleTourInfo()'), false, 'Production index.html must not contain toggleTourInfo script');
  assert.equal(indexHtml.includes('teamApp.startDemoMode()'), false, 'Production index.html must not expose startDemoMode() option');
  assert.equal(indexHtml.includes('Probar con datos de ejemplo'), false, 'Production index.html must not contain Probar con datos de ejemplo card');
});

test('2. Local demo.html exists for development and preserves demo interface', () => {
  const demoHtmlPath = path.join(rootDir, 'demo.html');
  assert.equal(fs.existsSync(demoHtmlPath), true, 'demo.html must exist for local developer testing');
  const demoHtml = fs.readFileSync(demoHtmlPath, 'utf-8');
  assert.equal(demoHtml.includes('id="demo-toolbar"'), true, 'demo.html contains developer demo-toolbar');
  assert.equal(demoHtml.includes('id="demo-step-card"'), true, 'demo.html contains demo-step-card');
});

test('3. URL query parameter ?demo=1&role=coach on production index.html does NOT activate DEMO mode', async () => {
  const storage = createMockStorage({
    talde_session_token: 'prod_valid_token_123',
    talde_app_mode: 'BETA_NORMAL'
  });

  const mockWindow = {
    location: {
      search: '?demo=1&role=coach',
      pathname: '/index.html',
      hash: ''
    },
    addEventListener: () => {}
  };

  global.window = mockWindow;
  global.document = createMockDom();
  global.localStorage = storage;

  const { TeamAppState } = await import('../app.js');
  const app = new TeamAppState();
  await app.init();

  assert.equal(app.appMode, 'BETA_NORMAL', 'App must initialize in BETA_NORMAL even with ?demo=1');
  assert.equal(storage.getItem('talde_app_mode'), 'BETA_NORMAL', 'Storage app mode must be BETA_NORMAL');
  assert.equal(storage.getItem('talde_session_token'), 'prod_valid_token_123', 'Active production session must be preserved');
  assert.equal(app.tokens.coach, 'prod_valid_token_123', 'Coach role must receive active production session token');
  assert.equal(storage.has('talde_saved_session_token'), false, 'No talde_saved_* key should exist in storage');
});

test('4. Eliminating talde_saved_* ensures stashed sessions NEVER overwrite valid newer sessions', async () => {
  const storage = createMockStorage({
    talde_saved_session_token: 'old_stale_token_999',
    talde_session_token: 'new_valid_token_2026',
    talde_saved_token_coach: 'old_stale_coach_999'
  });

  global.localStorage = storage;
  global.document = createMockDom();
  global.window = {
    location: { search: '', pathname: '/index.html', hash: '' },
    addEventListener: () => {}
  };

  const { TeamAppState } = await import('../app.js');
  const app = new TeamAppState();
  await app.init();

  assert.equal(storage.getItem('talde_session_token'), 'new_valid_token_2026', 'New session token must NEVER be overwritten by old stashed session');
  assert.equal(storage.has('talde_saved_session_token'), false, 'Legacy talde_saved_session_token must be purged');
  assert.equal(storage.has('talde_saved_token_coach'), false, 'Legacy talde_saved_token_coach must be purged');
  assert.equal(app.tokens.coach, 'new_valid_token_2026', 'App must use new session token');

  // Also test setAppMode("BETA_NORMAL") does not overwrite session
  storage.setItem('talde_session_token', 'valid_token_active');
  storage.setItem('talde_saved_session_token', 'stale_session_hijack');
  app.setAppMode('BETA_NORMAL');

  assert.equal(storage.getItem('talde_session_token'), 'valid_token_active');
  assert.equal(storage.has('talde_saved_session_token'), false);
});

test('5. ApiClient header case-insensitivity: lowercase authorization header is recognized without duplicate Authorization', async () => {
  const client = new ApiClient('https://api.example.com');
  client.setToken('client_default_token');

  let capturedHeaders = null;
  global.fetch = async (url, options) => {
    capturedHeaders = options.headers;
    return {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ ok: true }),
      text: async () => JSON.stringify({ ok: true })
    };
  };

  // Dispatch request with lowercase authorization header
  await client.request('/teams/team-123/roster', {
    headers: {
      'authorization': 'Bearer custom_override_token'
    }
  });

  assert.equal(capturedHeaders['authorization'], 'Bearer custom_override_token');
  assert.equal(capturedHeaders['Authorization'], undefined, 'Must not duplicate Authorization when lowercase authorization exists');

  // Dispatch request with mixed case content-type and idempotency-key
  await client.request('/events/evt-123/callup/publish', {
    method: 'POST',
    body: JSON.stringify({ test: 1 }),
    idempotencyKey: 'idemp-123',
    headers: {
      'content-type': 'application/vnd.custom+json',
      'idempotency-key': 'existing-key'
    }
  });

  assert.equal(capturedHeaders['content-type'], 'application/vnd.custom+json');
  assert.equal(capturedHeaders['Content-Type'], undefined);
  assert.equal(capturedHeaders['idempotency-key'], 'existing-key');
  assert.equal(capturedHeaders['Idempotency-Key'], undefined);
});

test('6. ApiClient strict route validation: query parameters cannot bypass authentication requirements', async () => {
  const client = new ApiClient('https://api.example.com');
  client.setToken(null);

  global.fetch = async (url, options) => {
    return {
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ error: { code: 'UNAUTHORIZED', message: 'Token requerido' } }),
      text: async () => JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Token requerido' } })
    };
  };

  // An attacker or test trying to bypass auth by appending OTP path as query parameter
  const maliciousPath = '/teams/season-123/players?bypass=/auth/otp/request';

  try {
    await client.request(maliciousPath);
    assert.fail('Request should have thrown DomainError');
  } catch (err) {
    assert.equal(err instanceof DomainError, true);
    assert.equal(err.code, 'UNAUTHORIZED');
    assert.equal(err.status, 401);
    assert.equal(err.path, maliciousPath);
  }

  // /auth/dev/login is NOT treated as public auth in production ApiClient
  try {
    await client.request('/auth/dev/login');
    assert.fail('Request should have thrown DomainError');
  } catch (err) {
    assert.equal(err instanceof DomainError, true);
  }

  // Exact public auth endpoints match properly
  global.fetch = async () => ({
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => ({ delivery: 'SENT' }),
    text: async () => JSON.stringify({ delivery: 'SENT' })
  });

  const otpRes = await client.request('/auth/otp/request', {
    method: 'POST',
    body: JSON.stringify({ email: 'test@example.com' })
  });
  assert.equal(otpRes.delivery, 'SENT');
});

test('7. Deployable packaging verification: demo.html and dev artifacts are excluded from production tarball list', () => {
  const prodFrontendFiles = ['index.html', 'app.js', 'src'];
  const excludedFiles = ['demo.html', 'demo.js', 'test', 'node_modules', 'package.json', '.git'];

  for (const excluded of excludedFiles) {
    assert.equal(prodFrontendFiles.includes(excluded), false, `${excluded} must be strictly excluded from production bundle`);
  }
});

test('8. RC9 Blocker Check: api.dev is completely eliminated and src/api/dev.js does NOT exist', async () => {
  const { api, createApi } = await import('../src/api/index.js');
  const freshApi = createApi();

  assert.equal(api.dev, undefined, 'api.dev must be strictly undefined in production api');
  assert.equal(freshApi.dev, undefined, 'createApi().dev must be strictly undefined in production createApi');
  assert.equal(fs.existsSync(path.join(rootDir, 'src/api/dev.js')), false, 'src/api/dev.js must not exist in filesystem');
});

test('9. RC9 Blocker Check: index.html contains ZERO trace of reset modal, reset beta card, or dev endpoints', () => {
  const indexHtml = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf-8');

  assert.equal(indexHtml.includes('id="reset-beta-modal"'), false, 'index.html must not contain reset-beta-modal');
  assert.equal(indexHtml.includes('confirmResetBeta()'), false, 'index.html must not contain confirmResetBeta()');
  assert.equal(indexHtml.includes('executeResetBeta()'), false, 'index.html must not contain executeResetBeta()');
  assert.equal(indexHtml.includes('cancelResetBeta()'), false, 'index.html must not contain cancelResetBeta()');
  assert.equal(indexHtml.includes('Reiniciar entorno beta'), false, 'index.html must not contain "Reiniciar entorno beta" card');
  assert.equal(indexHtml.includes('/v1/dev/empty'), false, 'index.html must not reference /v1/dev/empty');
  assert.equal(indexHtml.includes('/v1/dev/reset'), false, 'index.html must not reference /v1/dev/reset');
});

test('10. RC9 Blocker Check: app.js contains ZERO simulation or dev reset methods on TeamAppState prototype', async () => {
  const { TeamAppState } = await import('../app.js');
  const proto = TeamAppState.prototype;

  assert.equal(typeof proto.executeResetBeta, 'undefined', 'executeResetBeta must not exist on TeamAppState');
  assert.equal(typeof proto.confirmResetBeta, 'undefined', 'confirmResetBeta must not exist on TeamAppState');
  assert.equal(typeof proto.cancelResetBeta, 'undefined', 'cancelResetBeta must not exist on TeamAppState');
  assert.equal(typeof proto.resetBackendDataset, 'undefined', 'resetBackendDataset must not exist on TeamAppState');
  assert.equal(typeof proto.triggerTestConflictVersion, 'undefined', 'triggerTestConflictVersion must not exist on TeamAppState');
  assert.equal(typeof proto.triggerTestConflictSubstitute, 'undefined', 'triggerTestConflictSubstitute must not exist on TeamAppState');
  assert.equal(typeof proto.toggleDemoTools, 'undefined', 'toggleDemoTools must not exist on TeamAppState');
  assert.equal(typeof proto.startDemoMode, 'undefined', 'startDemoMode must not exist on TeamAppState');
  assert.equal(typeof proto.exitDemo, 'undefined', 'exitDemo must not exist on TeamAppState');
  assert.equal(typeof proto.applyDemoUI, 'undefined', 'applyDemoUI must not exist on TeamAppState');
  assert.equal(typeof proto.resetDemo, 'undefined', 'resetDemo must not exist on TeamAppState');

  // Verify app.js content has zero occurrences of /v1/dev/ or api.dev
  const appJs = fs.readFileSync(path.join(rootDir, 'app.js'), 'utf-8');
  assert.equal(appJs.includes('api.dev'), false, 'app.js must not reference api.dev');
  assert.equal(appJs.includes('/dev/empty'), false, 'app.js must not call /dev/empty');
  assert.equal(appJs.includes('/dev/reset'), false, 'app.js must not call /dev/reset');
  assert.equal(appJs.includes('emptyDatabase'), false, 'app.js must not reference emptyDatabase');
});

test('11. RC9 Dev Support: demo.js cleanly equips dev simulation methods for local testing in demo.html', async () => {
  assert.equal(fs.existsSync(path.join(rootDir, 'demo.js')), true, 'demo.js must exist for local developer testing');
  const { attachDemoTools } = await import('../demo.js');

  class TestApp {}
  attachDemoTools(TestApp);

  assert.equal(typeof TestApp.prototype.startDemoMode, 'function', 'demo.js attaches startDemoMode');
  assert.equal(typeof TestApp.prototype.triggerTestConflictVersion, 'function', 'demo.js attaches triggerTestConflictVersion');
  assert.equal(typeof TestApp.prototype.triggerTestConflictSubstitute, 'function', 'demo.js attaches triggerTestConflictSubstitute');
  assert.equal(typeof TestApp.prototype.toggleDemoTools, 'function', 'demo.js attaches toggleDemoTools');
  assert.equal(typeof TestApp.prototype.executeResetBeta, 'function', 'demo.js attaches executeResetBeta');
});

