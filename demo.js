/**
 * demo.js - Local development, demonstration, and simulation helper.
 * STRICTLY EXCLUDED FROM PRODUCTION ARTIFACTS.
 */
import { TeamAppState } from "./app.js";
import { api, mapDomainError, idempotencyManager } from "./src/api/index.js";
import { DevService } from "./test/helpers/dev-service.js";

const devService = new DevService(api.client);

export function attachDemoTools(targetClass = TeamAppState) {
  const proto = targetClass.prototype;

  proto.toggleDemoTools = function() {
    const demoToolbar = document.getElementById("demo-toolbar");
    const demoStepCard = document.getElementById("demo-step-card");
    const isHidden = demoToolbar?.classList.contains("hidden");
    if (isHidden) {
      demoToolbar?.classList.remove("hidden");
      demoStepCard?.classList.remove("hidden");
    } else {
      demoToolbar?.classList.add("hidden");
      demoStepCard?.classList.add("hidden");
    }
  };

  proto.startDemoMode = async function() {
    this.setAppMode("DEMO");
    this.applyContextTransition({
      appMode: "DEMO",
      role: "coach",
      teamSeasonId: null,
      team: null,
      teamSeason: null,
      guardianPlayers: [],
      guardianPlayer: null,
      bearer: null
    });
    const scope = this.createScope({ mode: "DEMO", role: "coach" });
    await this.resetBackendDataset(true);
    if (!this.isScopeActive(scope) || this.appMode !== "DEMO") return;
    this.applyDemoUI();
    this.goToScreen("v2_00_onboarding_welcome", "onboard");
    this.showToast("✓ Modo DEMO: Escenario S. D. Indautxu cargado (PostgreSQL sincronizado).");
  };

  proto.exitDemo = function() {
    this.setAppMode("BETA_NORMAL");
    if (typeof window !== "undefined" && window.history && window.history.replaceState) {
      try {
        const url = new URL(window.location.href);
        url.searchParams.delete("demo");
        url.searchParams.delete("role");
        url.searchParams.delete("step");
        window.history.replaceState({}, document.title, url.pathname + (url.search ? url.search : ""));
      } catch {}
    }
    this.goToScreen("v2_00_onboarding_welcome", "onboard");
    this.showToast("Has salido del modo demostración. Sesión real restaurada.");
  };

  proto.confirmResetBeta = function() {
    const modal = document.getElementById("reset-beta-modal");
    if (modal) modal.classList.remove("hidden");
  };

  proto.cancelResetBeta = function() {
    const modal = document.getElementById("reset-beta-modal");
    if (modal) modal.classList.add("hidden");
  };

  proto.executeResetBeta = async function() {
    this.contextGeneration++;
    this.currentSessionId = null;
    this.clearAllManagedTimers();
    this.abortAllInFlight();
    api.client.setToken(null);
    try {
      const modal = document.getElementById("reset-beta-modal");
      if (modal) modal.classList.add("hidden");

      if (this.appMode === "DEMO") {
        this.resetDemo();
        this.showToast("✓ Entorno DEMO reiniciado en memoria (sin afectar a producción).");
      } else {
        await devService.emptyDatabase();
        this.showToast("✓ Entorno BETA vaciado completamente en PostgreSQL y navegador.");
      }

      // Clear browser storage
      try {
        localStorage.clear();
        sessionStorage.clear();
      } catch (e) {
        console.warn("Storage clear exception:", e);
      }

      // Clear tokens, idempotency keys, and synchronized state
      this.tokens = { coach: null, parent: null };
      idempotencyManager.keys.clear();
      this.live = {
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

      this.beta = {
        teamSeasonId: null,
        team: null,
        teamSeason: null,
        joinCode: null,
        players: [],
        pendingRequests: [],
        lastInvitation: null,
        verifiedInvitation: null,
        guardianPlayer: null,
        guardianPlayers: []
      };

      this.purgePrivateFormsAndDom();

      this.appMode = null;
      this.currentRole = "onboard";
      this.currentStepIndex = 0;

      // Hide demo UI controls
      document.getElementById("demo-mode-badge")?.classList.add("hidden");
      document.getElementById("demo-toolbar")?.classList.add("hidden");
      document.getElementById("demo-step-card")?.classList.add("hidden");

      // Navigate back to clean beta entry screen
      this.goToScreen("beta_entry_screen", "onboard");
      this.updateBottomNav();
      this.updateRoleUI();
      this.updateStepUI();
    } catch (err) {
      this.showToast(`Error al reiniciar entorno beta: ${mapDomainError(err)}`);
    }
  };

  proto.applyDemoUI = function() {
    const badgeText = document.getElementById("welcome-club-badge-text");
    if (badgeText) badgeText.textContent = "S. D. Indautxu · Infantil A";
    const demoCard = document.getElementById("welcome-demo-indicator-card");
    if (demoCard) demoCard.classList.remove("hidden");

    const coachBadge = document.getElementById("coach-club-badge");
    if (coachBadge) coachBadge.textContent = "S. D. Indautxu";
    const teamName = document.getElementById("team-name");
    if (teamName) teamName.value = "Infantil A";
    const clubName = document.getElementById("club-name");
    if (clubName) clubName.value = "S. D. Indautxu";
    const pitchLoc = document.getElementById("pitch-location");
    if (pitchLoc) pitchLoc.value = "Campo Municipal Indautxu";

    const bootstrapContainer = document.getElementById("coach-bootstrap-action-container");
    if (bootstrapContainer) bootstrapContainer.classList.add("hidden");

    const rosterBanner = document.getElementById("coach-roster-banner");
    if (rosterBanner) rosterBanner.classList.remove("hidden");
    const bannerIcon = document.getElementById("coach-roster-banner-icon");
    if (bannerIcon) bannerIcon.innerHTML = `<span class="material-symbols-outlined text-[20px] font-bold" data-icon="check_circle">check_circle</span>`;
    const bannerTitle = document.getElementById("coach-roster-banner-title");
    if (bannerTitle) bannerTitle.textContent = "✓ 18 jugadores precargados para esta temporada";
    const bannerDesc = document.getElementById("coach-roster-banner-desc");
    if (bannerDesc) bannerDesc.textContent = "(cargados en la plantilla del equipo)";

    const coachNotice = document.getElementById("coach-clean-backend-notice");
    if (coachNotice) coachNotice.classList.add("hidden");

    const coachCodeSection = document.getElementById("coach-code-section");
    if (coachCodeSection) coachCodeSection.classList.remove("hidden");
    const rosterMgmtSection = document.getElementById("coach-roster-management-section");
    if (rosterMgmtSection) rosterMgmtSection.classList.add("hidden");

    const coachReadyBadge = document.getElementById("coach-ready-badge");
    if (coachReadyBadge) coachReadyBadge.textContent = "¡Equipo creado con éxito!";
    const coachReadyTitle = document.getElementById("coach-ready-title");
    if (coachReadyTitle) coachReadyTitle.textContent = "Tu equipo está listo";
    const coachReadyDesc = document.getElementById("coach-ready-desc");
    if (coachReadyDesc) coachReadyDesc.textContent = "Las familias necesitan este código para solicitar unirse a tu equipo:";
    const coachCode = document.getElementById("coach-code-display");
    if (coachCode) coachCode.textContent = "INDA16";
    const coachShareBtn = document.getElementById("coach-share-btn");
    if (coachShareBtn) coachShareBtn.classList.remove("hidden");
    const coachFooter = document.getElementById("coach-footer-text");
    if (coachFooter) coachFooter.textContent = "Talde Hemendik! • Gestión de cantera S. D. Indautxu";

    const parentNotice = document.getElementById("parent-clean-backend-notice");
    if (parentNotice) parentNotice.classList.add("hidden");
    const parentCodeInput = document.getElementById("parent-join-code-input");
    if (parentCodeInput) {
      parentCodeInput.value = "INDA16";
      parentCodeInput.readOnly = true;
    }
    const parentCodeBadge = document.getElementById("parent-code-valid-badge");
    if (parentCodeBadge) parentCodeBadge.classList.remove("hidden");
    const parentTeamCard = document.getElementById("parent-located-team-card");
    if (parentTeamCard) parentTeamCard.classList.remove("hidden");
    const parentPlayerSec = document.getElementById("parent-player-select-section");
    if (parentPlayerSec) parentPlayerSec.classList.remove("hidden");
    const parentClaimSec = document.getElementById("parent-claim-player-section");
    if (parentClaimSec) parentClaimSec.classList.add("hidden");

    const tutorName = document.getElementById("tutor-name");
    if (tutorName) tutorName.value = "Elena Gómez";
    const tutorEmail = document.getElementById("tutor-email");
    if (tutorEmail) tutorEmail.value = "elena@example.test";
    const tutorPhone = document.getElementById("tutor-phone");
    if (tutorPhone) tutorPhone.value = "620 44 55 66";

    const parentValDesc = document.getElementById("parent-validation-desc");
    if (parentValDesc) parentValDesc.innerHTML = "Por protección y privacidad del menor (Privacidad del Menor), el entrenador <strong>Mikel Zubeldia</strong> validará esta solicitud antes de conceder acceso a los agenda, convocatorias y avisos del equipo.";
    const parentProtocol = document.getElementById("parent-footer-protocol");
    if (parentProtocol) parentProtocol.textContent = "Protocolo S. D. Indautxu";
  };

  proto.resetBackendDataset = async function(silent = false) {
    if (this.appMode === "DEMO") {
      this.resetDemo();
      if (!silent) this.showToast("✓ Entorno demo reiniciado en memoria (sin afectar a producción).");
      return;
    }
    try {
      await devService.resetDataset();
      this.tokens = { coach: null, parent: null };
      idempotencyManager.keys.clear();
      this.live = {
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

      const banner = document.getElementById("injury-resolved-banner");
      if (banner) banner.classList.add("hidden");

      if (!silent) {
        this.currentRole = "onboard";
        this.currentScreen = "v2_00_onboarding_welcome";
        this.currentTab = "onboard";
        this.currentStepIndex = 0;
        this.goToScreen("v2_00_onboarding_welcome", "onboard");
        this.updateBottomNav();
        this.updateRoleUI();
        this.updateStepUI();
        this.showToast("✓ Base de datos PostgreSQL y navegación reiniciadas al inicio (14/2/0/2).");
      }
    } catch (err) {
      if (!silent) {
        this.showToast(`Error al reiniciar: ${mapDomainError(err)}`);
      } else {
        console.warn("Reset dataset warning:", err);
      }
    }
  };

  proto.triggerTestConflictVersion = async function() {
    const scope = this.createScope({ role: "coach" });
    await this.ensureAuth("coach");
    if (!this.isScopeActive(scope)) return;
    try {
      const staleCallupId = this.live.callup?.id || "50000000-0000-4000-8000-000000000001";
      this.showToast("⚡ Enviando llamada con expectedVersion desactualizada (999)...");
      await api.callup.publishCallup(staleCallupId, { expectedVersion: 999, confirmWarnings: [] });
    } catch (err) {
      if (!this.isScopeActive(scope)) return;
      const msg = mapDomainError(err);
      this.showToast(`⚠️ Conflicto detectado: ${msg}`);
      console.warn("Domain error caught as expected:", err);
    }
  };

  proto.triggerTestConflictSubstitute = async function() {
    const scope = this.createScope({ role: "coach" });
    await this.ensureAuth("coach");
    if (!this.isScopeActive(scope)) return;
    try {
      if (!this.live.activeActionItem) {
        this.showToast("Primero debes registrar la baja de Ibai para que haya una incidencia abierta.");
        return;
      }
      this.showToast("⚡ Intentando sustituir con suplente no elegible...");
      await api.pending.replacePlayer(this.live.activeActionItem.id, {
        substitutePlayerId: "30000000-0000-4000-8000-000000000017",
        expectedCallupRevision: 1
      });
    } catch (err) {
      if (!this.isScopeActive(scope)) return;
      const msg = mapDomainError(err);
      this.showToast(`⚠️ Error controlado: ${msg}`);
      console.warn("Domain error caught as expected:", err);
    }
  };

  proto.resetDemo = function() {
    this.currentStepIndex = 0;
    this.switchMembership("onboard");
    this.applyCurrentStep();
    this.showToast("Demo reiniciada al inicio de Onboarding.");
  };
}

// Auto-attach when loaded
attachDemoTools(TeamAppState);
