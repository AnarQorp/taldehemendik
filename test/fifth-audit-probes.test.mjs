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
let blockedFetches = 0;

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
  location: { search: '', hash: '', pathname: '/' },
  history: { replaceState() {} }
};

globalThis.fetch = () => {
  blockedFetches++;
  throw new Error('External network prohibited');
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
const { api, mapDomainError } = await import(path.join(projectRoot, 'src/api/index.js'));
const { AuthService } = await import(path.join(projectRoot, 'src/api/auth.js'));
const { ApiClient } = await import(path.join(projectRoot, 'src/api/client.js'));
const { DomainError } = await import(path.join(projectRoot, 'src/api/errors.js'));

const patches = [];
function patch(obj, key, value) {
  patches.push([obj, key, obj[key]]);
  obj[key] = value;
}

function restorePatches() {
  while (patches.length) {
    const [o, k, v] = patches.pop();
    o[k] = v;
  }
}

function fresh() {
  storage.clear();
  nodes.clear();
  timers.clear();
  api.client.setToken(null);
  const a = new TeamAppState();
  a.appMode = 'BETA_NORMAL';
  a.currentRole = 'coach';
  a.tokens.coach = 'FIXTURE-SESSION';
  a.beta.teamSeasonId = 'A';
  a.beta.team = { name: 'Team A' };
  a.beta.teamSeason = { display_label: 'A' };
  a.goToScreen = async s => { a.currentScreen = s; };
  a.showToast = m => { a.lastToast = m; };
  a.updateRoleUI = () => {};
  a.updateBottomNav = () => {};
  a.applyCleanUI = () => {};
  a.applyDemoUI = () => {};
  a.cleanInviteTokenFromUrl = () => {};
  a.renderBetaPlayersList = () => {};
  return a;
}

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((r, j) => {
    resolve = r;
    reject = j;
  });
  return { promise, resolve, reject };
};

const flush = async () => {
  for (let i = 0; i < 15; i++) await Promise.resolve();
};

function mem(id, role = 'COACH') {
  return {
    team_season_id: id,
    team_id: 'team-' + id,
    team_name: 'Team ' + id,
    display_label: id,
    role,
    status: 'ACTIVE',
    guardian_players: [{ id: 'child-' + id, first_name: 'Child', last_name: id }]
  };
}

const switchToB = async a => {
  patch(api.teams, 'getMyMemberships', async () => ({ items: [mem('B')] }));
  await a.switchTeam('B');
};

function otp(a) {
  a.otpState = { ...a.otpState, email: 'fixture@example.test', challengeId: 'fixture-challenge', role: 'coach' };
  el('modal-otp-input').value = '123456';
  el('modal-otp-auth').classList.remove('hidden');
}

test('P01: verifyOtp returns token without mutating ApiClient', async () => {
  try {
    const c = new ApiClient('http://fixture.invalid');
    c.setToken('PREVIOUS');
    patch(globalThis, 'fetch', async () => new Response(JSON.stringify({ accessToken: 'NEW' }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    }));
    const s = new AuthService(c);
    const res = await s.verifyOtp('F@EXAMPLE.TEST', 'challenge', '123456', 'Fixture');
    assert.equal(res.accessToken, 'NEW');
    assert.equal(c.getToken(), 'PREVIOUS');
    assert.equal(storage.size, 0);
  } finally {
    restorePatches();
  }
});

test('P02: Pending OTP close discards response', async () => {
  try {
    const a = fresh();
    otp(a);
    let boot = 0;
    a.otpState.onSuccess = () => boot++;
    const d = deferred();
    patch(api.auth, 'verifyOtp', () => d.promise);
    const p = a.submitOtpVerification();
    a.closeOtpModal();
    d.resolve({ accessToken: 'CANCELLED' });
    await p;
    for (const fn of timers.values()) fn();
    assert.equal(api.client.getToken(), null);
    assert.equal(storage.has('talde_session_token'), false);
    assert.equal(boot, 0);
  } finally {
    restorePatches();
  }
});

