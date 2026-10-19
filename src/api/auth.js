export class AuthService {
  constructor(client) {
    this.client = client;
  }

  async requestOtp(email, options = {}) {
    const normalizedEmail = String(email || "").trim().toLowerCase();
    return this.client.post("/auth/otp/request", { email: normalizedEmail }, options);
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

  async loginDev(email, displayName) {
    const reqRes = await this.requestOtp(email);
    if (!reqRes?.developmentOtp) {
      throw new Error("DEV_AUTH_UNAVAILABLE: La autenticación de desarrollo no está disponible en producción.");
    }
    const challengeId = reqRes.challengeId;
    const authRes = await this.verifyOtp(email, challengeId, reqRes.developmentOtp, displayName);
    if (authRes?.accessToken) {
      this.client.setToken(authRes.accessToken);
    }
    return authRes;
  }
}

