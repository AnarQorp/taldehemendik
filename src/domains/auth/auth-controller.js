/**
 * Talde Hemendik! — Auth Domain Controller (REV-02)
 * Encapsula la autenticación por OTP, gobernanza de sesiones y clasificación de errores 401.
 */

import { api, mapDomainError } from "../../api/index.js";

export class AuthDomainController {
  constructor(app) {
    this.app = app;
  }

  get sessionManager() {
    return this.app.sessionManager;
  }

  get coordinator() {
    return this.app.contextCoordinator;
  }

  handleSessionExpired(sourceError, scope = null) {
    if (scope && !this.app.isScopeActive(scope)) {
      return;
    }
    const isAuth = sourceError ? Boolean(sourceError.wasAuthenticated) : true;
    if (sourceError && (!sourceError.wasAuthenticated || sourceError.path?.includes("/auth/otp/")) && sourceError.code !== "AUTH_REQUIRED") {
      return;
    }
    if (sourceError?.requestToken) {
      const activeToken = api.client.getToken() || this.app.tokens[this.app.currentRole] || this.app.tokens.coach || this.app.tokens.parent;
      if (activeToken && sourceError.requestToken !== activeToken) {
        return;
      }
    }
    const reqSession = sourceError?.requestSessionId || scope?.sessionId || scope?.currentSessionId || null;
    if (reqSession && this.app.currentSessionId && reqSession !== this.app.currentSessionId) {
      return;
    }

    const effectiveScope = scope || (reqSession || sourceError?.requestToken ? {
      sessionId: reqSession,
      bearerToken: sourceError?.requestToken,
      ...(sourceError?.requestCredentialEpoch != null ? { credentialEpoch: sourceError.requestCredentialEpoch } : {})
    } : null);

    if (this.sessionManager) {
      const handled = this.sessionManager.handleUnauthorized(effectiveScope, isAuth);
      if (!handled && effectiveScope) {
        return;
      }
    }

    this.app.contextGeneration++;
    this.app.currentSessionId = null;
    this.app.clearAllManagedTimers();
    this.app.abortAllInFlight();
    this.app.otpOpSeq++;
    if (this.app.otpAbortController) {
      try { this.app.otpAbortController.abort(); } catch {}
    }
    if (this.app.isOtpModalOpen()) {
      this.app.closeOtpModal();
    }
    this.app.clearSessionData();
    this.app.purgePrivateFormsAndDom();
    this.app.showToast("Tu sesión ha caducado. Por favor, identifícate de nuevo.");
  }

  clearSessionData() {
    this.app.contextGeneration++;
    this.app.currentSessionId = null;
    this.app._explicitIntentSeq = (this.app._explicitIntentSeq || 0) + 1;
    this.app.clearAllManagedTimers();
    this.app.abortAllInFlight();
    this.app.otpOpSeq++;
    if (this.app.otpAbortController) {
      try { this.app.otpAbortController.abort(); } catch {}
    }
    if (this.app.isOtpModalOpen()) {
      this.app.closeOtpModal();
    }
    if (this.sessionManager) {
      this.sessionManager.clearSession();
    }
    if (this.app.concurrencyTracker) {
      this.app.concurrencyTracker.reset();
    }
    if (this.app.resourceStore) {
      this.app.resourceStore.clearAll();
    }
    if (this.coordinator) {
      this.coordinator.purgeContext();
    }
    localStorage.removeItem("talde_session_token");
    localStorage.removeItem("talde_token_coach");
    localStorage.removeItem("talde_token_parent");
    localStorage.removeItem("talde_team_season_id");
    localStorage.removeItem("talde_active_role");
    localStorage.removeItem("talde_last_screen");
    localStorage.removeItem("talde_linked_player_id");
    localStorage.removeItem("talde_join_code");
    localStorage.removeItem("talde_players");
    localStorage.removeItem("talde_active_event_id");
    this.app.tokens = { coach: null, parent: null };
    api.client.setToken(null);
    this.app.selectedCandidateId = null;
    this.app.selectedSubstitute = null;
    this.app.otpState = {
      email: null,
      challengeId: null,
      role: null,
      displayName: null,
      isVerifying: false,
      isRequesting: false,
      onSuccess: null
    };
    this.app.beta = {
      teamSeasonId: null,
      team: null,
      teamSeason: null,
      joinCode: null,
      players: [],
      pendingRequests: [],
      lastInvitation: null,
      verifiedInvitation: null,
      guardianPlayer: null,
      guardianPlayers: [],
      activeEventId: null
    };
    this.app.live = {
      events: [],
      activeEvent: null,
      availability: null,
      callup: null,
      pending: null,
      parentCallupStatus: null,
      parentAvailability: null,
      candidates: [],
      activeActionItem: null,
      unconfirmedWarnings: []
    };
    this.app.purgePrivateFormsAndDom();
    if (typeof document !== "undefined") {
      const codeDisplay = document.getElementById("coach-code-display");
      if (codeDisplay) codeDisplay.textContent = "------";
      const coachCodeSection = document.getElementById("coach-code-section");
      if (coachCodeSection) coachCodeSection.classList.add("hidden");
      const rosterSection = document.getElementById("coach-roster-management-section");
      if (rosterSection) rosterSection.classList.add("hidden");
      const parentNotice = document.getElementById("parent-clean-backend-notice");
      if (parentNotice) parentNotice.classList.add("hidden");
    }
    if (typeof this.app.goToScreen === "function") {
      this.app.goToScreen("v2_00_onboarding_welcome", "onboard");
    }
  }
}