test('P03: Pending OTP team switch discards before persistence', async () => {
  try {
    const a = fresh();
    otp(a);
    const d = deferred();
    patch(api.auth, 'verifyOtp', () => d.promise);
    const p = a.submitOtpVerification();
    await switchToB(a);
    d.resolve({ accessToken: 'STALE' });
    await p;
    assert.equal(storage.has('talde_session_token'), false);
    assert.notEqual(api.client.getToken(), 'STALE');
  } finally {
    restorePatches();
  }
});

test('P04: Pending OTP session expiry prevents new session', async () => {
  try {
    const a = fresh();
    otp(a);
    const d = deferred();
    patch(api.auth, 'verifyOtp', () => d.promise);
    const p = a.submitOtpVerification();
    a.handleSessionExpired(Object.assign(new DomainError('AUTH_EXPIRED', 'expired', 401), { wasAuthenticated: true }));
    d.resolve({ accessToken: 'RESURRECTED' });
    await p;
    assert.equal(storage.has('talde_session_token'), false);
  } finally {
    restorePatches();
  }
});

test('P05: OTP delayed success callback cancelled by context change', async () => {
  try {
    const a = fresh();
    otp(a);
    let boot = 0;
    a.otpState.onSuccess = () => boot++;
    patch(api.auth, 'verifyOtp', async () => ({ accessToken: 'VALID' }));
    await a.submitOtpVerification();
    await switchToB(a);
    for (const fn of [...timers.values()]) fn();
    assert.equal(boot, 0);
  } finally {
    restorePatches();
  }
});

test('P06: OTP success from DEMO keeps mode memory consistent', async () => {
  try {
    const a = fresh();
    a.appMode = 'DEMO';
    otp(a);
    patch(api.auth, 'verifyOtp', async () => ({ accessToken: 'VALID' }));
    await a.submitOtpVerification();
    assert.equal(a.appMode, storage.get('talde_app_mode'));
  } finally {
    restorePatches();
  }
});

test('P07: BETA to DEMO purges real bearer before demo auth', async () => {
  try {
    const a = fresh();
    storage.set('talde_session_token', 'REAL');
    api.client.setToken('REAL');
    patch(api.auth, 'loginDev', async () => { throw Error('fixture: dev disabled'); });
    patch(a, 'resetBackendDataset', async () => {});
    await a.startDemoMode();
    await a.ensureAuth('coach');
    assert.notEqual(api.client.getToken(), 'REAL');
    assert.equal(storage.has('talde_session_token'), false);
    assert.equal(a.beta.teamSeasonId, null);
  } finally {
    restorePatches();
  }
});

test('P08: DEMO to BETA purges demo token and client', async () => {
  try {
    const a = fresh();
    a.appMode = 'DEMO';
    a.tokens.coach = 'demo_token_coach';
    api.client.setToken('demo_token_coach');
    a.startBetaClean();
    await a.ensureAuth('coach');
    assert.equal(api.client.getToken(), null);
    assert.equal(a.tokens.coach, null);
  } finally {
    restorePatches();
  }
});

test('P09: Role switch selects GUARDIAN team rather than old COACH team', async () => {
  try {
    const a = fresh();
    patch(api.teams, 'getMyMemberships', async () => ({ items: [mem('A'), mem('P', 'GUARDIAN')] }));
    await a.switchMembership('parent');
    assert.equal(a.currentRole, 'parent');
    assert.equal(a.beta.teamSeasonId, 'P');
    assert.equal(a.beta.guardianPlayer.id, 'child-P');
  } finally {
    restorePatches();
  }
});

test('P10: Out-of-order switchTeam keeps most recent team', async () => {
  try {
    const a = fresh();
    const d = deferred();
    let n = 0;
    patch(api.teams, 'getMyMemberships', () => ++n === 1 ? d.promise : Promise.resolve({ items: [mem('B')] }));
    const p = a.switchTeam('A');
    await a.switchTeam('B');
    d.resolve({ items: [mem('A')] });
    await p;
    assert.equal(a.beta.teamSeasonId, 'B');
  } finally {
    restorePatches();
  }
});

