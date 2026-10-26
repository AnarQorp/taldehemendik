export class AuthService {
  constructor(client) {
    this.client = client;
  }

  async requestOtp(email, options = {}) {
    const normalizedEmail = String(email || "").trim().toLowerCase();
    const payload = { email: normalizedEmail };
    if (options.invitationToken) payload.invitationToken = options.invitationToken;
    if (options.teamCode) payload.teamCode = options.teamCode;
    return this.client.post("/auth/otp/request", payload, options);
  }

  async verifyOtp(email, challengeId, otp, displayName, options = {}) {
    const normalizedEmail = String(email || "").trim().toLowerCase();
    const cleanOtp = String(otp || "").trim();
    const res = await this.client.post("/auth/otp/verify", {
      email: normalizedEmail,
      challengeId,
      otp: cleanOtp,
      displayName: displayName ? String(displayName).trim() : undefined
    }, options);
    return res;
  }

  async loginDev(email, displayName, options = {}) {
    const reqRes = await this.requestOtp(email, options);
    if (options?.signal?.aborted) return null;
    if (typeof options?.checkActive === "function" && !options.checkActive()) return null;
    if (!reqRes?.developmentOtp) {
      throw new Error("DEV_AUTH_UNAVAILABLE: La autenticación de desarrollo no está disponible en producción.");
    }
    const challengeId = reqRes.challengeId;
    if (options?.signal?.aborted) return null;
    if (typeof options?.checkActive === "function" && !options.checkActive()) return null;
    const authRes = await this.verifyOtp(email, challengeId, reqRes.developmentOtp, displayName, options);
    return authRes;
  }
}

