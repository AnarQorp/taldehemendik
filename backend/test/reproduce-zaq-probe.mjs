// Exact replication of ZaQ's probe-admission.mjs against our current backend sources
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import ts from 'typescript';
import { z as zod } from 'zod';

const root = fs.existsSync(path.resolve('src/auth/production.ts'))
  ? path.resolve('.')
  : path.resolve(import.meta.dirname, '..');
const env = Object.freeze({
  NODE_ENV: 'production',
  TALDE_RUNTIME_MODE: 'operational',
  DATABASE_URL: 'postgres://fixture@db.invalid/main',
  AUTH_DATABASE_URL: 'postgres://fixture-auth@db.invalid/main',
  AUTH_TOKEN_SECRET: 'offline-proof-not-a-real-secret-0123456789abcdef',
  ALLOWED_ORIGINS: 'https://proof.invalid',
  SMTP_HOST: 'smtp.invalid',
  SMTP_FROM: 'sender@fixture.invalid',
  TALDE_AUTH_ALLOWED_EMAILS: 'allowed@fixture.invalid',
  TALDE_AUTH_POLICY_REVISION: 'offline-proof-v1'
});

function synthetic(context, name, exports) {
  return new vm.SyntheticModule(Object.keys(exports), function () {
    for (const [k, v] of Object.entries(exports)) this.setExport(k, v);
  }, { context, identifier: name });
}

async function probe(label, rootDir) {
  const counts = { connect: 0, queries: 0, smtp_mock_calls: 0 };
  const client = {
    query: async (sql) => {
      counts.queries++;
      return { rows: sql.includes('count(*)') ? [{ count: 0, latest: null }] : [] };
    },
    release() {}
  };
  const pool = {
    connect: async () => {
      counts.connect++;
      return client;
    }
  };
  const delivery = {
    sendMail: async () => {
      counts.smtp_mock_calls++;
      return {};
    }
  };
  const context = vm.createContext({
    process: { env },
    console: { log() {}, warn() {}, error() {} },
    Buffer, Date, Set, Map, Object, JSON, Error, RegExp, Number, String, Array
  });
  const cache = new Map();

  async function load(file) {
    if (cache.has(file)) return cache.get(file);
    const source = fs.readFileSync(file, 'utf8');
    const js = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
    }).outputText;
    const m = new vm.SourceTextModule(js, { context, identifier: file });
    cache.set(file, m);
    await m.link(async (spec, ref) => {
      if (spec === 'node:crypto') return synthetic(context, spec, crypto);
      if (spec === 'nodemailer') return synthetic(context, spec, { default: { createTransport: () => delivery } });
      if (spec === 'zod') return synthetic(context, spec, zod);
      if (spec.endsWith('/db/pool.js')) return synthetic(context, spec, { authPool: pool });
      if (spec === './development-adapter.js') return synthetic(context, spec, { DevelopmentAuthAdapter: class {} });
      if (spec.startsWith('.')) return load(path.resolve(path.dirname(ref.identifier), spec).replace(/\.js$/, '.ts'));
      throw new Error('Unexpected import ' + spec);
    });
    return m;
  }

  const module = await load(rootDir + '/src/auth/production.ts');
  await module.evaluate();
  const adapter = new module.namespace.ProductionAuthAdapter({ pool, delivery, secret: env.AUTH_TOKEN_SECRET });

  let otpRejected = false;
  try {
    await adapter.requestOtp('outside@fixture.invalid');
  } catch (error) {
    if (error.code !== 'AUTH_INVALID' && error.statusCode !== 401 && error.status !== 401) throw error;
    otpRejected = true;
  }

  const claims = {
    sub: 'f244153e-e7d3-4b7c-81d5-ef96585de752',
    iss: 'talde-hemendik',
    aud: 'talde-private-api',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600
  };
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const token = payload + '.' + crypto.createHmac('sha256', env.AUTH_TOKEN_SECRET).update(payload).digest('base64url');

  let missingPolicyClaimsRejected = false;
  try {
    adapter.verifyAccessToken(token);
  } catch (error) {
    missingPolicyClaimsRejected = true;
  }

  return {
    label,
    otpRejected,
    ...counts,
    missingPolicyClaimsRejected,
    source_sha256: crypto.createHash('sha256').update(fs.readFileSync(rootDir + '/src/auth/production.ts')).digest('hex')
  };
}

const result = await probe('repaired-beta-0.2', root);
console.log(JSON.stringify({ scope: 'OFFLINE_AUTH_SOURCE_WITH_MOCKED_DB_AND_SMTP_NO_NETWORK', result }, null, 2));

const blocked = !result.otpRejected || result.connect !== 0 || result.smtp_mock_calls !== 0 || !result.missingPolicyClaimsRejected;
process.exitCode = blocked ? 78 : 0;
if (blocked) {
  console.error("FAIL: Probe blocked");
} else {
  console.log("PASS: Probe succeeded with exit code 0!");
}