test('P11: Out-of-order switchMembership keeps latest role/team', async () => {
  try {
    const a = fresh();
    const d = deferred();
    let n = 0;
    patch(api.teams, 'getMyMemberships', () => ++n === 1 ? d.promise : Promise.resolve({ items: [mem('B')] }));
    const p = a.switchMembership('parent');
    await a.switchMembership('coach');
    d.resolve({ items: [mem('P', 'GUARDIAN')] });
    await p;
    assert.equal(a.currentRole, 'coach');
    assert.equal(a.beta.teamSeasonId, 'B');
  } finally {
    restorePatches();
  }
});

test('P12: loadUserContext late response discarded after team switch', async () => {
  try {
    const a = fresh();
    const d = deferred();
    patch(api.teams, 'getMyMemberships', () => d.promise);
    const p = a.loadUserContext();
    await switchToB(a);
    d.resolve({ items: [mem('A')] });
    await p;
    assert.equal(a.beta.teamSeasonId, 'B');
    assert.equal(storage.get('talde_team_season_id'), 'B');
  } finally {
    restorePatches();
  }
});

test('P13: Parent approval polling late response cannot switch back role/team', async () => {
  try {
    const a = fresh();
    a.currentRole = 'parent';
    a.tokens.parent = 'PARENT';
    const d = deferred();
    patch(api.teams, 'getMyMemberships', () => d.promise);
    const p = a.checkParentApprovalStatus(true);
    await switchToB(a);
    d.resolve({ items: [mem('P', 'GUARDIAN')] });
    await p;
    assert.equal(a.currentRole, 'coach');
    assert.equal(a.beta.teamSeasonId, 'B');
  } finally {
    restorePatches();
  }
});

test('P14: Roster delayed response after team switch is discarded', async () => {
  try {
    const a = fresh();
    const d = deferred();
    patch(api.teams, 'getPlayers', () => d.promise);
    const p = a.syncCoachRoster();
    await flush();
    await switchToB(a);
    el('roster-players-list-container').innerHTML = 'TEAM-B';
    d.resolve({ items: [{ id: 'a', first_name: 'PRIVATE-A', last_name: 'OLD' }] });
    await p;
    assert.equal(el('roster-players-list-container').innerHTML, 'TEAM-B');
  } finally {
    restorePatches();
  }
});

test('P15: Coach home delayed response after team switch is discarded', async () => {
  try {
    const a = fresh();
    const d = deferred();
    patch(api.teams, 'getPlayers', () => d.promise);
    patch(api.events, 'getEvents', async () => ({ items: [] }));
    patch(api.pending, 'getPending', async () => ({ actionItems: [], indicators: [] }));
    patch(api.teams, 'getPendingRequests', async () => ({ items: [] }));
    const p = a.syncCoachHome();
    await flush();
    await switchToB(a);
    el('coach-players-count').textContent = 'B';
    d.resolve({ items: [{ id: 'a' }] });
    await p;
    assert.equal(el('coach-players-count').textContent, 'B');
  } finally {
    restorePatches();
  }
});

test('P16: Coach home captures generation before first await', async () => {
  try {
    const a = fresh();
    let authCalls = 0;
    const d = deferred();
    patch(a, 'ensureAuth', () => ++authCalls === 1 ? d.promise : Promise.resolve());
    const requested = [];
    patch(api.teams, 'getPlayers', async id => { requested.push(id); return { items: [{ id: 'a' }] }; });
    patch(api.events, 'getEvents', async () => ({ items: [] }));
    patch(api.pending, 'getPending', async () => ({ actionItems: [], indicators: [] }));
    patch(api.teams, 'getPendingRequests', async () => ({ items: [] }));
    const p = a.syncCoachHome();
    await switchToB(a);
    el('coach-players-count').textContent = 'B';
    d.resolve();
    await p;
    assert.equal(el('coach-players-count').textContent, 'B');
  } finally {
    restorePatches();
  }
});

