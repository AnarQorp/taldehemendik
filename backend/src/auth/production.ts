import { createHmac, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import nodemailer from "nodemailer";
import type pg from "pg";
import { config, assertProductionConfiguration } from "../config.js";
import { authPool } from "../db/pool.js";
import { DomainError } from "../domain/errors.js";
import type { AuthAdapter, AuthIdentity } from "./adapter.js";
import { DevelopmentAuthAdapter } from "./development-adapter.js";
import type { OnboardingAdmissionProof } from "./policy.js";
import { AuthPolicy } from "./policy.js";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const invalid = () => new DomainError("AUTH_INVALID", 401, "Invalid or expired authentication credential");
export type OtpDelivery = { sendMail(message: { from: string; to: string; subject: string; text: string }): Promise<unknown> };
type Options = {
  pool?: pg.Pool;
  delivery?: OtpDelivery;
  secret?: string;
  issuer?: string;
  audience?: string;
  from?: string;
  now?: () => number;
  allowedEmails?: string[] | Set<string>;
  policyRevision?: string;
};

/** Production-only email OTP: delivery via SMTP, hashed challenges in PostgreSQL. */
export class ProductionAuthAdapter implements AuthAdapter {
  readonly productionSafe = true;
  readonly policy: AuthPolicy;
  private readonly db: pg.Pool;
  private readonly delivery: OtpDelivery;
  private readonly secret: string;
  private readonly issuer: string;
  private readonly audience: string;
  private readonly from: string;
  private readonly now: () => number;
  constructor(options: Options = {}) {
    this.db = options.pool ?? authPool;
    this.secret = options.secret ?? config.authSecret;
    if (this.secret.length < 32) throw new Error("Production auth requires a secret of at least 32 characters");
    this.issuer = options.issuer ?? config.authTokenIssuer;
    this.audience = options.audience ?? config.authTokenAudience;
    this.from = options.from ?? config.smtp.from;
    this.now = options.now ?? Date.now;

    const rawAllowed = options.allowedEmails !== undefined
      ? options.allowedEmails
      : (process.env.TALDE_AUTH_ALLOWED_EMAILS !== undefined
          ? process.env.TALDE_AUTH_ALLOWED_EMAILS.split(/[,;\s]+/).map(v => v.trim().toLowerCase()).filter(Boolean)
          : config.authAllowedEmails);

    const rawRevision = options.policyRevision !== undefined
      ? options.policyRevision
      : (process.env.TALDE_AUTH_POLICY_REVISION !== undefined
          ? process.env.TALDE_AUTH_POLICY_REVISION.trim()
          : config.authPolicyRevision);

    this.policy = new AuthPolicy(rawAllowed, rawRevision);

    if (this.policy.allowedEmails.size === 0) {
      throw new Error("Production auth requires a non-empty TALDE_AUTH_ALLOWED_EMAILS allowlist");
    }
    if (!this.policy.policyRevision || this.policy.policyRevision.length === 0) {
      throw new Error("Production auth requires TALDE_AUTH_POLICY_REVISION to be configured");
    }

    if (config.isProduction) assertProductionConfiguration();
    this.delivery = options.delivery ?? nodemailer.createTransport({
      host: config.smtp.host, port: config.smtp.port, secure: config.smtp.secure,
      requireTLS: true, tls: { rejectUnauthorized: true, minVersion: "TLSv1.2" },
      connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
      ...(config.smtp.user ? { auth: { user: config.smtp.user, pass: config.smtp.pass } } : {})
    });
  }
  isEmailAllowed(email: string): boolean {
    return this.policy.isEmailAllowed(email);
  }
  private digest(value: string) { return createHmac("sha256", this.secret).update(value).digest("hex"); }
  private async tx<T>(fn: (db: pg.PoolClient) => Promise<T>): Promise<T> {
    const db = await this.db.connect();
    try { await db.query("BEGIN"); await db.query("SET LOCAL ROLE talde_auth"); const result = await fn(db); await db.query("COMMIT"); return result; }
    catch (error) { await db.query("ROLLBACK"); throw error; }
    finally { db.release(); }
  }
  async requestOtp(input: string, onboarding?: OnboardingAdmissionProof) {
    const email = input.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw invalid();

    // 1. Admission Gate: verify authorization BEFORE DB connection or SMTP calls
    if (!this.policy.isAdmitted(email, onboarding)) {
      throw invalid();
    }

    const challengeId = randomUUID();
    const otp = randomInt(0, 1_000_000).toString().padStart(6, "0");
    await this.tx(async db => {
      // Serialize per-mailbox issuance across processes; retain spent challenges for throttle evidence.
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 31415))", [email]);
      const recent = await db.query("SELECT count(*)::int AS count, max(created_at) AS latest FROM auth_challenges WHERE email=$1 AND created_at > now()-interval '1 hour'", [email]);
      if (recent.rows[0].count >= 5 || (recent.rows[0].latest && Date.now() - new Date(recent.rows[0].latest).getTime() < 60000)) throw new DomainError("AUTH_INVALID", 429, "Please wait before requesting another code");
      await db.query("UPDATE auth_challenges SET consumed_at=now() WHERE email=$1 AND consumed_at IS NULL", [email]);
      await db.query(
        "INSERT INTO auth_challenges(id,email,otp_hash,expires_at) VALUES($1,$2,$3,now()+interval '5 minutes')",
        [challengeId, email, this.digest(`${challengeId}:${email}:${otp}:${this.policy.policyRevision}`)]
      );
    });
    try { await this.delivery.sendMail({ from: this.from, to: email, subject: "Talde Hemendik! — Código de acceso", text: `Tu código de acceso es ${otp}. Caduca en 5 minutos. Si no lo has solicitado, ignora este mensaje.` }); }
    catch {
      await this.tx(async db => { await db.query("UPDATE auth_challenges SET consumed_at=now() WHERE id=$1", [challengeId]); });
      // Never propagate SMTP errors (may contain credentials, recipient or message body).
      throw new DomainError("AUTH_INVALID", 503, "Authentication email delivery is unavailable");
    }
    return { challengeId };
  }
  async verifyOtp(input: string, challengeId: string, otp: string): Promise<AuthIdentity> {
    const email = input.trim().toLowerCase();
    if (!uuid.test(challengeId)) throw invalid();
    const accepted = await this.tx(async db => {
      const result = await db.query("SELECT *, expires_at > now() AS unexpired FROM auth_challenges WHERE id=$1 FOR UPDATE", [challengeId]);
      const row = result.rows[0];
      if (!row || row.email !== email || row.consumed_at || !row.unexpired || row.attempts >= 5) return false;
      const expected = Buffer.from(row.otp_hash, "hex");
      const actual = Buffer.from(this.digest(`${challengeId}:${email}:${otp}:${this.policy.policyRevision}`), "hex");
      const matches = /^\d{6}$/.test(otp) && expected.length === actual.length && timingSafeEqual(expected, actual);
      await db.query("UPDATE auth_challenges SET attempts=attempts+1, consumed_at=CASE WHEN $2 OR attempts+1>=5 THEN now() ELSE consumed_at END WHERE id=$1", [challengeId, matches]);
      return matches;
    });
    if (!accepted) throw invalid();
    return { subject: `email:${email}`, email };
  }
  issueAccessToken(userId: string, email?: string) {
    if (!uuid.test(userId)) throw invalid();
    const iat = Math.floor(this.now() / 1000);
    const resolvedEmail = (email ?? `user-${userId}@talde.internal`).trim().toLowerCase();
    const claims: Record<string, unknown> = {
      sub: userId,
      iss: this.issuer,
      aud: this.audience,
      iat,
      exp: iat + 3600,
      email: resolvedEmail,
      policyRevision: this.policy.policyRevision,
      pol: this.policy.policyRevision
    };
    const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
    return `${payload}.${createHmac("sha256", this.secret).update(payload).digest("base64url")}`;
  }
  verifyAccessToken(token: string): { userId: string; email?: string } {
    try {
      if (token.length > 2048) throw invalid();
      const parts = token.split(".");
      const [payload, signature] = parts;
      if (parts.length !== 2 || !payload || !signature || !/^[A-Za-z0-9_-]+$/.test(payload) || !/^[A-Za-z0-9_-]{43}$/.test(signature)) throw invalid();
      const expected = createHmac("sha256", this.secret).update(payload).digest();
      const actual = Buffer.from(signature, "base64url");
      if (actual.length !== expected.length || !timingSafeEqual(expected, actual)) throw invalid();
      const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
      const now = Math.floor(this.now() / 1000);
      if (typeof claims.sub !== "string" || !uuid.test(claims.sub) || claims.iss !== this.issuer || claims.aud !== this.audience || !Number.isSafeInteger(claims.exp) || !Number.isSafeInteger(claims.iat) || claims.exp <= now || claims.iat > now + 30 || claims.exp <= claims.iat || claims.exp - claims.iat > 3600) throw invalid();
      return this.policy.validateTokenClaims(claims);
    } catch { throw invalid(); }
  }
}
export function createAuthAdapter(): AuthAdapter {
  assertProductionConfiguration();
  return config.isProduction ? new ProductionAuthAdapter() : new DevelopmentAuthAdapter();
}
export function assertProductionAuthAdapter(adapter: AuthAdapter) {
  if (config.isProduction && !(adapter instanceof ProductionAuthAdapter)) throw new Error("Production forbids development/custom authentication adapters");
}
