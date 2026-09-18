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
  constructor(private readonly exposeOtp = config.exposeOtp) {}

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
    const matches = timingSafeEqual(Buffer.from(challenge.otp), Buffer.from(otp.padStart(6, "0")));
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
    const [payload, signature] = token.split(".");
    if (!payload || !signature) throw new DomainError("AUTH_INVALID", 401, "Invalid access token");
    const expected = createHmac("sha256", config.authSecret).update(payload).digest("base64url");
    if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw new DomainError("AUTH_INVALID", 401, "Invalid access token");
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString()) as { userId: string; exp: number };
    if (parsed.exp < Date.now()) throw new DomainError("AUTH_INVALID", 401, "Expired access token");
    return { userId: parsed.userId };
  }
}