test('P17: Session purge erases actual private roster DOM and OTP state', async () => {
  const a = fresh();
  el('tutor-email').value = 'private@example.test';
  el('roster-players-list-container').innerHTML = 'PRIVATE CHILD';
  a.otpState.email = 'private@example.test';
  a.otpState.challengeId = 'PRIVATE-CHALLENGE';
  a.clearSessionData();
  assert.deepEqual(
    { email: el('tutor-email').value, roster: el('roster-players-list-container').innerHTML, challenge: a.otpState.challengeId },
    { email: '', roster: '', challenge: null }
  );
});

test('P18: Authenticated 401 purges actual roster and child DOM', async () => {
  const a = fresh();
  el('roster-players-list-container').innerHTML = 'PRIVATE CHILD';
  el('parent-home-player-name').textContent = 'PRIVATE CHILD';
  el('tutor-email').value = 'private@example.test';
  a.handleSessionExpired(Object.assign(new DomainError('AUTH_EXPIRED', 'expired', 401), { wasAuthenticated: true }));
  assert.equal(el('tutor-email').value, '');
  assert.equal(el('roster-players-list-container').innerHTML, '');
  assert.equal(el('parent-home-player-name').textContent, '');
});

test('P19: Session purge invalidates pending roster read', async () => {
  try {
    const a = fresh();
    const d = deferred();
    patch(api.teams, 'getPlayers', () => d.promise);
    const p = a.syncCoachRoster();
    await flush();
    a.handleSessionExpired(Object.assign(new DomainError('AUTH_EXPIRED', 'expired', 401), { wasAuthenticated: true }));
    el('roster-players-list-container').innerHTML = '';
    d.resolve({ items: [{ id: 'a', first_name: 'RESURRECTED', last_name: 'PRIVATE' }] });
    await p;
    assert.equal(el('roster-players-list-container').innerHTML, '');
  } finally {
    restorePatches();
  }
});

test('P20: Unauthenticated OTP 401 keeps session and returns invalid OTP message', async () => {
  const a = fresh();
  api.client.setToken('EXISTING');
  const e = Object.assign(new DomainError('AUTH_INVALID', 'wrong', 401), { wasAuthenticated: false, path: '/auth/otp/verify' });
  a.handleSessionExpired(e);
  assert.equal(a.beta.teamSeasonId, 'A');
  assert.equal(api.client.getToken(), 'EXISTING');
  assert.match(mapDomainError(e), /Código no válido/);
});

test('P21: ApiClient classifies unauthenticated vs authenticated 401', async () => {
  try {
    patch(globalThis, 'fetch', async () => new Response(JSON.stringify({ error: { code: 'AUTH_INVALID', message: 'wrong' } }), {
      status: 401,
      headers: { 'content-type': 'application/json' }
    }));
    const c = new ApiClient('http://fixture.invalid');
    let e;
    try { await c.post('/auth/otp/verify', {}); } catch (x) { e = x; }
    assert.equal(e.wasAuthenticated, false);
    assert.match(mapDomainError(e), /Código no válido/);
    c.setToken('FIXTURE');
    try { await c.get('/v1/me/memberships'); } catch (x) { e = x; }
    assert.equal(e.wasAuthenticated, true);
    assert.match(mapDomainError(e), /Sesión no válida/);
  } finally {
    restorePatches();
  }
});

test('P22: Late individual join request cannot restore linked private identity', async () => {
  try {
    const a = fresh();
    a.beta.individualInviteToken = 'fixture-invite';
    const d = deferred();
    patch(api.invitations, 'requestIndividualLink', () => d.promise);
    const p = a.executeParentJoin({ isIndividual: true, tutorEmail: 'f@example.test', tutorName: 'Fixture' });
    await switchToB(a);
    d.resolve({ id: 'fixture-request', player_id: 'OLD-CHILD' });
    await p;
    assert.equal(storage.has('talde_linked_player_id'), false);
    assert.equal(a.beta.linkedPlayerId, undefined);
  } finally {
    restorePatches();
  }
});

