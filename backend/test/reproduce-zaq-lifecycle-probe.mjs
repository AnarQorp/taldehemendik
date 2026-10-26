// Replicates ZaQ probe-policy-lifecycle.mjs against our current backend sources
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import crypto from "node:crypto";
import ts from "typescript";
import { z as zod } from "zod";

const root = fs.existsSync(path.resolve("src/auth/production.ts"))
  ? path.resolve(".")
  : path.resolve(import.meta.dirname, "..");

const env0 = {
  NODE_ENV: "production",
  TALDE_RUNTIME_MODE: "operational",
  DATABASE_URL: "postgres://fixture@db.invalid/main",
  AUTH_DATABASE_URL: "postgres://fixture-auth@db.invalid/main",
  AUTH_TOKEN_SECRET: "offline-proof-not-a-real-secret-0123456789abcdef",
  ALLOWED_ORIGINS: "https://proof.invalid",
  SMTP_HOST: "smtp.invalid",
  SMTP_FROM: "sender@fixture.invalid",
  TALDE_AUTH_ALLOWED_EMAILS: "allowed@fixture.invalid",
  TALDE_AUTH_POLICY_REVISION: "policy-v1"
};

function synth(ctx, name, values) {
  return new vm.SyntheticModule(Object.keys(values), function () {
    for (const [k, v] of Object.entries(values)) this.setExport(k, v);
  }, { context: ctx, identifier: name });
}

function memory() {
  const state = { connects: 0, queries: 0, mails: 0, challenge: null, otp: null };
  const client = {
    release() {},
    async query(sql, args = []) {
      state.queries++;
      if (sql.includes("count(*)")) return { rows: [{ count: 0, latest: null }] };
      if (sql.startsWith("INSERT INTO auth_challenges")) {
        state.challenge = { id: args[0], email: args[1], otp_hash: args[2], attempts: 0, consumed_at: null, unexpired: true };
      }
      if (sql.startsWith("SELECT *, expires_at")) {
        return { rows: state.challenge ? [state.challenge] : [] };
      }
      return { rows: [], rowCount: 0 };
    }
  };
  return {
    state,
    pool: { async connect() { state.connects++; return client; } },
    delivery: { async sendMail(msg) { state.mails++; state.otp = msg.text.match(/\b[0-9]{6}\b/)?.[0]; return {}; } }
  };
}

async function adapter(rootDir, env, mem) {
  const ctx = vm.createContext({
    process: { env },
    console: { log() {}, error() {}, warn() {} },
    Buffer, Date, Set, Map, Object, JSON, Error, RegExp, Number, String, Array
  });
  const cache = new Map();
  async function load(file) {
    if (cache.has(file)) return cache.get(file);
    const js = ts.transpileModule(fs.readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
    }).outputText;
    const m = new vm.SourceTextModule(js, { context: ctx, identifier: file });
    cache.set(file, m);
    await m.link(async (s, ref) => {
      if (s === "node:crypto") return synth(ctx, s, crypto);
      if (s === "nodemailer") return synth(ctx, s, { default: { createTransport: () => mem.delivery } });
      if (s === "zod") return synth(ctx, s, zod);
      if (s.endsWith("/db/pool.js")) return synth(ctx, s, { authPool: mem.pool });
      if (s === "./development-adapter.js") return synth(ctx, s, { DevelopmentAuthAdapter: class {} });
      if (s.startsWith(".")) return load(path.resolve(path.dirname(ref.identifier), s).replace(/\.js$/, ".ts"));
      throw new Error("Unexpected import " + s);
    });
    return m;
  }
  const m = await load(rootDir + "/src/auth/production.ts");
  await m.evaluate();
  return new m.namespace.ProductionAuthAdapter({ pool: mem.pool, delivery: mem.delivery, secret: env.AUTH_TOKEN_SECRET });
}

const results = [];

for (const [name, override] of [["empty_allowlist", { TALDE_AUTH_ALLOWED_EMAILS: "" }], ["missing_revision", { TALDE_AUTH_POLICY_REVISION: "" }]]) {
  const mem = memory();
  let startupRejected = false, otpAccepted = false;
  let a;
  try {
    a = await adapter(root, { ...env0, ...override }, mem);
  } catch {
    startupRejected = true;
  }
  if (a) {
    try {
      await a.requestOtp(name === "empty_allowlist" ? "outside@fixture.invalid" : "allowed@fixture.invalid");
      otpAccepted = true;
    } catch {}
  }
  results.push({ label: "candidate-beta-0.2", test: name, startupRejected, otpAccepted, dbConnects: mem.state.connects, smtpMockCalls: mem.state.mails });
}

const mem = memory();
const old = await adapter(root, { ...env0 }, mem);
await old.requestOtp("allowed@fixture.invalid");
if (!mem.state.challenge || !mem.state.otp) throw new Error("Probe setup failed");

const current = await adapter(root, { ...env0, TALDE_AUTH_POLICY_REVISION: "policy-v2" }, mem);
let oldChallengeAccepted = false;
try {
  const identity = await current.verifyOtp("allowed@fixture.invalid", mem.state.challenge.id, mem.state.otp);
  oldChallengeAccepted = identity.email === "allowed@fixture.invalid";
} catch {}
results.push({ label: "candidate-beta-0.2", test: "policy_revision_changed_after_challenge_issue", oldChallengeAccepted });

console.log(JSON.stringify({ scope: "OFFLINE_EXACT_AUTH_SOURCES_MOCKED_DB_SMTP_NO_NETWORK", results }, null, 2));

const blocked = results.some(r => r.oldChallengeAccepted || ("startupRejected" in r && !r.startupRejected));
process.exitCode = blocked ? 78 : 0;
if (blocked) {
  console.error("FAIL: Extended lifecycle gate blocked with exit 78");
} else {
  console.log("PASS: Extended lifecycle gate passed with exit 0!");
}
