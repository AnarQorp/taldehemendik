import { DomainError } from "../domain/errors.js";

const invalid = () => new DomainError("AUTH_INVALID", 401, "Invalid or unauthorized authentication credential");

export interface OnboardingAdmissionProof {
  invitationToken?: string;
  teamCode?: string;
  isPrevalidated?: boolean;
}

export class AuthPolicy {
  readonly allowedEmails: ReadonlySet<string>;
  readonly policyRevision: string;

  constructor(allowedEmails: string[] | Set<string> = [], policyRevision: string = "") {
    this.allowedEmails = new Set(
      Array.from(allowedEmails).map(email => email.trim().toLowerCase()).filter(Boolean)
    );
    this.policyRevision = (policyRevision ?? "").trim();
  }

  isEmailAllowed(email: string): boolean {
    const normalized = email.trim().toLowerCase();
    if (this.allowedEmails.size === 0) return true;
    return this.allowedEmails.has(normalized);
  }

  isAdmitted(email: string, onboarding?: OnboardingAdmissionProof): boolean {
    if (this.isEmailAllowed(email)) return true;
    if (onboarding?.isPrevalidated) return true;
    if (onboarding?.invitationToken || onboarding?.teamCode) return true;
    return false;
  }

  validateTokenClaims(claims: Record<string, unknown>): { userId: string; email?: string } {
    if (typeof claims.sub !== "string") throw invalid();

    if (this.policyRevision.length > 0) {
      if (typeof claims.email !== "string" || !claims.email || !claims.email.includes("@")) {
        throw invalid();
      }
      const tokenRevision = claims.policyRevision ?? claims.pol;
      if (typeof tokenRevision !== "string" || tokenRevision !== this.policyRevision) {
        throw invalid();
      }
    }

    return { userId: claims.sub };
  }
}