test('P23: Late approval cannot update different team counts or reload home', async () => {
  try {
    const a = fresh();
    const d = deferred();
    patch(api.teams, 'approveGuardianRequest', () => d.promise);
    let syncs = 0;
    patch(a, 'syncCoachHome', async () => syncs++);
    const p = a.approveBetaGuardianRequest('fixture-request');
    await switchToB(a);
    el('coach-linked-count').textContent = '10';
    d.resolve({});
    await p;
    assert.equal(el('coach-linked-count').textContent, '10');
    assert.equal(syncs, 0);
  } finally {
    restorePatches();
  }
});

test('P24: Late event create cannot wipe new form or navigate new role', async () => {
  try {
    const a = fresh();
    el('event-date').value = '2026-10-20';
    el('event-time').value = '18:00';
    const d = deferred();
    patch(api.events, 'createEvent', () => d.promise);
    patch(a, 'syncCoachHome', async () => {});
    const p = a.submitCreateEvent();
    await flush();
    await switchToB(a);
    a.currentScreen = 'B-SCREEN';
    el('event-title').value = 'NEW DRAFT FOR B';
    d.resolve({ title: 'Old A event' });
    await p;
    assert.equal(el('event-title').value, 'NEW DRAFT FOR B');
    assert.equal(a.currentScreen, 'B-SCREEN');
  } finally {
    restorePatches();
  }
});

test('P25: Late coach bootstrap cannot replace selected team/context', async () => {
  try {
    const a = fresh();
    const d = deferred();
    patch(api.teams, 'bootstrap', () => d.promise);
    const p = a.executeCoachBootstrap({ teamName: 'A', displayLabel: 'A', category: 'U12', coachEmail: 'f@example.test', coachName: 'Fixture' });
    await switchToB(a);
    d.resolve({ teamSeason: { id: 'OLD-A' }, team: { name: 'Old A' }, joinCode: 'OLD-CODE' });
    await p;
    assert.equal(a.beta.teamSeasonId, 'B');
  } finally {
    restorePatches();
  }
});

test('P26: Parent nested callup read cannot render old team after generation switch', async () => {
  try {
    const a = fresh();
    a.currentRole = 'parent';
    a.beta.guardianPlayer = { id: 'CHILD-A', first_name: 'Child', last_name: 'A' };
    a.beta.guardianPlayers = [a.beta.guardianPlayer];
    patch(api.events, 'getEvents', async () => ({ items: [{ id: 'EV-A', title: 'PRIVATE EVENT A', starts_at: '2026-10-20T12:00:00Z', callup_enabled: true, callup_status: 'PUBLISHED' }] }));
    const d = deferred();
    patch(api.callup, 'getPlayerCallupStatus', () => d.promise);
    const p = a.syncParentHome();
    await flush();
    await switchToB(a);
    el('parent-commitments-list').innerHTML = 'TEAM B CONTENT';
    d.resolve({ called: true, revision: 1 });
    await p;
    assert.equal(el('parent-commitments-list').innerHTML, 'TEAM B CONTENT');
  } finally {
    restorePatches();
  }
});

test('P27: Agenda late response is discarded after team switch', async () => {
  try {
    const a = fresh();
    const d = deferred();
    patch(api.events, 'getEvents', () => d.promise);
    const p = a.syncCoachAgenda();
    await flush();
    await switchToB(a);
    el('agenda-events-container').innerHTML = 'TEAM B';
    d.resolve({ items: [{ id: 'OLD', title: 'OLD A', starts_at: '2026-10-20T12:00:00Z' }] });
    await p;
    assert.equal(el('agenda-events-container').innerHTML, 'TEAM B');
  } finally {
    restorePatches();
  }
});

