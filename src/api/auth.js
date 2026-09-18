export class AuthService {
  constructor(client) {
    this.client = client;
  }

  async requestOtp(email) {
    return this.client.post("/auth/otp/request", { email });
  }

  async verifyOtp(email, challengeId, otp, displayName) {
    const res = await this.client.post("/auth/otp/verify", {
      email,
      challengeId,
      otp,
      displayName
    });
    if (res?.accessToken) {
      this.client.setToken(res.accessToken);
    }
    return res;
  }

  async loginDev(email, displayName) {
    const reqRes = await this.requestOtp(email);
    const challengeId = reqRes.challengeId;
    const otp = reqRes.developmentOtp || "000000";
    const authRes = await this.verifyOtp(email, challengeId, otp, displayName);
    return authRes;
  }
}
