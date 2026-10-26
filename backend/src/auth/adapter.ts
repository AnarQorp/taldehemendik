import type { OnboardingAdmissionProof } from "./policy.js";

export type AuthIdentity = { subject: string; email: string };

export interface AuthAdapter {
  requestOtp(email: string, onboarding?: OnboardingAdmissionProof): Promise<{ challengeId: string; developmentOtp?: string }>;
  verifyOtp(email: string, challengeId: string, otp: string): Promise<AuthIdentity>;
  issueAccessToken(userId: string, email?: string): string;
  verifyAccessToken(token: string): { userId: string; email?: string };
  isEmailAllowed?(email: string): boolean;
}