test('P28: Event hub late event read discarded after team switch', async () => {
  try {
    const a = fresh();
    a.beta.activeEventId = 'EV-A';
    const d = deferred();
    patch(api.events, 'getEvent', () => d.promise);
    const p = a.syncEventHubNormal();
    await flush();
    await switchToB(a);
    el('hub-hero-title').textContent = 'TEAM B';
    d.resolve({ id: 'EV-A', title: 'OLD A' });
    await p;
    assert.equal(el('hub-hero-title').textContent, 'TEAM B');
    assert.equal(a.live.availability, null);
  } finally {
    restorePatches();
  }
});

test('P29: Player detail nested callup read discards old child after switch', async () => {
  try {
    const a = fresh();
    a.currentRole = 'parent';
    a.beta.guardianPlayer = { id: 'CHILD-A', first_name: 'Private', last_name: 'Child A' };
    a.beta.guardianPlayers = [a.beta.guardianPlayer];
    patch(api.events, 'getEvents', async () => ({ items: [{ id: 'EV-A', title: 'PRIVATE EVENT A', starts_at: '2026-10-20T12:00:00Z', callup_enabled: true, callup_status: 'PUBLISHED' }] }));
    const d = deferred();
    patch(api.callup, 'getPlayerCallupStatus', () => d.promise);
    const p = a.syncPlayerDetail();
    await flush();
    await switchToB(a);
    el('player-detail-parent-container').innerHTML = 'TEAM B';
    d.resolve({ called: true });
    await p;
    assert.equal(el('player-detail-parent-container').innerHTML, 'TEAM B');
  } finally {
    restorePatches();
  }
});

test('P30: Authenticated 401 on roster actually expires session', async () => {
  try {
    const a = fresh();
    storage.set('talde_session_token', 'FIXTURE-SESSION');
    patch(api.teams, 'getPlayers', async () => {
      throw Object.assign(new DomainError('AUTH_EXPIRED', 'expired', 401), { wasAuthenticated: true });
    });
    await a.syncCoachRoster();
    assert.equal(storage.has('talde_session_token'), false);
    assert.equal(a.tokens.coach, null);
  } finally {
    restorePatches();
  }
});

test('P31: Stale 401 from old loadUserContext cannot erase new team session', async () => {
  try {
    const a = fresh();
    const d = deferred();
    patch(api.teams, 'getMyMemberships', () => d.promise);
    const p = a.loadUserContext();
    await switchToB(a);
    storage.set('talde_session_token', 'NEW-B');
    a.tokens.coach = 'NEW-B';
    api.client.setToken('NEW-B');
    d.reject(Object.assign(new DomainError('AUTH_EXPIRED', 'old expired', 401), { wasAuthenticated: true }));
    await p;
    assert.equal(api.client.getToken(), 'NEW-B');
    assert.equal(a.beta.teamSeasonId, 'B');
  } finally {
    restorePatches();
  }
});

test('P32: Late invitation lookup must not restore old invitation in new team', async () => {
  try {
    const a = fresh();
    const d = deferred();
    patch(api.invitations, 'getInvitation', () => d.promise);
    const p = a.setupIndividualInvite('OLD-INVITE');
    await switchToB(a);
    a.beta.verifiedInvitation = null;
    d.resolve({ team: { name: 'Old A' }, teamSeason: { displayLabel: 'U12', seasonLabel: '2026/27' } });
    await p;
    assert.equal(a.beta.verifiedInvitation, null);
  } finally {
    restorePatches();
  }
});

test('P33: Injury hub late pending read cannot restore prior action item', async () => {
  try {
    const a = fresh();
    const d = deferred();
    patch(api.pending, 'getPending', () => d.promise);
    patch(api.pending, 'getReplacementCandidates', async () => ({ items: [] }));
    const p = a.syncEventHubInjury();
    await flush();
    await switchToB(a);
    d.resolve({ actionItems: [{ id: 'OLD-ACTION', type: 'CALLED_PLAYER_UNAVAILABLE', status: 'OPEN' }] });
    await p;
    assert.equal(a.live.activeActionItem, null);
  } finally {
    restorePatches();
  }
});
