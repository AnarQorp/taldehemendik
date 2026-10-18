import { createHmac, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";
import { DomainError } from "../domain/errors.js";
import type { AuthAdapter, AuthIdentity } from "./adapter.js";

type Challenge = { email: string; otp: string; expiresAt: number; attempts: number };

/**
 * ADAPTADOR EXCLUSIVO DE DESARROLLO Y DEMO (DevelopmentAuthAdapter)
 *
 * Utilizado para emitir y validar OTPs efímeros en memoria sin dependencias externas de SMS/Email.
 * - En producción, se sustituirá por un adaptador real de mensajería (SendGrid, Twilio, etc.).
 * - Respeta timingSafeEqual para evitar ataques de temporización en pruebas locales.
 */
export class DevelopmentAuthAdapter implements AuthAdapter {
  private challenges = new Map<string, Challenge>();
  constructor(private readonly exposeOtp = config.exposeOtp) {
    if (config.isProduction) throw new Error("Development authentication is forbidden in production");
  }

  async requestOtp(email: string) {
    const challengeId = randomUUID();
    const otp = randomInt(0, 1_000_000).toString().padStart(6, "0");
    this.challenges.set(challengeId, { email, otp, expiresAt: Date.now() + 5 * 60_000, attempts: 0 });
    // Local console output is ephemeral development delivery, never audit storage.
    console.info(JSON.stringify({ event: "dev_auth.otp_issued", email, otp, expiresInSeconds: 300 }));
    return { challengeId, ...(this.exposeOtp ? { developmentOtp: otp } : {}) };
  }

  async verifyOtp(email: string, challengeId: string, otp: string): Promise<AuthIdentity> {
    const challenge = this.challenges.get(challengeId);
    if (!challenge || challenge.email !== email || challenge.expiresAt < Date.now() || challenge.attempts >= 5) {
      throw new DomainError("AUTH_INVALID", 401, "Invalid or expired OTP challenge");
    }
    challenge.attempts += 1;
    const matches = /^\d{6}$/.test(otp) && timingSafeEqual(Buffer.from(challenge.otp), Buffer.from(otp));
    if (!matches) throw new DomainError("AUTH_INVALID", 401, "Invalid or expired OTP challenge");
    this.challenges.delete(challengeId);
    return { subject: `dev-email:${email.toLowerCase()}`, email: email.toLowerCase() };
  }

  issueAccessToken(userId: string): string {
    const payload = Buffer.from(JSON.stringify({ userId, exp: Date.now() + 8 * 60 * 60_000 })).toString("base64url");
    const signature = createHmac("sha256", config.authSecret).update(payload).digest("base64url");
    return `${payload}.${signature}`;
  }

  verifyAccessToken(token: string): { userId: string } {
    const parts = token.split(".");
    const [payload, signature] = parts;
    if (parts.length !== 2 || !payload || !signature || token.length > 2048) throw new DomainError("AUTH_INVALID", 401, "Invalid access token");
    const expected = createHmac("sha256", config.authSecret).update(payload).digest("base64url");
    if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw new DomainError("AUTH_INVALID", 401, "Invalid access token");
    let parsed: { userId: string; exp: number };
    try { parsed = JSON.parse(Buffer.from(payload, "base64url").toString()); } catch { throw new DomainError("AUTH_INVALID", 401, "Invalid access token"); }
    if (!parsed || typeof parsed.userId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(parsed.userId) || !Number.isFinite(parsed.exp)) throw new DomainError("AUTH_INVALID", 401, "Invalid access token");
    if (parsed.exp < Date.now()) throw new DomainError("AUTH_INVALID", 401, "Expired access token");
    return { userId: parsed.userId };
  }
}
