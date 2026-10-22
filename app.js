/**
 * Talde Hemendik! V2 - Product Architecture Controller
 * Conectado con Backend Real Fastify + PostgreSQL (Vertical Slice 01 & 02)
 *
 * Principio Fundamental:
 * - Evidencia observable sobre narrativa
 * - Integración real con endpoints sin reimplementar lógica de negocio en frontend
 * - Persistencia íntegra en PostgreSQL
 */

import { api, DEMO_CONFIG, mapDomainError, idempotencyManager, escapeHtml } from "./src/api/index.js";
import { ConcurrencyTracker, SessionManager, ResourceStore, ContextCoordinator } from "./src/core/index.js";
import { AuthDomainController, TeamsDomainController, FamiliesDomainController, EventsDomainController } from "./src/domains/index.js";

// Dataset histórico de jugadores para pantallas visuales / no migradas
const SQUAD_DATA = [
  { id: 1, number: 1, name: "Gorka Elejalde", role: "Portero", status: "CONVOCADO", rsvp: "Confirmado", tutor: "Iker Elejalde", phone: "611 22 33 44" },
  { id: 2, number: 2, name: "Eneko Zabala", role: "Defensa", status: "CONVOCADO", rsvp: "Confirmado", tutor: "Joseba Zabala", phone: "622 33 44 55" },
  { id: 3, number: 3, name: "Julen Ortiz", role: "Defensa", status: "CONVOCADO", rsvp: "Confirmado", tutor: "Xabier Ortiz", phone: "633 44 55 66" },
  { id: 4, number: 4, name: "Jon Beltrán", role: "Defensa", status: "CONVOCADO", rsvp: "Confirmado", tutor: "Iñaki Beltrán", phone: "644 55 66 77" },
  { id: 5, number: 5, name: "Markel Saenz", role: "Centrocampista", status: "CONVOCADO", rsvp: "Confirmado", tutor: "Elena Saenz", phone: "655 66 77 88" },
  { id: 6, number: 6, name: "Ander Lopez", role: "Centrocampista", status: "CONVOCADO", rsvp: "Confirmado", tutor: "Begoña Lopez", phone: "666 77 88 99" },
  { id: 7, number: 7, name: "Unai Martinez", role: "Delantero", status: "CONVOCADO", rsvp: "Confirmado", tutor: "Kepa Martinez", phone: "677 88 99 00" },
  { id: 8, number: 8, name: "Oier Gomez", role: "Centrocampista", status: "CONVOCADO", rsvp: "Confirmado", tutor: "Maite Gomez", phone: "688 99 00 11" },
  { id: 9, number: 9, name: "Ibai Aranguren", role: "Delantero Centro", status: "NO_DISPONIBLE", rsvp: "No disponible (está enfermo)", tutor: "Elena Gómez (Madre)", phone: "620 44 55 66" },
  { id: 10, number: 10, name: "Mikel Zabaleta", role: "Centrocampista", status: "CONVOCADO", rsvp: "Confirmado", tutor: "Aitor Zabaleta", phone: "699 00 11 22" },
  { id: 11, number: 11, name: "Aimar Ortiz", role: "Delantero", status: "CONVOCADO", rsvp: "Confirmado", tutor: "Miren Ortiz", phone: "600 11 22 33" },
  { id: 12, number: 12, name: "Nahia Garcia", role: "Centrocampista", status: "RESERVA", rsvp: "Confirmó disponibilidad", tutor: "Nerea Garcia", phone: "612 23 34 45" },
  { id: 13, number: 13, name: "Asier Urkijo", role: "Centrocampista", status: "NO_DISPONIBLE", rsvp: "No puede (Viaje familiar)", tutor: "Mikel Urkijo", phone: "623 34 45 56" },
  { id: 14, number: 14, name: "Iker Baroja", role: "Extremo", status: "CONVOCADO", rsvp: "Sin respuesta", tutor: "Carmen Baroja", phone: "634 45 56 67" },
  { id: 15, number: 15, name: "Irati Fernandez", role: "Delantera", status: "RESERVA", rsvp: "Confirmó disponibilidad", tutor: "Patxi Fernandez", phone: "645 56 67 78" },
  { id: 16, number: 16, name: "Ane Mintegi", role: "Centrocampista", status: "SUSTITUTA_ELEGIDA", rsvp: "Disponible · Reserva", tutor: "Iñaki Mintegi", phone: "644 55 66 77" },
  { id: 17, number: 17, name: "Olatz Bengoa", role: "Defensa", status: "NO_DISPONIBLE", rsvp: "No puede asistir", tutor: "Sonia Bengoa", phone: "656 67 78 89" },
  { id: 18, number: 18, name: "Peio Gómez", role: "Defensa", status: "NO_DISPONIBLE", rsvp: "Sin respuesta", tutor: "Asier Gómez", phone: "667 78 89 90" }
];

const GUIDED_STEPS = [
  {
    step: 1,
    role: "onboard",
    screen: "v2_00_onboarding_welcome",
    tab: "onboard",
    title: "1. Acceso Inicial: ¿Cómo vas a utilizar la app?",
    desc: "Pantalla única de bienvenida para todo el club. El usuario elige su función: 'Soy entrenador / staff' o 'Soy padre, madre o tutor'. Sin apps separadas.",
    actionHint: "Pulsa 'Soy entrenador / staff' para iniciar la creación del equipo."
  },
  {
    step: 2,
    role: "coach",
    screen: "v2_00_coach_create_team",
    tab: "onboard",
    title: "2. Flujo Entrenador: Crear equipo & Código INDA16",
    desc: "Alta inmediata con 3 datos clave: Nombre, Deporte y Categoría. 18 jugadores precargados. Código INDA16 generado para compartir por WhatsApp.",
    actionHint: "Pulsa 'Ir a la mesa del entrenador' para acceder al panel con la puesta en marcha."
  },
  {
    step: 3,
    role: "parent",
    screen: "v2_00_parent_join_team",
    tab: "onboard",
    title: "3. Flujo Familia: Solicitud de Vinculación (Privacidad Menor)",
    desc: "Elena Gómez introduce el código INDA16. El código identifica al club, pero NO muestra datos privados. Elena solicita vincularse a su hijo Ibai (#9).",
    actionHint: "Pulsa 'Enviar solicitud de vinculación' para notificar al entrenador."
  },
  {
    step: 4,
    role: "coach",
    screen: "v2_01_coach_home",
    tab: "inicio",
    title: "4. Mesa del Entrenador: Puesta en marcha & Aprobación",
    desc: "El inicio muestra temporalmente el estado de puesta en marcha (18 jugadores, 12 vinculadas, 6 pendientes) y la solicitud de Elena Gómez. Con 1 toque el míster aprueba.",
    actionHint: "Pulsa 'Aceptar' en la solicitud de Elena Gómez para vincularla a Ibai (#9)."
  },
  {
    step: 5,
    role: "coach",
    screen: "v2_01_coach_home",
    tab: "inicio",
    title: "5. La Mesa del Entrenador: Triage y Pendiente de ti",
    desc: "El míster visualiza de inmediato la alerta crítica del Torneo Indautxu en Pendiente de ti según los datos reales de PostgreSQL.",
    actionHint: "Pulsa en 'Revisar' o 'Preparar convocatoria' en la tarjeta del Torneo Indautxu."
  },
  {
    step: 6,
    role: "coach",
    screen: "v2_02_coach_agenda",
    tab: "agenda",
    title: "6. Agenda Semanal: Cronología y Fases de Eventos",
    desc: "Los eventos del equipo ordenados en el tiempo desde la base de datos real: Torneo Indautxu, entrenamientos y estado de respuesta.",
    actionHint: "Pulsa 'Gestionar evento' en la tarjeta del Torneo Indautxu."
  },
  {
    step: 7,
    role: "coach",
    screen: "v2_05_event_hub_normal",
    tab: "agenda",
    title: "7. Event Hub: Disponibilidad como protagonista (14/2/0/2)",
    desc: "Conectado a PostgreSQL: 14 Disponibles, 2 No disponibles, 0 Duda, 2 Sin respuesta. Preparación de convocatoria con advertencias controladas.",
    actionHint: "Pulsa 'Preparar y publicar convocatoria (12 jugadores)' para publicar la revisión 1."
  },
  {
    step: 8,
    role: "parent",
    screen: "v2_07_parent_home",
    tab: "inicio",
    title: "8. Inicio Tutor: Estado de convocatoria y acción pendiente",
    desc: "Elena Gómez consulta el estado real de su hijo Ibai (#9) en la convocatoria publicada y la solicitud de disponibilidad.",
    actionHint: "Pulsa 'Responder disponibilidad' en la tarjeta del Torneo Indautxu."
  },
  {
    step: 9,
    role: "parent",
    screen: "v2_08_parent_rsvp",
    tab: "inicio",
    title: "9. RSVP Familiar: NO PUEDE ASISTIR",
    desc: "Elena indica que Ibai NO PUEDE ASISTIR. El backend registra la baja y genera automáticamente un ActionItem para el entrenador.",
    actionHint: "Selecciona 'NO PUEDE ASISTIR' y pulsa 'Guardar respuesta'."
  },
  {
    step: 10,
    role: "coach",
    screen: "v2_01_coach_home",
    tab: "inicio",
    title: "10. Mesa del Entrenador: Incidencia de Baja Sobrevenida",
    desc: "Mikel recibe 'Baja de última hora: Ibai Aranguren no puede asistir' en 'Pendiente de ti' con opción directa de resolver.",
    actionHint: "Pulsa 'Resolver baja' para ver las sustitutas disponibles en PostgreSQL."
  },
  {
    step: 11,
    role: "coach",
    screen: "v2_06_event_hub_injury",
    tab: "agenda",
    title: "11. Sustitución Neutral: Ane Mintegi incorporada",
    desc: "PostgreSQL devuelve las 3 reservas disponibles (Ane, Irati, Nahia). Mikel confirma a Ane Mintegi y se emite la revisión 2.",
    actionHint: "Selecciona a Ane Mintegi (#16) y pulsa 'Confirmar sustitución'."
  }
];

export class TeamAppState {
  constructor() {
    this.appMode = null; // 'BETA_NORMAL' | 'DEMO'
    this.currentRole = "onboard"; // 'onboard' | 'coach' | 'parent'
    this.currentScreen = "beta_entry_screen";
    this.currentTab = "onboard";
    this.currentStepIndex = 0;
    this.selectedSubstitute = "Ane Mintegi";
    this.selectedCandidateId = DEMO_CONFIG.ANE_PLAYER_ID;
    this.parentRsvpChoice = "NO";
    this.isElenaApproved = true;
    this.linkedFamiliesCount = 12;
    this.pendingFamiliesCount = 6;

    // Token cache (Unified session token in production, legacy role keys supported)
    this.tokens = {
      coach: null,
      parent: null
    };

    // OTP Production Authentication State
    this.otpState = {
      email: "",
      challengeId: null,
      role: "coach",
      displayName: "",
      countdownTimer: null,
      countdownSeconds: 60,
      onSuccess: null,
      onCancel: null,
      isVerifying: false,
      isRequesting: false
    };

    // Beta Clean State (Vertical Slice 03)
    this.beta = {
      teamSeasonId: null,
      team: null,
      teamSeason: null,
      joinCode: null,
      players: [],
      pendingRequests: [],
      lastInvitation: null,
      verifiedInvitation: null,
      guardianPlayer: null
    };

    // Live synchronized backend cache
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

    // Concurrency, cancellation and context generation trackers
    this.otpOpSeq = 0;
    this.otpAbortController = null;
    this.contextGeneration = 0;
    this.currentSessionId = null;
    this._explicitIntentSeq = 0;
    this.inFlightControllers = new Set();
    this.managedTimers = new Map();

    // REV-02 Core Coordination Architecture
    this.concurrencyTracker = new ConcurrencyTracker();
    this.sessionManager = new SessionManager({
      currentSessionId: this.currentSessionId,
      credentialEpoch: 0,
      accessToken: null,
      appMode: this.appMode
    });
    this.resourceStore = new ResourceStore();
    this.contextCoordinator = new ContextCoordinator({
      sessionManager: this.sessionManager,
      concurrencyTracker: this.concurrencyTracker,
      stateRef: this,
      initial: {
        appMode: this.appMode,
        currentSessionId: this.currentSessionId,
        currentRole: this.currentRole,
        teamSeasonId: this.beta?.teamSeasonId || null,
        activeEventId: this.beta?.activeEventId || null,
        contextGeneration: this.contextGeneration,
        eventEpoch: 0,
        viewEpoch: 0
      }
    });

    // REV-02 Domain Controllers (Modular Monolith)
    this.authDomain = new AuthDomainController(this);
    this.teamsDomain = new TeamsDomainController(this);
    this.familiesDomain = new FamiliesDomainController(this);
    this.eventsDomain = new EventsDomainController(this);
  }

  createScope(extra = {}) {
    const {
      generation: _g,
      sessionId: _s,
      credentialEpoch: _c,
      mode: _m,
      bearerToken: _b,
      ...safeExtra
    } = extra || {};

    const baseGeneration = this.contextGeneration;
    const baseSessionId = this.currentSessionId;
    const baseEpoch = this.sessionManager ? this.sessionManager.getCredentialEpoch() : 0;
    const baseMode = this.appMode;
    const baseRole = safeExtra.role || this.currentRole;
    const baseTeam = safeExtra.teamSeasonId !== undefined ? safeExtra.teamSeasonId : (this.beta?.teamSeasonId || null);
    const baseChild = safeExtra.childId !== undefined ? safeExtra.childId : (this.beta?.guardianPlayer?.id || this.beta?.guardianPlayer?.playerId || null);
    const baseEvent = safeExtra.eventId !== undefined ? (safeExtra.eventId ? String(safeExtra.eventId) : null) : (this.beta?.activeEventId || null);

    const snapshot = {
      role: baseRole,
      teamSeasonId: baseTeam,
      childId: baseChild,
      eventId: baseEvent,
      ...safeExtra,
      generation: baseGeneration,
      sessionId: baseSessionId,
      credentialEpoch: baseEpoch,
      mode: baseMode,
      bearerToken: this.sessionManager?.getToken() || null
    };

    Object.defineProperty(snapshot, "_origin", {
      value: Object.freeze({
        generation: baseGeneration,
        sessionId: baseSessionId,
        credentialEpoch: baseEpoch,
        mode: baseMode,
        role: baseRole,
        teamSeasonId: baseTeam,
        childId: baseChild,
        eventId: baseEvent
      }),
      writable: false,
      enumerable: false,
      configurable: false
    });

    return snapshot;
  }

  isScopeActive(scope) {
    if (!scope) return false;
    if (scope._origin) {
      if (scope._origin.generation !== this.contextGeneration) return false;
      if (scope._origin.sessionId !== this.currentSessionId) return false;
      if (scope._origin.mode !== this.appMode) return false;
      if (scope.sessionId !== scope._origin.sessionId) return false;
      if (scope._origin.role !== undefined && scope.role !== scope._origin.role) return false;
      if (scope._origin.teamSeasonId !== undefined && scope.teamSeasonId !== scope._origin.teamSeasonId) return false;
      if (scope._origin.childId !== undefined && scope.childId !== scope._origin.childId) return false;
      if (scope._origin.eventId !== undefined && scope.eventId !== scope._origin.eventId) return false;
      if (scope._origin.mode !== undefined && scope.mode !== scope._origin.mode) return false;
    }
    if (scope.generation !== undefined && scope.generation !== this.contextGeneration) return false;
    if (scope.sessionId !== undefined && scope.sessionId !== this.currentSessionId) return false;
    if (scope.mode !== undefined && scope.mode !== this.appMode) return false;
    if (scope.role !== undefined && scope.role !== this.currentRole) return false;
    if (scope.teamSeasonId !== undefined && scope.teamSeasonId !== (this.beta?.teamSeasonId || null)) return false;
    if (scope.childId !== undefined && scope.childId !== (this.beta?.guardianPlayer?.id || this.beta?.guardianPlayer?.playerId || null)) return false;
    if (scope.eventId !== undefined && scope.eventId !== (this.beta?.activeEventId || null)) return false;
    return true;
  }

  applyContextTransition(transition = {}, sourceScope = null) {
    if (sourceScope && !this.isScopeActive(sourceScope)) {
      return false;
    }

    const currentChildId = this.beta?.guardianPlayer?.id || this.beta?.guardianPlayer?.playerId || null;
    const targetChildId = transition.guardianPlayer !== undefined
      ? (transition.guardianPlayer ? (transition.guardianPlayer.id || transition.guardianPlayer.playerId || null) : null)
      : currentChildId;

    const isTeamChanged = transition.teamSeasonId !== undefined && transition.teamSeasonId !== (this.beta?.teamSeasonId || null);
    const targetRole = transition.role !== undefined ? transition.role : transition.currentRole;
    const isRoleChanged = targetRole !== undefined && targetRole !== this.currentRole;
    const isSessionChanged = transition.currentSessionId !== undefined && transition.currentSessionId !== this.currentSessionId;

    const isIdentityChange = Boolean(
      transition.forceTransition ||
      (transition.appMode !== undefined && transition.appMode !== this.appMode) ||
      isSessionChanged ||
      isRoleChanged ||
      isTeamChanged ||
      (transition.guardianPlayer !== undefined && targetChildId !== currentChildId) ||
      (transition.bearer !== undefined && transition.bearer !== api.client.getToken())
    );

    if (isIdentityChange) {
      if (this.contextCoordinator) {
        this.contextCoordinator.applyIdentityTransition(transition);
        this.contextGeneration = this.contextCoordinator.confirmedContext.contextGeneration;
      } else {
        this.contextGeneration++;
      }
      this.otpOpSeq++;
      this.abortAllInFlight();
      this.clearAllManagedTimers();

      if (isTeamChanged || isRoleChanged || isSessionChanged) {
        if (this.resourceStore && isTeamChanged) {
          this.resourceStore.clearTeamSeason(this.beta?.teamSeasonId);
        }
        if (this.resourceStore && isSessionChanged) {
          this.resourceStore.clearAll();
        }
        if (isTeamChanged) {
          this.beta.activeEventId = null;
          try { localStorage.removeItem("talde_active_event_id"); } catch {}
          if (this.contextCoordinator) {
            this.contextCoordinator.confirmedContext.activeEventId = null;
            this.contextCoordinator.confirmedContext.eventEpoch = 0;
          }
        }
        if (transition.players === undefined) {
          this.beta.players = [];
        }
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
        const detailContainer = document.getElementById("player-detail-parent-container");
        if (detailContainer) {
          detailContainer.innerHTML = "";
          detailContainer.classList.add("hidden");
        }
        const coachRoster = document.getElementById("coach-beta-players-list");
        if (coachRoster) {
          coachRoster.innerHTML = "";
        }
      }
    }

    if (transition.appMode !== undefined) {
      this.appMode = transition.appMode;
      try { localStorage.setItem("talde_app_mode", this.appMode); } catch {}
    }
    if (transition.currentSessionId !== undefined) {
      this.currentSessionId = transition.currentSessionId;
      const effToken = transition.bearer || api.client.getToken() || (transition.tokens && transition.tokens[this.currentRole]);
      if (this.sessionManager) {
        this.sessionManager.setSession(this.currentSessionId, effToken, this.appMode);
      }
    }
    if (targetRole !== undefined) {
      this.currentRole = targetRole;
      try {
        localStorage.setItem("talde_current_role", this.currentRole);
        localStorage.setItem("talde_active_role", this.currentRole);
      } catch {}
    }
    if (transition.teamSeasonId !== undefined) {
      this.beta.teamSeasonId = transition.teamSeasonId;
      try {
        if (transition.teamSeasonId) {
          localStorage.setItem("talde_team_season_id", transition.teamSeasonId);
        } else {
          localStorage.removeItem("talde_team_season_id");
        }
      } catch {}
    }
    if (transition.team !== undefined) {
      this.beta.team = transition.team;
    }
    if (transition.teamSeason !== undefined) {
      this.beta.teamSeason = transition.teamSeason;
    }
    if (transition.joinCode !== undefined) {
      this.beta.joinCode = transition.joinCode;
      try {
        if (transition.joinCode) localStorage.setItem("talde_join_code", transition.joinCode);
        else localStorage.removeItem("talde_join_code");
      } catch {}
    }
    if (transition.activeEventId !== undefined) {
      this.beta.activeEventId = transition.activeEventId;
      try {
        if (transition.activeEventId) localStorage.setItem("talde_active_event_id", transition.activeEventId);
        else localStorage.removeItem("talde_active_event_id");
      } catch {}
      if (this.contextCoordinator) {
        this.contextCoordinator.setEventContext(transition.activeEventId);
      }
    }
    if (transition.guardianPlayers !== undefined) {
      this.beta.guardianPlayers = transition.guardianPlayers;
    }
    if (transition.guardianPlayer !== undefined) {
      this.beta.guardianPlayer = transition.guardianPlayer;
      try {
        const cId = transition.guardianPlayer?.id || transition.guardianPlayer?.playerId;
        if (cId) {
          localStorage.setItem("talde_guardian_child_id", cId);
          localStorage.setItem("talde_linked_player_id", cId);
        } else {
          localStorage.removeItem("talde_guardian_child_id");
          localStorage.removeItem("talde_linked_player_id");
        }
      } catch {}
    }
    if (transition.tokens !== undefined) {
      if (transition.tokens.coach !== undefined) {
        this.tokens.coach = transition.tokens.coach;
        try {
          if (transition.tokens.coach) localStorage.setItem("talde_token_coach", transition.tokens.coach);
          else localStorage.removeItem("talde_token_coach");
        } catch {}
      }
      if (transition.tokens.parent !== undefined) {
        this.tokens.parent = transition.tokens.parent;
        try {
          if (transition.tokens.parent) localStorage.setItem("talde_token_parent", transition.tokens.parent);
          else localStorage.removeItem("talde_token_parent");
        } catch {}
      }
    }
    if (transition.bearer !== undefined) {
      api.client.setToken(transition.bearer);
      try {
        if (transition.bearer) localStorage.setItem("talde_session_token", transition.bearer);
        else localStorage.removeItem("talde_session_token");
      } catch {}
      if (this.sessionManager) {
        this.sessionManager.setSession(this.currentSessionId, transition.bearer, this.appMode);
      }
    }
    return true;
  }

  registerManagedTimeout(fn, ms, scope = null) {
    let timerId = null;
    const initialScreen = this.currentScreen;
    const initialRole = this.currentRole;
    const initialSession = this.currentSessionId;
    const initialViewEpoch = this.contextCoordinator?.confirmedContext?.viewEpoch ?? scope?.viewEpoch ?? null;
    const initialEventEpoch = this.contextCoordinator?.confirmedContext?.eventEpoch ?? scope?.eventEpoch ?? null;
    const wrappedFn = () => {
      this.managedTimers.delete(timerId);
      if (initialViewEpoch !== null && this.contextCoordinator?.confirmedContext?.viewEpoch !== initialViewEpoch) {
        return;
      }
      if (initialEventEpoch !== null && this.contextCoordinator?.confirmedContext?.eventEpoch !== initialEventEpoch) {
        return;
      }
      if (scope) {
        if (!this.isScopeActive(scope)) return;
        if (scope.role && this.currentRole !== scope.role) return;
        if (scope.viewId && this.currentScreen !== scope.viewId) return;
        if (scope.expectedScreen && this.currentScreen !== scope.expectedScreen) return;
        if (scope.isOtpModal && !this.isOtpModalOpen()) return;
        if (scope.modalId) {
          const m = document.getElementById(scope.modalId);
          if (!m || m.classList.contains("hidden")) return;
        }
      }
      if (initialRole && this.currentRole !== initialRole && scope?.enforceRole !== false) return;
      if (initialSession && this.currentSessionId !== initialSession) return;
      fn();
    };
    timerId = setTimeout(wrappedFn, ms);
    this.managedTimers.set(timerId, { timerId, scope, initialViewEpoch, initialEventEpoch });
    return timerId;
  }

  clearManagedTimeout(timerId) {
    if (timerId !== null && timerId !== undefined) {
      clearTimeout(timerId);
      this.managedTimers.delete(timerId);
    }
  }

  clearAllManagedTimers() {
    for (const [timerId] of this.managedTimers) {
      try { clearTimeout(timerId); } catch {}
    }
    this.managedTimers.clear();
  }

  async safeFetch(promise, fallback = null, scope = null) {
    if (scope && !this.isScopeActive(scope)) {
      return fallback;
    }
    try {
      const res = await promise;
      if (scope && !this.isScopeActive(scope)) {
        return fallback;
      }
      return res;
    } catch (err) {
      if (err?.status === 401 && err.wasAuthenticated) {
        if (!scope || this.isScopeActive(scope)) {
          this.handleSessionExpired(err, scope);
          throw err;
        }
      }
      return fallback;
    }
  }

  async init() {
    const params = new URLSearchParams(window.location.search);
    const screenParam = params.get("screen") || window.location.hash.replace("#", "");
    const roleParam = params.get("role");
    const isDemoRequested = params.get("demo") === "1" || params.get("demo") === "true";
    const inviteToken = params.get("inviteToken");
    const joinCode = params.get("join");

    const demoToolbar = document.getElementById("demo-toolbar");
    const demoStepCard = document.getElementById("demo-step-card");
    if (isDemoRequested) {
      if (demoToolbar) demoToolbar.classList.remove("hidden");
      if (demoStepCard) demoStepCard.classList.remove("hidden");
    }

    const savedMode = localStorage.getItem("talde_app_mode");
    if (savedMode === "BETA_NORMAL") {
      this.appMode = "BETA_NORMAL";
      this.applyCleanUI();
    } else if (savedMode === "DEMO") {
      this.appMode = "DEMO";
    }

    // Unified session token priority
    const unifiedToken = localStorage.getItem("talde_session_token");
    if (unifiedToken) {
      this.currentSessionId = "sess_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
      this.tokens.coach = unifiedToken;
      this.tokens.parent = unifiedToken;
      api.client.setToken(unifiedToken);
      if (this.contextCoordinator) {
        this.contextCoordinator.initContext(this.currentSessionId, this.appMode);
      }
      if (this.sessionManager) {
        this.sessionManager.setSession(this.currentSessionId, unifiedToken, this.appMode);
      }
    } else {
      if (localStorage.getItem("talde_token_coach")) {
        this.tokens.coach = localStorage.getItem("talde_token_coach");
      }
      if (localStorage.getItem("talde_token_parent")) {
        this.tokens.parent = localStorage.getItem("talde_token_parent");
      }
    }
    if (localStorage.getItem("talde_team_season_id")) {
      this.beta.teamSeasonId = localStorage.getItem("talde_team_season_id");
    }

    // Listeners for OTP modal
    const otpInput = document.getElementById("modal-otp-input");
    if (otpInput) {
      otpInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          this.submitOtpVerification();
        } else if (e.key === "Escape") {
          e.preventDefault();
          this.closeOtpModal();
        }
      });
      otpInput.addEventListener("input", (e) => {
        e.target.value = e.target.value.replace(/\D/g, "");
        if (e.target.value.length === 6) {
          this.submitOtpVerification();
        }
      });
    }
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        const modal = document.getElementById("modal-otp-auth");
        if (modal && !modal.classList.contains("hidden")) {
          this.closeOtpModal();
        }
      }
    });

    const savedRole = localStorage.getItem("talde_active_role");

    if (inviteToken || joinCode) {
      this.appMode = "BETA_NORMAL";
      this.currentRole = "parent";
      this.currentScreen = "v2_00_parent_join_team";
      this.applyCleanUI();
    } else if (roleParam === "parent" || (!roleParam && savedRole === "parent")) {
      this.currentRole = "parent";
      if (isDemoRequested) this.appMode = "DEMO";
      else if (!this.appMode) this.appMode = savedMode || "DEMO";
    } else if (roleParam === "coach" || (!roleParam && savedRole === "coach")) {
      this.currentRole = "coach";
      if (isDemoRequested) this.appMode = "DEMO";
      else if (!this.appMode) this.appMode = savedMode || "DEMO";
    } else if (screenParam?.startsWith("v2_07_") || screenParam?.startsWith("v2_08_")) {
      this.currentRole = "parent";
      if (isDemoRequested) this.appMode = "DEMO";
      else if (!this.appMode) this.appMode = savedMode || "DEMO";
    } else if (screenParam?.startsWith("v2_01_") || screenParam?.startsWith("v2_02_") || screenParam?.startsWith("v2_05_") || screenParam?.startsWith("v2_06_")) {
      this.currentRole = "coach";
      if (isDemoRequested) this.appMode = "DEMO";
      else if (!this.appMode) this.appMode = savedMode || "DEMO";
    } else {
      this.currentRole = "onboard";
    }

    if (screenParam && document.getElementById(screenParam)) {
      this.currentScreen = screenParam;
    } else if (this.currentRole === "onboard") {
      this.currentScreen = "beta_entry_screen";
    }

    if (this.appMode === "DEMO") {
      document.getElementById("demo-mode-badge")?.classList.remove("hidden");
    } else {
      document.getElementById("demo-mode-badge")?.classList.add("hidden");
    }

    this.bindGlobalEvents();

    const scope = this.createScope();
    let contextLoaded = false;
    try {
      if (this.currentRole !== "onboard" && this.appMode === "DEMO") {
        await this.ensureAuth(this.currentRole);
      }
      if (!this.isScopeActive(scope)) return;
      contextLoaded = await this.loadUserContext();
      await this.syncCurrentScreen();
    } catch (err) {
      if (err?.status === 401 && err?.wasAuthenticated) {
        this.handleSessionExpired(err);
        return;
      }
      console.warn("Backend auth/sync deferred:", err);
    }

    const postInitScope = this.createScope();
    this.goToScreen(this.currentScreen);
    this.updateBottomNav();
    this.updateRoleUI();
    this.updateStepUI();

    if (inviteToken && this.beta.individualInviteToken !== null && !contextLoaded) {
      this.registerManagedTimeout(() => {
        if (!this.isScopeActive(postInitScope)) return;
        this.setupIndividualInvite(inviteToken);
      }, 150, postInitScope);
    } else if (joinCode && !contextLoaded) {
      this.registerManagedTimeout(() => {
        if (!this.isScopeActive(postInitScope)) return;
        const input = document.getElementById("parent-join-code-input");
        if (input) input.value = joinCode.toUpperCase();
        this.verifyGeneralJoinCode();
      }, 150, postInitScope);
    }
  }

  bindGlobalEvents() {
    if (this._eventsBound) return;
    this._eventsBound = true;

    const handleFocusCheck = () => {
      if (document.visibilityState === "visible" && this.currentRole === "parent" && this.appMode === "BETA_NORMAL") {
        this.checkParentApprovalStatus(true);
      }
    };

    document.addEventListener("visibilitychange", handleFocusCheck);
    window.addEventListener("focus", handleFocusCheck);
  }

  cleanInviteTokenFromUrl() {
    this.beta.individualInviteToken = null;
    this.beta.verifiedInvitation = null;
    try {
      if (window.location.search.includes("inviteToken") || window.location.search.includes("join")) {
        const url = new URL(window.location.href);
        url.searchParams.delete("inviteToken");
        url.searchParams.delete("join");
        const newUrl = url.pathname + (url.searchParams.toString() ? "?" + url.searchParams.toString() : "") + url.hash;
        window.history.replaceState({}, document.title, newUrl);
      }
    } catch (e) {
      console.warn("Could not replace state:", e);
    }
  }

  async checkParentApprovalStatus(silent = false) {
    if (this.appMode === "DEMO") return false;
    if (this._isCheckingApproval) return false;

    const scope = this.createScope();
    const parentToken = this.tokens.parent || localStorage.getItem("talde_token_parent");
    if (!parentToken) return false;

    this._isCheckingApproval = true;
    try {
      // EXPLICITLY set client token to parent token
      api.client.setToken(parentToken);
      this.tokens.parent = parentToken;

      const res = await api.teams.getMyMemberships();
      if (!this.isScopeActive(scope)) return false;
      const items = res?.items || [];

      // Requirement 1 & 2: MUST have guardian_players.length > 0 to consolidate
      const contextTeamSeasonId = this.beta.targetTeamSeasonId || this.beta.teamSeasonId || localStorage.getItem("talde_team_season_id");
      let guardianMem = contextTeamSeasonId
        ? items.find(m => m.team_season_id === contextTeamSeasonId && m.role === "GUARDIAN" && m.status === "ACTIVE" && (m.guardian_players || m.guardianPlayers || []).length > 0)
        : null;

      if (!guardianMem) {
        guardianMem = items.find(m => m.role === "GUARDIAN" && m.status === "ACTIVE" && (m.guardian_players || m.guardianPlayers || []).length > 0);
      }

      if (guardianMem) {
        const guardianPlayers = guardianMem.guardian_players || guardianMem.guardianPlayers || [];
        const currentChildId = this.beta?.guardianPlayer?.id || this.beta?.guardianPlayer?.playerId || localStorage.getItem("talde_guardian_child_id") || localStorage.getItem("talde_linked_player_id");
        const matchingChild = currentChildId ? guardianPlayers.find(p => (p.id || p.playerId) === currentChildId) : null;
        const guardianPlayer = matchingChild || guardianPlayers[0] || null;
        const ok = this.applyContextTransition({
          role: "parent",
          teamSeasonId: guardianMem.team_season_id,
          team: { id: guardianMem.team_id, name: guardianMem.team_name, sport: guardianMem.sport },
          teamSeason: {
            id: guardianMem.team_season_id,
            display_label: guardianMem.display_label,
            season_label: guardianMem.season_label,
            category: guardianMem.category,
            join_code: guardianMem.join_code
          },
          joinCode: guardianMem.join_code,
          guardianPlayers,
          guardianPlayer,
          tokens: { parent: parentToken }
        }, scope);
        if (!ok) return false;

        this.cleanInviteTokenFromUrl();
        if (!silent) {
          this.showToast("✓ Vinculación aprobada por el entrenador. Accediendo a Familia...");
        }
        await this.goToScreen("v2_07_parent_home", "inicio");
        return true;
      } else if (!silent) {
        this.showToast("Solicitud aún pendiente de aprobación por el cuerpo técnico.");
      }
    } catch (err) {
      if (!this.isScopeActive(scope)) return false;
      if (err?.status === 401 && err?.wasAuthenticated) {
        this.handleSessionExpired(err, scope);
        return false;
      }
      if (!silent) {
        console.error("Error comprobando estado de aprobación:", err);
      }
    } finally {
      this._isCheckingApproval = false;
    }
    return false;
  }

  async loadUserContext() {
    if (this.appMode === "DEMO") return false;
    const scope = this.createScope();
    try {
      const activeRole = localStorage.getItem("talde_active_role") || this.currentRole || "coach";
      const coachToken = this.tokens.coach || localStorage.getItem("talde_token_coach");
      const parentToken = this.tokens.parent || localStorage.getItem("talde_token_parent");

      // Requirement 2: Only enter parent restoration if in parent role/context
      if ((activeRole === "parent" || this.currentRole === "parent") && parentToken) {
        api.client.setToken(parentToken);
        this.tokens.parent = parentToken;
        const res = await api.teams.getMyMemberships();
        if (!this.isScopeActive(scope)) return false;
        const items = res?.items || [];

        // Requirement 1: MUST have guardian_players.length > 0
        const contextTeamSeasonId = this.beta.targetTeamSeasonId || this.beta.teamSeasonId || localStorage.getItem("talde_team_season_id");
        let guardianMem = contextTeamSeasonId
          ? items.find(m => m.team_season_id === contextTeamSeasonId && m.role === "GUARDIAN" && m.status === "ACTIVE" && (m.guardian_players || m.guardianPlayers || []).length > 0)
          : null;

        if (!guardianMem) {
          guardianMem = items.find(m => m.role === "GUARDIAN" && m.status === "ACTIVE" && (m.guardian_players || m.guardianPlayers || []).length > 0);
        }

        if (guardianMem) {
          const guardianPlayers = guardianMem.guardian_players || guardianMem.guardianPlayers || [];
          const currentChildId = this.beta?.guardianPlayer?.id || this.beta?.guardianPlayer?.playerId || localStorage.getItem("talde_guardian_child_id") || localStorage.getItem("talde_linked_player_id");
          const matchingChild = currentChildId ? guardianPlayers.find(p => (p.id || p.playerId) === currentChildId) : null;
          const guardianPlayer = matchingChild || guardianPlayers[0] || null;
          const ok = this.applyContextTransition({
            role: "parent",
            teamSeasonId: guardianMem.team_season_id,
            team: { id: guardianMem.team_id, name: guardianMem.team_name, sport: guardianMem.sport },
            teamSeason: {
              id: guardianMem.team_season_id,
              display_label: guardianMem.display_label,
              season_label: guardianMem.season_label,
              category: guardianMem.category,
              join_code: guardianMem.join_code
            },
            joinCode: guardianMem.join_code,
            guardianPlayers,
            guardianPlayer,
            tokens: { parent: parentToken }
          }, scope);
          if (!ok) return false;

          this.cleanInviteTokenFromUrl();

          const urlParams = new URLSearchParams(window.location.search);
          const screenParam = urlParams.get("screen");
          if (!screenParam) {
            const lastScreen = localStorage.getItem("talde_last_screen");
            this.currentScreen = (lastScreen && lastScreen.startsWith("v2_07_")) ? lastScreen : "v2_07_parent_home";
          }
          return true;
        }
      }

      const activeToken = coachToken || parentToken || api.client.getToken();
      if (!activeToken) return false;
      api.client.setToken(activeToken);
      const res = await api.teams.getMyMemberships();
      if (!this.isScopeActive(scope)) return false;
      const items = res?.items || [];
      if (!items.length) return false;

      const coachMem = items.find(m => m.role === "COACH" && m.status === "ACTIVE");
      if (coachMem) {
        const ok = this.applyContextTransition({
          role: activeRole === "coach" ? "coach" : this.currentRole,
          teamSeasonId: coachMem.team_season_id,
          team: { id: coachMem.team_id, name: coachMem.team_name, sport: coachMem.sport },
          teamSeason: {
            id: coachMem.team_season_id,
            display_label: coachMem.display_label,
            season_label: coachMem.season_label,
            category: coachMem.category,
            join_code: coachMem.join_code
          },
          joinCode: coachMem.join_code,
          tokens: { coach: coachToken || activeToken }
        }, scope);
        if (!ok) return false;

        const coachBadge = document.getElementById("coach-club-badge");
        if (coachBadge) coachBadge.textContent = coachMem.team_name;
        const teamNameInput = document.getElementById("team-name");
        if (teamNameInput) teamNameInput.value = coachMem.display_label || "";
        const clubNameInput = document.getElementById("club-name");
        if (clubNameInput) clubNameInput.value = coachMem.team_name || "";
        const coachCodeSection = document.getElementById("coach-code-section");
        const rosterMgmtSection = document.getElementById("coach-roster-management-section");
        if (coachCodeSection) coachCodeSection.classList.remove("hidden");
        if (rosterMgmtSection) rosterMgmtSection.classList.remove("hidden");

        this.beta.joinCode = coachMem.join_code || localStorage.getItem("talde_join_code");
        if (this.beta.joinCode) {
          localStorage.setItem("talde_join_code", this.beta.joinCode);
          const codeDisplay = document.getElementById("coach-code-display");
          if (codeDisplay) codeDisplay.textContent = this.beta.joinCode;
        }
        const urlParams = new URLSearchParams(window.location.search);
        const screenParam = urlParams.get("screen");
        if (!screenParam && (this.currentScreen === "beta_entry_screen" || this.currentScreen === "v2_00_onboarding_welcome")) {
          const lastScreen = localStorage.getItem("talde_last_screen");
          this.currentScreen = (lastScreen && document.getElementById(lastScreen)) ? lastScreen : "v2_01_coach_home";
        }
        if (localStorage.getItem("talde_players")) {
          try {
            this.beta.players = JSON.parse(localStorage.getItem("talde_players") || "[]");
            this.renderBetaPlayersList();
          } catch {}
        }
        return true;
      }

      const guardianMem = items.find(m => m.role === "GUARDIAN" && m.status === "ACTIVE" && (m.guardian_players || m.guardianPlayers || []).length > 0);
      if (guardianMem) {
        const guardianPlayers = guardianMem.guardian_players || guardianMem.guardianPlayers || [];
        const guardianPlayer = guardianPlayers[0] || null;
        const ok = this.applyContextTransition({
          role: "parent",
          teamSeasonId: guardianMem.team_season_id,
          team: { id: guardianMem.team_id, name: guardianMem.team_name, sport: guardianMem.sport },
          teamSeason: {
            id: guardianMem.team_season_id,
            display_label: guardianMem.display_label,
            season_label: guardianMem.season_label,
            category: guardianMem.category
          },
          guardianPlayers,
          guardianPlayer,
          tokens: { parent: activeToken }
        }, scope);
        if (!ok) return false;
        return true;
      }
    } catch (err) {
      if (!this.isScopeActive(scope)) return false;
      if (err?.wasAuthenticated && err?.status === 401) {
        this.handleSessionExpired(err, scope);
      } else {
        console.warn("loadUserContext deferred or network issue:", err);
      }
    }
    return false;
  }

  isOtpModalOpen() {
    const modal = document.getElementById("modal-otp-auth");
    return Boolean(modal && !modal.classList.contains("hidden"));
  }

  createInFlightSignal() {
    const ctrl = new AbortController();
    this.inFlightControllers.add(ctrl);
    ctrl.signal.addEventListener("abort", () => this.inFlightControllers.delete(ctrl), { once: true });
    return ctrl.signal;
  }

  abortAllInFlight() {
    for (const ctrl of this.inFlightControllers) {
      try { ctrl.abort(); } catch {}
    }
    this.inFlightControllers.clear();
  }

  purgePrivateFormsAndDom() {
    if (this.isOtpModalOpen()) {
      this.closeOtpModal();
    }
    this.closePlayerInviteModal();
    this.closeAddPlayerModal();
    this.cancelResetBeta();

    // Clear sensitive form inputs
    const idsToClear = [
      "modal-otp-input",
      "modal-otp-email-input",
      "coach-code-input",
      "coach-email",
      "coach-name",
      "tutor-email",
      "tutor-name",
      "parent-claim-name",
      "parent-claim-number",
      "parent-join-code-input",
      "parent-player-first-name",
      "parent-player-last-name",
      "pitch-location",
      "team-name",
      "club-name",
      "category-select",
      "modal-player-firstname",
      "modal-player-lastname",
      "modal-player-number",
      "modal-player-position",
      "modal-invite-link-input"
    ];
    for (const id of idsToClear) {
      const el = document.getElementById(id);
      if (el) el.value = "";
    }

    const inviteTitle = document.getElementById("modal-invite-title");
    if (inviteTitle) inviteTitle.textContent = "Invitar familia";

    const nameEl = document.getElementById("parent-home-player-name");
    if (nameEl) nameEl.textContent = "";

    // Clear and hide dynamic containers rendering private information
    const containersToClear = [
      "coach-pending-approval-card",
      "coach-week-events-container",
      "coach-agenda-events-container",
      "roster-players-list-container",
      "coach-roster-list",
      "coach-beta-players-list",
      "parent-commitments-list",
      "player-detail-parent-container",
      "parent-player-detail-container",
      "injury-candidates-container",
      "coach-recent-changes-container",
      "agenda-events-container"
    ];
    for (const id of containersToClear) {
      const el = document.getElementById(id);
      if (el) {
        el.innerHTML = "";
        el.classList.add("hidden");
      }
    }

    const codeDisplay = document.getElementById("coach-code-display");
    if (codeDisplay) codeDisplay.textContent = "------";

    localStorage.removeItem("talde_active_event_id");
    this.selectedCandidateId = null;
    this.selectedSubstitute = null;
    this.clearAllManagedTimers();

    this.otpState = {
      email: null,
      challengeId: null,
      role: null,
      displayName: null,
      isVerifying: false,
      isRequesting: false,
      onSuccess: null
    };
  }

  handleSessionExpired(sourceError, scope = null) {
    if (sourceError && (!sourceError.wasAuthenticated || sourceError.path?.includes("/auth/otp/")) && sourceError.code !== "AUTH_REQUIRED") {
      return;
    }
    const activeToken = api.client.getToken() || this.tokens[this.currentRole] || this.tokens.coach || this.tokens.parent;
    const reqToken = sourceError?.requestToken || scope?.bearerToken || scope?.requestToken || scope?.token || null;
    const reqSession = sourceError?.requestSessionId || scope?.sessionId || scope?.currentSessionId || null;

    if (reqToken && activeToken && reqToken !== activeToken) {
      return;
    }
    if (reqSession && this.currentSessionId && reqSession !== this.currentSessionId) {
      return;
    }

    const effectiveScope = scope || (reqSession || reqToken ? {
      sessionId: reqSession,
      bearerToken: reqToken,
      ...(sourceError?.requestCredentialEpoch != null ? { credentialEpoch: sourceError.requestCredentialEpoch } : {})
    } : null);

    const isAuth = Boolean(sourceError?.wasAuthenticated !== false);
    if (this.sessionManager) {
      const handled = this.sessionManager.handleUnauthorized(effectiveScope, isAuth);
      if (!handled && effectiveScope) {
        return;
      }
    }

    if (this.sessionManager) {
      this.sessionManager.clearSession();
    }
    api.client.setToken(null);
    this.tokens = { coach: null, parent: null };
    this.contextGeneration++;
    this.currentSessionId = null;
    this.clearAllManagedTimers();
    this.abortAllInFlight();
    this.otpOpSeq++;
    if (this.otpAbortController) {
      try { this.otpAbortController.abort(); } catch {}
    }
    if (this.isOtpModalOpen()) {
      this.closeOtpModal();
    }
    this.clearSessionData();
    this.purgePrivateFormsAndDom();
    this.showToast("Tu sesión ha caducado. Por favor, identifícate de nuevo.");
  }

  setAppMode(newMode) {
    if (this.appMode === newMode) return;
    this.abortAllInFlight();
    this.clearAllManagedTimers();
    this.contextGeneration++;
    this.currentSessionId = null;
    if (this.sessionManager) {
      this.sessionManager.clearSession();
    }
    if (this.resourceStore) {
      this.resourceStore.clearAll();
    }
    if (this.contextCoordinator) {
      this.contextCoordinator.setModeContext(newMode);
    }
    if (this.isOtpModalOpen()) {
      this.closeOtpModal();
    }
    this.otpOpSeq++;

    // Invalidate state across modes
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
      activeEventId: null,
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

    this.tokens = { coach: null, parent: null };
    api.client.setToken(null);
    localStorage.removeItem("talde_session_token");
    localStorage.removeItem("talde_token_coach");
    localStorage.removeItem("talde_token_parent");
    localStorage.removeItem("talde_active_event_id");
    this.selectedCandidateId = null;
    this.selectedSubstitute = null;
    this.purgePrivateFormsAndDom();

    if (newMode === "DEMO") {
      localStorage.removeItem("talde_team_season_id");
      localStorage.removeItem("talde_active_role");
      this.appMode = "DEMO";
      localStorage.setItem("talde_app_mode", "DEMO");
      const demoToolbar = document.getElementById("demo-toolbar");
      const demoStepCard = document.getElementById("demo-step-card");
      if (demoToolbar) demoToolbar.classList.remove("hidden");
      if (demoStepCard) demoStepCard.classList.remove("hidden");
      document.getElementById("demo-mode-badge")?.classList.remove("hidden");
    } else {
      this.appMode = "BETA_NORMAL";
      localStorage.setItem("talde_app_mode", "BETA_NORMAL");
      document.getElementById("demo-mode-badge")?.classList.add("hidden");
      this.applyCleanUI();
    }
  }

  clearSessionData() {
    if (this.authDomain && typeof this.authDomain.clearSessionData === "function") {
      return this.authDomain.clearSessionData();
    }
    this.contextGeneration++;
    this.currentSessionId = null;
    this._explicitIntentSeq = (this._explicitIntentSeq || 0) + 1;
    this.clearAllManagedTimers();
    this.abortAllInFlight();
    this.otpOpSeq++;
    if (this.otpAbortController) {
      try { this.otpAbortController.abort(); } catch {}
    }
    if (this.isOtpModalOpen()) {
      this.closeOtpModal();
    }
    if (this.sessionManager) {
      this.sessionManager.clearSession();
    }
    if (this.concurrencyTracker) {
      this.concurrencyTracker.reset();
    }
    if (this.resourceStore) {
      this.resourceStore.clearAll();
    }
    if (this.contextCoordinator) {
      this.contextCoordinator.purgeContext();
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
    this.tokens = { coach: null, parent: null };
    api.client.setToken(null);
    this.selectedCandidateId = null;
    this.selectedSubstitute = null;
    this.otpState = {
      email: null,
      challengeId: null,
      role: null,
      displayName: null,
      isVerifying: false,
      isRequesting: false,
      onSuccess: null
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
      guardianPlayers: [],
      activeEventId: null
    };
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
    this.purgePrivateFormsAndDom();
    const codeDisplay = document.getElementById("coach-code-display");
    if (codeDisplay) codeDisplay.textContent = "------";
    const coachCodeSection = document.getElementById("coach-code-section");
    if (coachCodeSection) coachCodeSection.classList.add("hidden");
    const rosterSection = document.getElementById("coach-roster-management-section");
    if (rosterSection) rosterSection.classList.add("hidden");
    const parentNotice = document.getElementById("parent-clean-backend-notice");
    if (parentNotice) parentNotice.classList.add("hidden");
    this.goToScreen("v2_00_onboarding_welcome", "onboard");
  }

  // --- Production Email OTP Authentication Methods ---

  openOtpModal({ email = "", displayName = "", role = "coach", showEmailStep = false, onSuccess = null, onCancel = null } = {}) {
    const modal = document.getElementById("modal-otp-auth");
    if (!modal) return;

    this.otpOpSeq++;
    if (this.otpAbortController) {
      this.otpAbortController.abort();
      this.otpAbortController = null;
    }

    if (this.otpState.countdownTimer) {
      clearInterval(this.otpState.countdownTimer);
      this.otpState.countdownTimer = null;
    }

    this.otpState = {
      email: email ? String(email).trim().toLowerCase() : "",
      challengeId: null,
      role,
      displayName: displayName ? String(displayName).trim() : "",
      countdownTimer: null,
      countdownSeconds: 60,
      onSuccess,
      onCancel,
      isVerifying: false,
      isRequesting: false
    };

    const emailStep = document.getElementById("modal-otp-email-step");
    const codeStep = document.getElementById("modal-otp-code-step");
    const statusBanner = document.getElementById("modal-otp-status");
    const otpInput = document.getElementById("modal-otp-input");
    const submitBtn = document.getElementById("modal-otp-submit-btn");

    if (statusBanner) statusBanner.classList.add("hidden");
    if (otpInput) otpInput.value = "";
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = `<span class="material-symbols-outlined text-[18px]">verified</span><span>Verificar</span>`;
    }

    if (showEmailStep || !this.otpState.email) {
      if (emailStep) emailStep.classList.remove("hidden");
      if (codeStep) codeStep.classList.add("hidden");
      const emailInput = document.getElementById("modal-otp-email-input");
      if (emailInput) {
        emailInput.value = this.otpState.email;
        this.registerManagedTimeout(() => emailInput.focus(), 100, this.createScope({ isOtpModal: true, modalId: "modal-otp-auth", expectedScreen: this.currentScreen }));
      }
      modal.classList.remove("hidden");
    } else {
      if (emailStep) emailStep.classList.add("hidden");
      if (codeStep) codeStep.classList.remove("hidden");
      modal.classList.remove("hidden");
      this.requestOtpInternal(this.otpState.email);
    }
  }

  async submitEmailForOtp() {
    const emailInput = document.getElementById("modal-otp-email-input");
    const email = emailInput?.value?.trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      this.showToast("⚠️ Introduce un correo electrónico válido.");
      return;
    }
    this.otpState.email = email;
    const emailStep = document.getElementById("modal-otp-email-step");
    const codeStep = document.getElementById("modal-otp-code-step");
    if (emailStep) emailStep.classList.add("hidden");
    if (codeStep) codeStep.classList.remove("hidden");
    await this.requestOtpInternal(email);
  }

  changeOtpEmail() {
    const emailStep = document.getElementById("modal-otp-email-step");
    const codeStep = document.getElementById("modal-otp-code-step");
    if (emailStep) emailStep.classList.remove("hidden");
    if (codeStep) codeStep.classList.add("hidden");
    const emailInput = document.getElementById("modal-otp-email-input");
    if (emailInput) {
      emailInput.value = this.otpState.email || "";
      emailInput.focus();
    }
  }

  async requestOtpInternal(email) {
    if (this.otpState.isRequesting) return;
    this.otpState.isRequesting = true;

    const opId = ++this.otpOpSeq;
    if (this.otpAbortController) {
      this.otpAbortController.abort();
    }
    this.otpAbortController = new AbortController();

    const emailDisplay = document.getElementById("modal-otp-email-display");
    if (emailDisplay) emailDisplay.textContent = email;

    this.showOtpStatus("Solicitando código de verificación...", "info");

    try {
      const res = await api.auth.requestOtp(email, { signal: this.otpAbortController.signal });
      if (opId !== this.otpOpSeq || !this.isOtpModalOpen()) {
        return;
      }
      this.otpState.challengeId = res.challengeId;
      this.hideOtpStatus();
      this.startOtpCountdown(60);
      const otpInput = document.getElementById("modal-otp-input");
      if (otpInput) {
        otpInput.value = "";
        this.registerManagedTimeout(() => otpInput.focus(), 150, this.createScope({ isOtpModal: true, modalId: "modal-otp-auth", expectedScreen: this.currentScreen }));
      }
    } catch (err) {
      if (err?.name === "AbortError") return;
      if (opId !== this.otpOpSeq || !this.isOtpModalOpen()) return;
      const msg = mapDomainError(err);
      this.showOtpStatus(msg, "error");
      this.showToast(msg);
    } finally {
      this.otpState.isRequesting = false;
    }
  }

  startOtpCountdown(seconds = 60) {
    if (this.otpState.countdownTimer) {
      clearInterval(this.otpState.countdownTimer);
    }
    this.otpState.countdownSeconds = seconds;
    const countdownEl = document.getElementById("modal-otp-countdown");
    const resendBtn = document.getElementById("modal-otp-resend-btn");
    const resendLabel = document.getElementById("modal-otp-resend-label");

    if (countdownEl) {
      countdownEl.classList.remove("hidden");
      countdownEl.textContent = `Reenviar en ${this.otpState.countdownSeconds}s`;
    }
    if (resendBtn) resendBtn.classList.add("hidden");
    if (resendLabel) resendLabel.textContent = "¿No lo has recibido?";

    this.otpState.countdownTimer = setInterval(() => {
      this.otpState.countdownSeconds--;
      if (this.otpState.countdownSeconds <= 0) {
        clearInterval(this.otpState.countdownTimer);
        this.otpState.countdownTimer = null;
        if (countdownEl) countdownEl.classList.add("hidden");
        if (resendBtn) resendBtn.classList.remove("hidden");
      } else {
        if (countdownEl) countdownEl.textContent = `Reenviar en ${this.otpState.countdownSeconds}s`;
      }
    }, 1000);
  }

  async resendOtp() {
    if (this.otpState.countdownSeconds > 0 || this.otpState.isRequesting) return;
    await this.requestOtpInternal(this.otpState.email);
  }

  async submitOtpVerification() {
    if (this.otpState.isVerifying) return;
    const otpInput = document.getElementById("modal-otp-input");
    const otp = otpInput?.value?.trim();

    if (!otp || !/^\d{6}$/.test(otp)) {
      this.showOtpStatus("Introduce el código de 6 dígitos completo.", "warning");
      otpInput?.focus();
      return;
    }

    if (!this.otpState.challengeId) {
      this.showOtpStatus("No hay un reto activo. Solicita un nuevo código.", "error");
      return;
    }

    this.otpState.isVerifying = true;
    const submitBtn = document.getElementById("modal-otp-submit-btn");
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = `<span class="material-symbols-outlined text-[18px] animate-spin">progress_activity</span><span>Verificando...</span>`;
    }

    const opId = ++this.otpOpSeq;
    const contextGen = this.contextGeneration;
    const currentMode = this.appMode;
    if (this.otpAbortController) {
      this.otpAbortController.abort();
    }
    this.otpAbortController = new AbortController();

    try {
      const res = await api.auth.verifyOtp(
        this.otpState.email,
        this.otpState.challengeId,
        otp,
        this.otpState.displayName,
        { signal: this.otpAbortController.signal }
      );

      // MANDATORY TECHNICAL CONDITION 1:
      // El token solo podrá almacenarse después de que el controlador confirme que la operación OTP
      // sigue vigente, el modal continúa activo y el contexto de aplicación no ha cambiado.
      // Una operación cancelada nunca debe crear una sesión.
      if (opId !== this.otpOpSeq || !this.isOtpModalOpen() || contextGen !== this.contextGeneration) {
        console.warn("OTP verification response discarded: modal closed, cancelled, or context shifted.");
        return;
      }

      // Store unified session token
      this.currentSessionId = "sess_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
      localStorage.setItem("talde_session_token", res.accessToken);
      this.appMode = "BETA_NORMAL";
      localStorage.setItem("talde_app_mode", "BETA_NORMAL");
      document.getElementById("demo-mode-badge")?.classList.add("hidden");
      this.applyCleanUI();

      if (this.otpState.role === "coach") {
        this.tokens.coach = res.accessToken;
        localStorage.setItem("talde_token_coach", res.accessToken);
      } else {
        this.tokens.parent = res.accessToken;
        localStorage.setItem("talde_token_parent", res.accessToken);
      }
      api.client.setToken(res.accessToken);

      this.showOtpStatus("✓ ¡Código verificado correctamente!", "success");

      // Privacy: Clean input immediately, no OTP leaked
      if (otpInput) otpInput.value = "";

      const successCb = this.otpState.onSuccess;
      const scope = this.createScope();
      this.registerManagedTimeout(() => {
        if (!this.isScopeActive(scope)) return;
        this.closeOtpModal();
        if (typeof successCb === "function") {
          successCb(res);
        }
      }, 350, scope);
    } catch (err) {
      if (err?.name === "AbortError") {
        console.warn("OTP verification aborted.");
        return;
      }
      if (opId !== this.otpOpSeq || !this.isOtpModalOpen()) {
        return;
      }
      this.otpState.isVerifying = false;
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = `<span class="material-symbols-outlined text-[18px]">verified</span><span>Verificar</span>`;
      }
      const msg = mapDomainError(err);
      this.showOtpStatus(msg, "error");
      if (otpInput) {
        otpInput.value = "";
        otpInput.focus();
      }
    }
  }

  showOtpStatus(message, type = "info") {
    const banner = document.getElementById("modal-otp-status");
    const text = document.getElementById("modal-otp-status-text");
    const icon = document.getElementById("modal-otp-status-icon");
    if (!banner || !text) return;

    banner.className = "rounded-xl p-3 text-xs flex items-start gap-2 border";
    if (type === "error") {
      banner.classList.add("bg-red-50", "border-red-200", "text-red-700");
      if (icon) { icon.textContent = "error"; icon.className = "material-symbols-outlined text-[18px] text-red-600 shrink-0 mt-0.5"; }
    } else if (type === "warning") {
      banner.classList.add("bg-amber-50", "border-amber-200", "text-amber-800");
      if (icon) { icon.textContent = "warning"; icon.className = "material-symbols-outlined text-[18px] text-amber-600 shrink-0 mt-0.5"; }
    } else if (type === "success") {
      banner.classList.add("bg-emerald-50", "border-emerald-200", "text-emerald-800");
      if (icon) { icon.textContent = "check_circle"; icon.className = "material-symbols-outlined text-[18px] text-emerald-600 shrink-0 mt-0.5"; }
    } else {
      banner.classList.add("bg-blue-50", "border-blue-200", "text-blue-800");
      if (icon) { icon.textContent = "info"; icon.className = "material-symbols-outlined text-[18px] text-blue-600 shrink-0 mt-0.5"; }
    }
    text.textContent = message;
    banner.classList.remove("hidden");
  }

  hideOtpStatus() {
    const banner = document.getElementById("modal-otp-status");
    if (banner) banner.classList.add("hidden");
  }

  closeOtpModal() {
    this.otpOpSeq++;
    this.contextGeneration++;
    if (this.otpAbortController) {
      this.otpAbortController.abort();
      this.otpAbortController = null;
    }
    if (this.otpState.countdownTimer) {
      clearInterval(this.otpState.countdownTimer);
      this.otpState.countdownTimer = null;
    }
    const otpInput = document.getElementById("modal-otp-input");
    if (otpInput) otpInput.value = "";
    const modal = document.getElementById("modal-otp-auth");
    if (modal) modal.classList.add("hidden");
    const onCancel = this.otpState.onCancel;
    this.otpState.isVerifying = false;
    this.otpState.isRequesting = false;
    if (typeof onCancel === "function") {
      onCancel();
    }
  }

  async promptEmailLogin(prefillEmail = "") {
    this.openOtpModal({
      email: prefillEmail,
      displayName: "",
      role: "unknown",
      showEmailStep: !prefillEmail,
      onSuccess: async (authRes) => {
        const scope = this.createScope();
        try {
          const res = await api.teams.getMyMemberships();
          if (!this.isScopeActive(scope)) return;
          const items = res?.items || [];
          if (!items.length) {
            this.showToast("✓ Sesión iniciada. No tienes equipos asociados todavía.");
            await this.goToScreen("v2_00_onboarding_welcome", "onboard");
            return;
          }
          const coachMem = items.find(m => m.role === "COACH" && m.status === "ACTIVE");
          const guardianMem = items.find(m => m.role === "GUARDIAN" && m.status === "ACTIVE" && (m.guardian_players || []).length > 0);

          if (coachMem) {
            this.currentRole = "coach";
            this.tokens.coach = authRes.accessToken;
            this.beta.teamSeasonId = coachMem.team_season_id;
            localStorage.setItem("talde_team_season_id", coachMem.team_season_id);
            localStorage.setItem("talde_active_role", "coach");
            this.beta.team = { id: coachMem.team_id, name: coachMem.team_name, sport: coachMem.sport };
            this.beta.teamSeason = {
              id: coachMem.team_season_id,
              display_label: coachMem.display_label,
              season_label: coachMem.season_label,
              category: coachMem.category,
              join_code: coachMem.join_code
            };
            this.beta.joinCode = coachMem.join_code;
            this.showToast(`✓ Bienvenido, entrenador: ${coachMem.team_name}`);
            await this.goToScreen("v2_01_coach_home", "inicio");
          } else if (guardianMem) {
            this.currentRole = "parent";
            this.tokens.parent = authRes.accessToken;
            this.beta.teamSeasonId = guardianMem.team_season_id;
            localStorage.setItem("talde_team_season_id", guardianMem.team_season_id);
            localStorage.setItem("talde_active_role", "parent");
            this.beta.team = { id: guardianMem.team_id, name: guardianMem.team_name, sport: guardianMem.sport };
            this.beta.teamSeason = {
              id: guardianMem.team_season_id,
              display_label: guardianMem.display_label,
              season_label: guardianMem.season_label,
              category: guardianMem.category,
              join_code: guardianMem.join_code
            };
            this.beta.guardianPlayers = guardianMem.guardian_players || [];
            this.beta.guardianPlayer = this.beta.guardianPlayers[0] || null;
            this.showToast(`✓ Sesión familiar iniciada: ${this.beta.guardianPlayer?.firstName || 'Familia'}`);
            await this.goToScreen("v2_07_parent_home", "inicio");
          } else {
            this.currentRole = "parent";
            localStorage.setItem("talde_active_role", "parent");
            this.showToast("✓ Sesión iniciada. Solicitud pendiente de validación.");
            await this.goToScreen("v2_00_parent_join_team");
          }
        } catch (err) {
          if (!this.isScopeActive(scope)) return;
          console.error("Error retrieving memberships after login:", err);
          if (err?.status === 401 && err.wasAuthenticated) {
            this.handleSessionExpired(err, scope);
            return;
          }
          this.showToast("✓ Sesión iniciada.");
        }
      }
    });
  }

  toggleDemoTools() {
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
  }

  async ensureAuth(role) {
    const scope = this.createScope({ role, mode: this.appMode });
    if (this.appMode === "DEMO") {
      if (role === "coach") {
        if (!this.tokens.coach) {
          this.tokens.coach = "demo_token_coach";
        }
        api.client.setToken(this.tokens.coach);
      } else if (role === "parent") {
        if (!this.tokens.parent) {
          this.tokens.parent = "demo_token_parent";
        }
        api.client.setToken(this.tokens.parent);
      }
      return;
    }

    const unifiedToken = this.tokens.coach || this.tokens.parent || localStorage.getItem("talde_session_token");
    if (role === "coach") {
      const token = this.tokens.coach || unifiedToken || localStorage.getItem("talde_token_coach");
      if (token) {
        this.tokens.coach = token;
        api.client.setToken(token);
        if (this.sessionManager && this.sessionManager.getToken() !== token) {
          this.sessionManager.setSession(this.currentSessionId, token, this.appMode);
        }
      }
    } else if (role === "parent") {
      const token = this.tokens.parent || unifiedToken || localStorage.getItem("talde_token_parent");
      if (token) {
        this.tokens.parent = token;
        api.client.setToken(token);
        if (this.sessionManager && this.sessionManager.getToken() !== token) {
          this.sessionManager.setSession(this.currentSessionId, token, this.appMode);
        }
      }
    }
  }

  async switchTeam(teamSeasonId) {
    if (this.teamsDomain && typeof this.teamsDomain.switchTeam === "function") {
      return this.teamsDomain.switchTeam(teamSeasonId);
    }
    this._explicitIntentSeq = (this._explicitIntentSeq || 0) + 1;
    const myIntentSeq = this._explicitIntentSeq;
    const scope = this.createScope();

    if (this.appMode === "DEMO") {
      this.applyContextTransition({ teamSeasonId }, scope);
      return;
    }

    try {
      const res = await api.teams.getMyMemberships();
      if (myIntentSeq !== this._explicitIntentSeq) return;
      if (!this.isScopeActive(scope)) return;
      const items = res?.items || [];
      const targetMem = items.find(m => m.team_season_id === teamSeasonId && m.status === "ACTIVE");
      if (!targetMem) {
        throw new Error("No tienes membresía activa en este equipo.");
      }

      const isCoach = targetMem.role === "COACH";
      const guardianPlayers = isCoach ? [] : (targetMem.guardian_players || targetMem.guardianPlayers || []);
      const guardianPlayer = isCoach ? null : (guardianPlayers[0] || null);

      const ok = this.applyContextTransition({
        role: isCoach ? "coach" : "parent",
        teamSeasonId: targetMem.team_season_id,
        team: { id: targetMem.team_id, name: targetMem.team_name, sport: targetMem.sport },
        teamSeason: {
          id: targetMem.team_season_id,
          display_label: targetMem.display_label,
          season_label: targetMem.season_label,
          category: targetMem.category,
          join_code: targetMem.join_code
        },
        joinCode: targetMem.join_code,
        guardianPlayers,
        guardianPlayer
      }, scope);
      if (!ok) return;

      if (isCoach) {
        await this.goToScreen("v2_01_coach_home", "inicio");
      } else {
        await this.goToScreen("v2_07_parent_home", "inicio");
      }
    } catch (err) {
      if (myIntentSeq !== this._explicitIntentSeq) return;
      if (!this.isScopeActive(scope)) return;
      if (err?.status === 401 && err.wasAuthenticated) {
        this.handleSessionExpired(err, scope);
        return;
      }
      this.showToast(`Error al cambiar de equipo: ${mapDomainError(err)}`);
      throw err;
    }
  }

  async switchMembership(membershipId) {
    this._explicitIntentSeq = (this._explicitIntentSeq || 0) + 1;
    const myMemSeq = this._explicitIntentSeq;
    const scope = this.createScope();

    if (membershipId === "onboard") {
      this.applyContextTransition({ role: "onboard" }, scope);
      this.goToScreen("v2_00_onboarding_welcome");
      this.showToast("Modo Acceso Inicial / Onboarding");
      this.updateRoleUI();
      this.updateBottomNav();
      return;
    }

    if (this.appMode === "DEMO") {
      if (membershipId === "indautxu_inf_a" || membershipId === "coach") {
        this.applyContextTransition({ role: "coach" }, scope);
        const newScope = this.createScope({ role: "coach", mode: "DEMO" });
        await this.ensureAuth("coach");
        if (myMemSeq !== this._explicitIntentSeq) return;
        if (!this.isScopeActive(newScope) || this.appMode !== "DEMO") return;
        const target = (this.currentScreen.startsWith("v2_07_") || this.currentScreen.startsWith("v2_08_") || this.currentScreen.startsWith("v2_00_"))
          ? "v2_01_coach_home"
          : this.currentScreen;
        await this.goToScreen(target, "inicio");
        if (myMemSeq !== this._explicitIntentSeq) return;
        if (!this.isScopeActive(newScope) || this.appMode !== "DEMO") return;
        this.showToast("Modo Entrenador: Mikel Zubeldia (Sesión autenticada)");
      } else if (membershipId === "indautxu_ale_b" || membershipId === "parent") {
        this.applyContextTransition({ role: "parent" }, scope);
        const newScope = this.createScope({ role: "parent", mode: "DEMO" });
        await this.ensureAuth("parent");
        if (myMemSeq !== this._explicitIntentSeq) return;
        if (!this.isScopeActive(newScope) || this.appMode !== "DEMO") return;
        const target = (this.currentScreen.startsWith("v2_01_") || this.currentScreen.startsWith("v2_03_") || this.currentScreen.startsWith("v2_05_") || this.currentScreen.startsWith("v2_06_") || this.currentScreen.startsWith("v2_00_"))
          ? "v2_07_parent_home"
          : this.currentScreen;
        await this.goToScreen(target, "inicio");
        if (myMemSeq !== this._explicitIntentSeq) return;
        if (!this.isScopeActive(newScope) || this.appMode !== "DEMO") return;
        this.showToast("Modo Familia: Elena Gómez / Ibai #9 (Sesión autenticada)");
      }
      this.updateRoleUI();
      this.updateBottomNav();
      return;
    }

    // BETA_NORMAL mode: validate against backend memberships
    try {
      const activeToken = this.tokens.coach || this.tokens.parent || localStorage.getItem("talde_session_token");
      if (activeToken) api.client.setToken(activeToken);

      const memRes = await api.teams.getMyMemberships();
      if (myMemSeq !== this._explicitIntentSeq) return;
      if (!this.isScopeActive(scope)) return;
      const items = memRes?.items || [];

      if (membershipId === "coach" || membershipId === "indautxu_inf_a") {
        const coachMem = items.find(m => m.role === "COACH" && m.status === "ACTIVE");
        if (!coachMem) {
          this.showToast("No tienes membresía activa como entrenador.");
          return;
        }
        const ok = this.applyContextTransition({
          role: "coach",
          teamSeasonId: coachMem.team_season_id,
          team: { id: coachMem.team_id, name: coachMem.team_name, sport: coachMem.sport },
          teamSeason: {
            id: coachMem.team_season_id,
            display_label: coachMem.display_label,
            season_label: coachMem.season_label,
            category: coachMem.category,
            join_code: coachMem.join_code
          },
          joinCode: coachMem.join_code,
          guardianPlayers: [],
          guardianPlayer: null
        }, scope);
        if (!ok) return;

        await this.goToScreen("v2_01_coach_home", "inicio");
        this.showToast("Modo Entrenador (Sesión BETA)");
      } else if (membershipId === "parent" || membershipId === "indautxu_ale_b") {
        const guardianMem = items.find(m => m.role === "GUARDIAN" && m.status === "ACTIVE");
        if (!guardianMem) {
          this.showToast("No tienes membresía activa como familiar.");
          return;
        }
        const guardianPlayers = guardianMem.guardian_players || guardianMem.guardianPlayers || [];
        const guardianPlayer = guardianPlayers[0] || null;
        const ok = this.applyContextTransition({
          role: "parent",
          teamSeasonId: guardianMem.team_season_id,
          team: { id: guardianMem.team_id, name: guardianMem.team_name, sport: guardianMem.sport },
          teamSeason: {
            id: guardianMem.team_season_id,
            display_label: guardianMem.display_label,
            season_label: guardianMem.season_label,
            category: guardianMem.category
          },
          guardianPlayers,
          guardianPlayer
        }, scope);
        if (!ok) return;
        await this.goToScreen("v2_07_parent_home", "inicio");
        this.showToast("Modo Familia (Sesión BETA)");
      } else {
        const specificMem = items.find(m => m.team_season_id === membershipId && m.status === "ACTIVE");
        if (specificMem) {
          await this.switchTeam(membershipId);
        }
      }
    } catch (err) {
      if (myMemSeq !== this._explicitIntentSeq) return;
      if (!this.isScopeActive(scope)) return;
      if (err?.wasAuthenticated && err?.status === 401) {
        this.handleSessionExpired(err, scope);
        return;
      }
      this.showToast(`Error al cambiar de membresía: ${mapDomainError(err)}`);
    }

    this.updateRoleUI();
    this.updateBottomNav();
  }

  setRole(role) {
    this.switchMembership(role);
  }

  async handleParentAccess() {
    this._explicitIntentSeq = (this._explicitIntentSeq || 0) + 1;
    const myIntentSeq = this._explicitIntentSeq;

    if (this.appMode === "DEMO") {
      this.currentRole = "parent";
      localStorage.setItem("talde_active_role", "parent");
      const scope = this.createScope({ mode: "DEMO", role: "parent" });
      await this.ensureAuth("parent");
      if (myIntentSeq !== this._explicitIntentSeq) return;
      if (!this.isScopeActive(scope) || this.appMode !== "DEMO") return;
      await this.goToScreen("v2_07_parent_home", "inicio");
      return;
    }

    const scope = this.createScope();
    const parentToken = this.tokens.parent || localStorage.getItem("talde_token_parent");
    if (parentToken) {
      api.client.setToken(parentToken);
      this.tokens.parent = parentToken;
      try {
        const res = await api.teams.getMyMemberships();
        if (myIntentSeq !== this._explicitIntentSeq) return;
        if (!this.isScopeActive(scope)) return;
        const items = res?.items || [];
        const guardianMem = items.find(m => m.role === "GUARDIAN" && m.status === "ACTIVE");
        if (guardianMem) {
          const guardianPlayers = guardianMem.guardian_players || [];
          const currentChildId = this.beta?.guardianPlayer?.id || this.beta?.guardianPlayer?.playerId || localStorage.getItem("talde_guardian_child_id") || localStorage.getItem("talde_linked_player_id");
          const matchingChild = currentChildId ? guardianPlayers.find(p => (p.id || p.playerId) === currentChildId) : null;
          const guardianPlayer = matchingChild || guardianPlayers[0] || null;
          const ok = this.applyContextTransition({
            role: "parent",
            teamSeasonId: guardianMem.team_season_id,
            team: { id: guardianMem.team_id, name: guardianMem.team_name, sport: guardianMem.sport },
            teamSeason: {
              id: guardianMem.team_season_id,
              display_label: guardianMem.display_label,
              season_label: guardianMem.season_label,
              category: guardianMem.category,
              join_code: guardianMem.join_code
            },
            joinCode: guardianMem.join_code,
            guardianPlayers,
            guardianPlayer,
            tokens: { parent: parentToken }
          }, scope);
          if (!ok) return;

          if (myIntentSeq !== this._explicitIntentSeq) return;
          await this.goToScreen("v2_07_parent_home", "inicio");
          this.showToast(`Sesión familiar recuperada: ${this.beta.guardianPlayer ? (this.beta.guardianPlayer.firstName || this.beta.guardianPlayer.first_name) : 'Hijo'}`);
          return;
        }
      } catch (e) {
        if (myIntentSeq !== this._explicitIntentSeq) return;
        if (!this.isScopeActive(scope)) return;
        if (e?.status === 401 && e.wasAuthenticated) {
          this.handleSessionExpired(e, scope);
          return;
        }
        console.warn("Error restoring parent session:", e);
      }
    }
    if (myIntentSeq !== this._explicitIntentSeq) return;
    if (!this.isScopeActive(scope)) return;
    this.applyContextTransition({ role: "parent" }, scope);
    await this.goToScreen("v2_00_parent_join_team");
  }

  handlePlayerDetailBack() {
    if (this.currentRole === "parent") {
      this.goToScreen("v2_07_parent_home", "inicio");
    } else {
      this.goToScreen("v2_03_coach_roster", "equipo");
    }
  }

  async goToScreen(screenId, tab = null) {
    if (this.appMode !== "DEMO" && screenId === "v2_06_event_hub_injury") {
      screenId = "v2_05_event_hub_normal";
    }

    const coachOnlyScreens = [
      "screen_c_create_event",
      "screen_e_create_squad",
      "v2_01_coach_home",
      "v2_03_coach_roster",
      "v2_05_event_hub_normal",
      "v2_06_event_hub_injury"
    ];
    if (this.currentRole === "parent" && coachOnlyScreens.includes(screenId)) {
      this.showToast("⚠️ Acción restringida: las familias no tienen permisos sobre esta vista.");
      const select = document.getElementById("demo-screen-select");
      if (select) select.value = this.currentScreen;
      return;
    }

    if (coachOnlyScreens.includes(screenId) && (this.tokens.coach || this.appMode === "DEMO")) {
      if (this.currentRole !== "coach") {
        this.applyContextTransition({ role: "coach" });
      }
    }
    const parentOnlyScreens = [
      "v2_07_parent_home",
      "v2_08_parent_rsvp"
    ];
    if (parentOnlyScreens.includes(screenId) && (this.tokens.parent || this.appMode === "DEMO")) {
      if (this.currentRole !== "parent") {
        this.applyContextTransition({ role: "parent" });
      }
    }

    this.currentScreen = screenId;
    if (this.contextCoordinator) this.contextCoordinator.advanceViewEpoch();
    if (tab) this.currentTab = tab;
    try { localStorage.setItem("talde_last_screen", screenId); } catch {}

    const allScreens = document.querySelectorAll(".app-screen-view");
    allScreens.forEach(s => s.classList.add("hidden"));

    const target = document.getElementById(screenId);
    if (target) {
      target.classList.remove("hidden");
      const viewport = document.getElementById("phone-viewport");
      if (viewport) viewport.scrollTop = 0;
    }

    if (screenId === "screen_c_create_event") {
      const dateEl = document.getElementById("event-date");
      if (dateEl && !dateEl.value) {
        const now = new Date();
        const yyyy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, "0");
        const dd = String(now.getDate()).padStart(2, "0");
        dateEl.value = `${yyyy}-${mm}-${dd}`;
      }
    }

    if (screenId === "v2_00_parent_join_team") {
      const parentToken = this.tokens.parent || localStorage.getItem("talde_token_parent");
      if (this.appMode === "DEMO") {
        const scope = this.createScope({ mode: "DEMO" });
        await this.ensureAuth("parent");
        if (!this.isScopeActive(scope) || this.appMode !== "DEMO") return;
        this.currentRole = "parent";
        this.goToScreen("v2_07_parent_home", "inicio");
        return;
      }
      if (!this.beta.individualInviteToken && !this.beta.joinCode && parentToken) {
        if (!this.beta.guardianPlayers?.length) {
          await this.loadUserContext();
        }
        if (this.beta.guardianPlayers && this.beta.guardianPlayers.length > 0) {
          this.currentRole = "parent";
          localStorage.setItem("talde_active_role", "parent");
          this.goToScreen("v2_07_parent_home", "inicio");
          return;
        }
      }
      if (!this.beta.individualInviteToken) {
        document.getElementById("parent-general-code-section")?.classList.remove("hidden");
        document.getElementById("parent-individual-invite-banner")?.classList.add("hidden");
      }
    }

    const select = document.getElementById("demo-screen-select");
    if (select) select.value = screenId;

    this.updateBottomNav();
    this.updateRoleUI();
    await this.syncCurrentScreen();
  }

  goToTab(tab) {
    this.currentTab = tab;
    if (this.currentRole === "coach") {
      if (tab === "inicio") this.goToScreen("v2_01_coach_home", "inicio");
      else if (tab === "agenda") this.goToScreen("v2_02_coach_agenda", "agenda");
      else if (tab === "equipo") this.goToScreen("v2_03_coach_roster", "equipo");
      else if (tab === "avisos") this.goToScreen("screen_k_notices", "avisos");
    } else if (this.currentRole === "parent") {
      if (tab === "inicio") this.goToScreen("v2_07_parent_home", "inicio");
      else if (tab === "agenda") this.goToScreen("v2_02_coach_agenda", "agenda");
      else if (tab === "equipo" || tab === "hijos") this.goToScreen("v2_04_player_detail", "hijos");
      else if (tab === "avisos") this.goToScreen("screen_k_notices", "avisos");
    } else {
      this.switchMembership("indautxu_inf_a");
      this.goToTab(tab);
    }
  }

  updateBottomNav() {
    const bottomNav = document.getElementById("master-bottom-nav");
    if (!bottomNav) return;

    if (this.currentScreen.startsWith("v2_00_") || this.currentScreen === "beta_entry_screen") {
      bottomNav.classList.add("hidden");
      return;
    }
    bottomNav.classList.remove("hidden");

    const tabInicio = document.getElementById("nav-tab-inicio");
    const tabAgenda = document.getElementById("nav-tab-agenda");
    const tabEquipo = document.getElementById("nav-tab-equipo");
    const tabAvisos = document.getElementById("nav-tab-avisos");
    const equipoLabel = document.getElementById("nav-label-equipo");
    const equipoIcon = document.getElementById("nav-icon-equipo");

    const activeChild = this.beta.guardianPlayer || (this.beta.guardianPlayers && this.beta.guardianPlayers[0]);
    const childFirstName = activeChild ? (activeChild.firstName || activeChild.first_name) : null;
    const childDorsal = activeChild ? (activeChild.shirtNumber ?? activeChild.shirt_number) : null;
    const childNavLabel = childFirstName ? `${childFirstName}${childDorsal ? ` #${childDorsal}` : ''}` : "Hijos";

    if (equipoLabel) {
      equipoLabel.textContent = this.currentRole === "coach"
        ? "Equipo"
        : (this.appMode === "DEMO" ? "Ibai #9" : childNavLabel);
    }
    if (equipoIcon) equipoIcon.textContent = this.currentRole === "coach" ? "groups" : "face";

    [tabInicio, tabAgenda, tabEquipo, tabAvisos].forEach(el => {
      if (el) {
        el.className = "flex-1 flex flex-col items-center justify-center py-1 text-on-surface-variant hover:text-primary transition-colors cursor-pointer";
        const label = el.querySelector("span:last-child");
        if (label) label.className = "text-[11px] font-medium tracking-tight";
      }
    });

    let activeTabEl = tabInicio;
    if (this.currentTab === "agenda" || ["v2_02_coach_agenda", "v2_05_event_hub_normal", "v2_06_event_hub_injury", "screen_c_create_event"].includes(this.currentScreen)) {
      activeTabEl = tabAgenda;
    } else if (this.currentTab === "equipo" || this.currentTab === "hijos" || ["v2_03_coach_roster", "v2_04_player_detail"].includes(this.currentScreen)) {
      activeTabEl = tabEquipo;
    } else if (this.currentTab === "avisos" || this.currentScreen === "screen_k_notices") {
      activeTabEl = tabAvisos;
    }

    if (activeTabEl) {
      activeTabEl.className = "flex-1 flex flex-col items-center justify-center py-1 text-primary font-bold transition-colors cursor-pointer";
      const label = activeTabEl.querySelector("span:last-child");
      if (label) label.className = "text-[11px] font-bold tracking-tight text-primary";
    }
  }

  updateRoleUI() {
    const btnOnboard = document.getElementById("role-btn-onboard");
    const btnCoach = document.getElementById("role-btn-coach");
    const btnParent = document.getElementById("role-btn-parent");

    [btnOnboard, btnCoach, btnParent].forEach(btn => {
      if (btn) btn.className = "px-2 py-1 rounded-lg text-xs font-medium text-slate-400 hover:text-slate-200 transition-all cursor-pointer";
    });

    if (this.currentRole === "onboard" && btnOnboard) {
      btnOnboard.className = "px-2 py-1 rounded-lg text-xs font-bold bg-blue-600 text-white shadow-xs transition-all cursor-pointer";
    } else if (this.currentRole === "coach" && btnCoach) {
      btnCoach.className = "px-2 py-1 rounded-lg text-xs font-bold bg-blue-600 text-white shadow-xs transition-all cursor-pointer";
    } else if (this.currentRole === "parent" && btnParent) {
      btnParent.className = "px-2 py-1 rounded-lg text-xs font-bold bg-blue-600 text-white shadow-xs transition-all cursor-pointer";
    }

    // Role-based visibility for Agenda & Event Management CTAs
    const createEventBtn = document.getElementById("agenda-create-event-btn");
    const card1CoachActions = document.getElementById("agenda-card1-coach-actions");
    const card1ParentActions = document.getElementById("agenda-card1-parent-actions");
    const card2CoachBanner = document.getElementById("agenda-card2-coach-banner");
    const card2CoachBtn = document.getElementById("agenda-card2-coach-btn");
    const card2ParentBtn = document.getElementById("agenda-card2-parent-btn");
    const card3CoachAction = document.getElementById("agenda-card3-coach-action");
    const playerDetailCoachBar = document.getElementById("player-detail-coach-bar");

    const isCoach = this.currentRole === "coach";
    const isParent = this.currentRole === "parent";

    if (createEventBtn) {
      if (isCoach) createEventBtn.classList.remove("hidden");
      else createEventBtn.classList.add("hidden");
    }
    if (card1CoachActions) {
      if (isCoach) card1CoachActions.classList.remove("hidden");
      else card1CoachActions.classList.add("hidden");
    }
    if (card1ParentActions) {
      if (isParent) card1ParentActions.classList.remove("hidden");
      else card1ParentActions.classList.add("hidden");
    }
    if (card2CoachBanner) {
      if (isCoach) card2CoachBanner.classList.remove("hidden");
      else card2CoachBanner.classList.add("hidden");
    }
    if (card2CoachBtn) {
      if (isCoach) card2CoachBtn.classList.remove("hidden");
      else card2CoachBtn.classList.add("hidden");
    }
    if (card2ParentBtn) {
      if (isParent) card2ParentBtn.classList.remove("hidden");
      else card2ParentBtn.classList.add("hidden");
    }
    if (card3CoachAction) {
      if (isCoach) card3CoachAction.classList.remove("hidden");
      else card3CoachAction.classList.add("hidden");
    }
    if (playerDetailCoachBar) {
      if (isCoach) playerDetailCoachBar.classList.remove("hidden");
      else playerDetailCoachBar.classList.add("hidden");
    }
  }

  nextStep() {
    if (this.currentStepIndex < GUIDED_STEPS.length - 1) {
      this.currentStepIndex++;
      this.applyCurrentStep();
    }
  }

  prevStep() {
    if (this.currentStepIndex > 0) {
      this.currentStepIndex--;
      this.applyCurrentStep();
    }
  }

  async applyCurrentStep() {
    const step = GUIDED_STEPS[this.currentStepIndex];
    if (this.currentRole !== step.role) {
      await this.switchMembership(step.role === "coach" ? "indautxu_inf_a" : (step.role === "parent" ? "indautxu_ale_b" : "onboard"));
    }
    await this.goToScreen(step.screen, step.tab);
    this.updateStepUI();
  }

  updateStepUI() {
    const step = GUIDED_STEPS[this.currentStepIndex];
    if (!step) return;
    const titleEl = document.getElementById("demo-step-title");
    const descEl = document.getElementById("demo-step-desc");
    const actionEl = document.getElementById("demo-step-action");
    const progressEl = document.getElementById("demo-step-progress");

    if (titleEl) titleEl.textContent = step.title;
    if (descEl) descEl.textContent = step.desc;
    if (actionEl) actionEl.textContent = step.actionHint;
    if (progressEl) {
      const pct = Math.round(((this.currentStepIndex + 1) / GUIDED_STEPS.length) * 100);
      progressEl.style.width = `${pct}%`;
    }
  }

  // --- Real Backend Synchronization Methods ---

  async syncCurrentScreen() {
    try {
      if (this.currentScreen === "v2_01_coach_home") {
        await this.syncCoachHome();
      } else if (this.currentScreen === "v2_02_coach_agenda") {
        await this.syncCoachAgenda();
      } else if (this.currentScreen === "v2_03_coach_roster") {
        await this.syncCoachRoster();
      } else if (this.currentScreen === "v2_04_player_detail") {
        await this.syncPlayerDetail();
      } else if (this.currentScreen === "screen_k_notices") {
        await this.syncNotices();
      } else if (this.currentScreen === "v2_05_event_hub_normal") {
        await this.syncEventHubNormal();
      } else if (this.currentScreen === "v2_06_event_hub_injury") {
        await this.syncEventHubInjury();
      } else if (this.currentScreen === "screen_e_create_squad") {
        await this.syncSquadPrep();
      } else if (this.currentScreen === "v2_07_parent_home") {
        await this.syncParentHome();
      } else if (this.currentScreen === "v2_08_parent_rsvp") {
        await this.syncParentRsvp();
      }
    } catch (err) {
      console.error("Error sincronizando pantalla:", err);
    }
  }

  async syncCoachHome() {
    if (this.tokens.coach || this.appMode === "DEMO") {
      this.currentRole = "coach";
    }
    const scope = this.createScope({ role: "coach" });
    const isDemo = this.appMode === "DEMO";
    if (!this.beta.teamSeasonId && !isDemo) {
      this.beta.teamSeasonId = localStorage.getItem("talde_team_season_id");
    }
    const activeTeamSeasonId = isDemo ? DEMO_CONFIG.TEAM_SEASON_ID : this.beta.teamSeasonId;

    if (!activeTeamSeasonId) return;

    await this.ensureAuth("coach");
    if (!this.isScopeActive(scope)) return;

    if (!isDemo && (!this.beta.team || !this.beta.teamSeason)) {
      await this.loadUserContext();
      if (!this.isScopeActive(scope)) return;
    }

    try {
      // Concurrently fetch real data from PostgreSQL
      const [playersRes, eventsRes, pendingRes, pendingReqs] = await Promise.all([
        this.safeFetch(api.teams.getPlayers(activeTeamSeasonId), { items: [] }, scope),
        this.safeFetch(api.events.getEvents(activeTeamSeasonId), { items: [] }, scope),
        this.safeFetch(api.pending.getPending(activeTeamSeasonId), { actionItems: [], indicators: [] }, scope),
        this.safeFetch(api.teams.getPendingRequests(activeTeamSeasonId), { items: [] }, scope)
      ]);

      if (!this.isScopeActive(scope)) {
        console.warn("syncCoachHome: Stale response discarded due to context switch.");
        return;
      }

      const players = playersRes.items || [];
      const events = eventsRes.items || [];
      const actionItems = pendingRes.actionItems || [];
      const pendingRequests = pendingReqs.items || [];

      // Update team info
      const titleEl = document.getElementById("coach-home-team-title");
      const seasonEl = document.getElementById("coach-home-season-label");
      const userEl = document.getElementById("coach-home-user-name");
      const codePill = document.getElementById("coach-home-code-pill");
      const shareBtnText = document.getElementById("coach-share-invite-btn-text");

      const joinCode = isDemo ? "INDA16" : (this.beta.joinCode || "---");

      if (titleEl) {
        titleEl.textContent = isDemo
          ? "S. D. Indautxu · Infantil A"
          : `${this.beta.team?.name || 'Mi Club'} · ${this.beta.teamSeason?.display_label || this.beta.teamSeason?.displayLabel || 'Mi Equipo'}`;
      }
      if (seasonEl) {
        seasonEl.textContent = isDemo
          ? "Temporada 2026/27"
          : `Temporada ${this.beta.teamSeason?.season_label || '2026/27'}`;
      }
      if (userEl) {
        userEl.textContent = isDemo ? "Mikel" : (this.beta.coachName || "Entrenador");
      }
      if (codePill) {
        codePill.textContent = `Código: ${joinCode}`;
      }
      if (shareBtnText) {
        shareBtnText.textContent = `Compartir invitación (${joinCode})`;
      }

      // Update Metric Strip
      const totalPlayers = players.length;
      const linkedCount = players.filter(p => (p.guardians_count || 0) > 0).length;
      const pendingCount = totalPlayers - linkedCount;

      const elPlayersCount = document.getElementById("coach-players-count");
      const elLinkedCount = document.getElementById("coach-linked-count");
      const elPendingCount = document.getElementById("coach-pending-count");
      const emptyPlayersCard = document.getElementById("coach-empty-players-card");

      if (elPlayersCount) elPlayersCount.textContent = totalPlayers;
      if (elLinkedCount) elLinkedCount.textContent = linkedCount;
      if (elPendingCount) elPendingCount.textContent = pendingCount;

      if (emptyPlayersCard) {
        if (totalPlayers === 0) {
          emptyPlayersCard.classList.remove("hidden");
        } else {
          emptyPlayersCard.classList.add("hidden");
        }
      }

      // Update Pending Requests Card in Onboarding
      const reqCard = document.getElementById("coach-pending-approval-card");
      if (pendingRequests.length > 0 && reqCard) {
        reqCard.classList.remove("hidden");
        const req = pendingRequests[0];
        const isIndividual = Boolean(req.player_id);
        reqCard.innerHTML = `
          <div class="flex items-start gap-2.5">
            <div class="w-8 h-8 rounded-full bg-amber-100 text-amber-800 flex items-center justify-center shrink-0 mt-0.5 font-bold text-xs">
              <span class="material-symbols-outlined text-[18px]">person_add</span>
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center justify-between">
                <span class="font-label-sm text-label-sm text-amber-800 font-bold uppercase tracking-wider">
                  ${isIndividual ? "Solicitud individual" : "Solicitud código general"}
                </span>
                <span class="text-[10px] text-slate-400">Reciente</span>
              </div>
              <p class="font-label-md text-label-md text-on-surface font-bold mt-0.5 leading-snug">
                ${escapeHtml(req.display_name || req.email)} <span class="font-normal text-on-surface-variant text-xs">solicita vincularse ${
                  isIndividual
                    ? `a su hijo/a <strong>${escapeHtml(req.first_name)} ${escapeHtml(req.last_name)}</strong>`
                    : `y reclama al menor <strong>${escapeHtml(req.claimed_player_name)}</strong> (#${escapeHtml(req.claimed_shirt_number || '-')})`
                }</span>
              </p>
            </div>
          </div>
          ${!isIndividual ? `
            <div class="mt-2 p-2 bg-slate-50 rounded-lg border border-slate-200 text-xs">
              <label class="block font-bold text-slate-700 mb-1">Asignar a jugador de la plantilla:</label>
              <select id="coach-assign-player-${escapeHtml(req.id)}" class="w-full h-8 px-2 rounded border border-slate-300 bg-white text-xs">
                ${players.map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.first_name)} ${escapeHtml(p.last_name)} (#${escapeHtml(p.shirt_number || '-')})</option>`).join("")}
              </select>
            </div>
          ` : ''}
          <div class="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100">
            <button id="btn-reject-guardian-request" data-request-id="${escapeHtml(req.id)}" class="btn-reject-guardian-request h-9 rounded-lg border border-outline-variant bg-surface-container-low hover:bg-surface-container text-on-surface-variant font-label-md text-label-md font-medium flex items-center justify-center cursor-pointer active:scale-[0.98]">
              Rechazar
            </button>
            <button id="btn-approve-guardian-request" data-request-id="${escapeHtml(req.id)}" data-select-id="${isIndividual ? '' : `coach-assign-player-${escapeHtml(req.id)}`}" class="btn-approve-guardian-request h-9 rounded-lg bg-secondary hover:bg-emerald-700 text-white font-label-md text-label-md font-bold flex items-center justify-center gap-1 shadow-xs cursor-pointer active:scale-[0.98]">
              <span class="material-symbols-outlined text-[16px]">check</span>
              Aceptar y Vincular
            </button>
          </div>
        `;
        const rejectBtn = reqCard.querySelector(".btn-reject-guardian-request");
        if (rejectBtn) {
          rejectBtn.addEventListener("click", () => {
            this.rejectBetaGuardianRequest(rejectBtn.dataset.requestId);
          });
        }
        const approveBtn = reqCard.querySelector(".btn-approve-guardian-request");
        if (approveBtn) {
          approveBtn.addEventListener("click", () => {
            this.approveBetaGuardianRequest(approveBtn.dataset.requestId, approveBtn.dataset.selectId || null);
          });
        }
      } else if (reqCard) {
        reqCard.classList.add("hidden");
      }

      // SECTION 1: 'HOY' (Immediate operational focus)
      const todayContainer = document.getElementById("coach-home-today-container");
      const todayBadge = document.getElementById("coach-home-today-badge");
      
      const now = new Date();
      const todayEvent = events.find(e => {
        const d = new Date(e.starts_at);
        return d.toDateString() === now.toDateString();
      }) || (isDemo ? events.find(e => e.type === "TRAINING" || e.title.includes("Entrenamiento")) : null);

      if (todayContainer) {
        if (todayEvent) {
          if (todayBadge) {
            todayBadge.textContent = todayEvent.type === "TRAINING" ? "Sesión en Campo" : "Día de Partido";
            todayBadge.className = "font-label-sm text-label-sm font-bold px-2 py-0.5 rounded bg-primary-fixed text-on-primary-fixed";
          }
          const timeStr = new Date(todayEvent.starts_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          const arrivalStr = todayEvent.arrival_at ? new Date(todayEvent.arrival_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : timeStr;

          todayContainer.innerHTML = `
            <div class="bg-surface-container-lowest rounded-xl border border-outline-variant/70 shadow-sm p-4 space-y-4">
              <div class="flex items-start justify-between">
                <div>
                  <div class="flex items-center gap-2">
                    <span class="font-headline-md text-headline-md text-on-surface font-extrabold">${escapeHtml(todayEvent.title)}</span>
                    <span class="px-2.5 py-0.5 rounded-full bg-primary-container text-on-primary font-label-md text-label-md font-bold">${timeStr} h</span>
                  </div>
                  <p class="font-body-sm text-body-sm text-on-surface-variant mt-1 flex items-center gap-1">
                    <span class="material-symbols-outlined text-[16px] text-primary">schedule</span>
                    Llegada ${arrivalStr} h
                  </p>
                </div>
                <div class="w-10 h-10 rounded-xl bg-surface-container flex items-center justify-center text-primary">
                  <span class="material-symbols-outlined text-[24px]">${todayEvent.type === 'TRAINING' ? 'fitness_center' : 'sports_soccer'}</span>
                </div>
              </div>
              <div class="bg-surface-container-low rounded-lg p-3 border border-outline-variant/30 flex items-center justify-between">
                <div class="flex items-center gap-2">
                  <span class="material-symbols-outlined text-[20px] text-on-surface-variant">stadium</span>
                  <span class="font-label-md text-label-md text-on-surface font-semibold">${escapeHtml(todayEvent.location || 'Campo de entrenamiento')}</span>
                </div>
                <span class="font-label-sm text-label-sm text-on-surface-variant bg-surface-container-lowest px-2 py-1 rounded border border-outline-variant/40">Fútbol</span>
              </div>
              <div class="flex items-center justify-between py-1 border-t border-surface-container-high">
                <div class="flex items-center gap-2">
                  <span class="w-6 h-6 rounded-full bg-secondary-container text-on-secondary-container flex items-center justify-center">
                    <span class="material-symbols-outlined text-[16px]">check</span>
                  </span>
                  <span class="font-label-md text-label-md text-on-surface font-bold">${totalPlayers} jugadores convocados</span>
                </div>
              </div>
              <button onclick="teamApp.goToScreen('v2_05_event_hub_normal', 'agenda')" class="w-full h-[52px] rounded-xl bg-primary-container hover:bg-primary active:scale-[0.98] transition-all duration-150 text-on-primary font-label-lg text-label-lg font-bold flex items-center justify-center gap-2 shadow-sm cursor-pointer">
                <span class="material-symbols-outlined text-[20px]">fact_check</span>
                Pasar lista / Asistencia
              </button>
            </div>
          `;
        } else {
          if (todayBadge) {
            todayBadge.textContent = "Sin evento";
            todayBadge.className = "font-label-sm text-label-sm text-on-surface-variant bg-surface-container px-2 py-0.5 rounded";
          }
          todayContainer.innerHTML = `
            <div class="bg-surface-container-lowest rounded-xl border border-outline-variant/70 shadow-sm p-6 text-center space-y-3">
              <div class="w-12 h-12 mx-auto rounded-full bg-surface-container flex items-center justify-center text-on-surface-variant">
                <span class="material-symbols-outlined text-[24px]">calendar_today</span>
              </div>
              <div>
                <h3 class="font-label-lg text-label-lg font-bold text-on-surface">No hay eventos programados para hoy</h3>
                <p class="font-body-sm text-body-sm text-on-surface-variant mt-0.5">El descanso también es parte del plan o puedes crear una nueva sesión.</p>
              </div>
              <button onclick="teamApp.goToScreen('screen_c_create_event', 'agenda')" class="h-10 px-4 bg-primary-container hover:bg-primary text-on-primary font-label-md text-label-md font-bold rounded-xl inline-flex items-center gap-1.5 shadow-sm active:scale-[0.98] transition-all cursor-pointer">
                <span class="material-symbols-outlined text-[18px]">add</span>
                <span>Crear primer evento</span>
              </button>
            </div>
          `;
        }
      }

      // SECTION 2: 'PENDIENTE DE TI'
      const pendingContainer = document.getElementById("coach-pending-items-container");
      const pendingBadge = document.getElementById("coach-pending-count-badge");

      const bajaItem = actionItems.find(item => item.type === "CALLED_PLAYER_UNAVAILABLE" && item.status === "OPEN");
      this.live.activeActionItem = bajaItem;

      let taskCards = [];

      if (bajaItem) {
        taskCards.push(`
          <div id="coach-item-baja-card" class="bg-surface-container-lowest rounded-xl border-l-4 border-l-tertiary-container border-y border-r border-outline-variant/70 p-4 space-y-3 shadow-sm">
            <div class="flex items-start justify-between gap-2">
              <div>
                <span class="font-headline-sm text-headline-sm text-on-surface font-extrabold block">Baja de última hora</span>
                <p id="coach-item-baja-desc" class="font-body-sm text-body-sm text-tertiary font-medium mt-0.5">
                  ${escapeHtml(bajaItem.first_name || "Ibai")} (#9) ha comunicado que no puede asistir (nota: está enfermo).
                </p>
              </div>
              <span class="font-label-sm text-label-sm font-bold bg-tertiary-fixed text-on-tertiary-fixed px-2.5 py-1 rounded-full whitespace-nowrap border border-tertiary-fixed-dim">
                No disponible
              </span>
            </div>
            <button class="w-full h-[50px] rounded-xl bg-surface-container-lowest border-2 border-tertiary text-tertiary hover:bg-tertiary-fixed active:scale-[0.98] transition-all font-label-lg text-label-lg font-bold flex items-center justify-center gap-1.5 cursor-pointer" onclick="teamApp.goToScreen('v2_06_event_hub_injury', 'agenda')">
              <span class="material-symbols-outlined text-[18px]">event_busy</span>
              Resolver baja
            </button>
          </div>
        `);
      }

      if (pendingRequests.length > 0) {
        taskCards.push(`
          <div class="bg-surface-container-lowest rounded-xl border-l-4 border-l-amber-500 border-y border-r border-outline-variant/70 p-4 space-y-3 shadow-sm">
            <div class="flex items-start justify-between gap-2">
              <div>
                <span class="font-headline-sm text-headline-sm text-on-surface font-extrabold block">Solicitud de vinculación familiar</span>
                <p class="font-body-sm text-body-sm text-on-surface-variant mt-0.5">
                  ${pendingRequests.length} ${pendingRequests.length === 1 ? 'familia espera' : 'familias esperan'} confirmación para acceder al equipo.
                </p>
              </div>
              <span class="font-label-sm text-label-sm font-bold bg-amber-100 text-amber-900 px-2.5 py-1 rounded-full whitespace-nowrap border border-amber-300">
                Pendiente
              </span>
            </div>
            <button onclick="teamApp.goToScreen('v2_01_coach_home', 'inicio'); document.getElementById('coach-onboarding-banner')?.scrollIntoView({ behavior: 'smooth' });" class="w-full h-[50px] rounded-xl bg-primary-container hover:bg-primary active:scale-[0.98] transition-all text-on-primary font-label-lg text-label-lg font-bold flex items-center justify-center gap-1.5 shadow-sm cursor-pointer">
              <span class="material-symbols-outlined text-[18px]">person_check</span>
              Revisar solicitudes
            </button>
          </div>
        `);
      }

      if (isDemo && events.some(e => e.title.includes("Torneo Indautxu"))) {
        taskCards.push(`
          <div id="coach-item-torneo-card" class="bg-surface-container-lowest rounded-xl border-l-4 border-l-amber-500 border-y border-r border-outline-variant/70 p-4 space-y-3 shadow-sm">
            <div class="flex items-start justify-between gap-2">
              <div>
                <span class="font-headline-sm text-headline-sm text-on-surface font-extrabold block">Torneo Indautxu</span>
                <p id="coach-item-torneo-desc" class="font-body-sm text-body-sm text-on-surface-variant mt-0.5">2 familias todavía no han respondido (Ane Mintegi, Peio Gómez)</p>
              </div>
              <span class="font-label-sm text-label-sm font-bold bg-amber-100 text-amber-900 px-2.5 py-1 rounded-full whitespace-nowrap border border-amber-300">
                Cierra 20:00 h
              </span>
            </div>
            <button onclick="teamApp.goToScreen('v2_05_event_hub_normal', 'agenda')" class="w-full h-[50px] rounded-xl bg-primary-container hover:bg-primary active:scale-[0.98] transition-all text-on-primary font-label-lg text-label-lg font-bold flex items-center justify-center gap-1.5 shadow-sm cursor-pointer">
              <span class="material-symbols-outlined text-[18px]">send</span>
              Revisar
            </button>
          </div>
        `);
      }

      const totalTasks = taskCards.length;
      if (pendingBadge) {
        pendingBadge.textContent = `${totalTasks} ${totalTasks === 1 ? 'tarea' : 'tareas'}`;
      }

      const dateAttentionEl = document.getElementById("coach-home-date-attention");
      if (dateAttentionEl) {
        const dateStr = isDemo
          ? "Viernes 18 de Septiembre 2026"
          : new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
        const capDateStr = dateStr.charAt(0).toUpperCase() + dateStr.slice(1);
        if (totalTasks === 0) {
          dateAttentionEl.textContent = `${capDateStr} · Todo al día en el equipo`;
        } else {
          dateAttentionEl.textContent = `${capDateStr} · ${totalTasks} ${totalTasks === 1 ? 'cosa necesita' : 'cosas necesitan'} tu atención`;
        }
      }

      if (pendingContainer) {
        if (totalTasks === 0) {
          pendingContainer.innerHTML = `
            <div class="bg-surface-container-lowest rounded-xl border border-outline-variant/70 shadow-sm p-5 text-center space-y-2">
              <div class="w-10 h-10 mx-auto rounded-full bg-emerald-50 text-emerald-700 flex items-center justify-center">
                <span class="material-symbols-outlined text-[22px]">check_circle</span>
              </div>
              <h3 class="font-label-lg text-label-lg font-bold text-on-surface">Todo al día</h3>
              <p class="font-body-sm text-body-sm text-on-surface-variant">No tienes avisos, bajas ni tareas operativas pendientes.</p>
            </div>
          `;
        } else {
          pendingContainer.innerHTML = taskCards.join("");
        }
      }

      // SECTION 3: 'ESTA SEMANA'
      const weekContainer = document.getElementById("coach-week-events-container");
      if (weekContainer) {
        if (events.length === 0) {
          weekContainer.innerHTML = `
            <div class="p-6 text-center space-y-3">
              <p class="font-body-sm text-body-sm text-on-surface-variant">Aún no hay eventos programados en esta temporada.</p>
              <button onclick="teamApp.goToScreen('screen_c_create_event', 'agenda')" class="text-xs text-primary font-bold hover:underline cursor-pointer inline-flex items-center gap-1">
                <span class="material-symbols-outlined text-[16px]">add</span>
                <span>Programar evento</span>
              </button>
            </div>
          `;
        } else {
          weekContainer.innerHTML = events.slice(0, 5).map(e => {
            const d = new Date(e.starts_at);
            const dayName = d.toLocaleDateString('es-ES', { weekday: 'short' }).toUpperCase().slice(0, 3);
            const dayNum = d.getDate();
            const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            return `
              <div class="p-3.5 flex items-center justify-between border-b border-outline-variant/40 last:border-0 hover:bg-surface-container-low/30 transition-colors cursor-pointer" onclick="teamApp.goToScreen('v2_02_coach_agenda', 'agenda')">
                <div class="flex items-center gap-3">
                  <div class="w-12 text-center">
                    <span class="font-label-sm text-label-sm text-primary font-extrabold block">${dayName}</span>
                    <span class="font-headline-sm text-headline-sm font-extrabold text-on-surface leading-none">${dayNum}</span>
                  </div>
                  <div class="border-l border-outline-variant/50 pl-3">
                    <span class="font-label-md text-label-md text-on-surface font-bold block">${escapeHtml(e.title)} · ${timeStr} h</span>
                    <span class="font-body-sm text-body-sm text-on-surface-variant">${escapeHtml(e.location || 'Campo de fútbol')}</span>
                  </div>
                </div>
                <span class="font-label-sm text-label-sm font-bold px-2 py-0.5 rounded bg-surface-container-high text-primary border border-outline-variant/40 whitespace-nowrap">
                  ${escapeHtml(e.type)}
                </span>
              </div>
            `;
          }).join("");
        }
      }

      // SECTION 4: 'CAMBIOS RECIENTES'
      const changesContainer = document.getElementById("coach-recent-changes-container");
      if (changesContainer) {
        if (isDemo) {
          changesContainer.innerHTML = `
            <div class="flex items-start gap-3">
              <div class="w-8 h-8 rounded-full bg-primary-fixed text-on-primary-fixed flex items-center justify-center shrink-0 mt-0.5">
                <span class="material-symbols-outlined text-[18px]">update</span>
              </div>
              <div class="flex-1 min-w-0">
                <p class="font-body-sm text-body-sm text-on-surface font-medium leading-snug">
                  El entrenamiento de hoy viernes pasa a las <strong class="text-primary font-bold">18:30 h (+30 min)</strong>.
                </p>
                <span class="font-label-sm text-label-sm text-on-surface-variant mt-0.5 block">Hace 1h · Notificado a familias</span>
              </div>
            </div>
            <div class="border-t border-outline-variant/30"></div>
            <div class="flex items-start gap-3">
              <div class="w-8 h-8 rounded-full bg-tertiary-fixed text-on-tertiary-fixed flex items-center justify-center shrink-0 mt-0.5">
                <span class="material-symbols-outlined text-[18px]">person_cancel</span>
              </div>
              <div class="flex-1 min-w-0">
                <p class="font-body-sm text-body-sm text-on-surface font-medium leading-snug">
                  <strong class="font-bold text-tertiary">Ibai Aranguren</strong> no puede asistir este fin de semana (nota: está enfermo).
                </p>
                <span class="font-label-sm text-label-sm text-on-surface-variant mt-0.5 block">Hace 15 min · Por APP Tutor</span>
              </div>
            </div>
          `;
        } else if (events.length > 0 || totalPlayers > 0) {
          changesContainer.innerHTML = `
            <div class="flex items-start gap-3">
              <div class="w-8 h-8 rounded-full bg-emerald-100 text-emerald-800 flex items-center justify-center shrink-0 mt-0.5">
                <span class="material-symbols-outlined text-[18px]">group_add</span>
              </div>
              <div class="flex-1 min-w-0">
                <p class="font-body-sm text-body-sm text-on-surface font-medium leading-snug">
                  Plantilla actualizada con <strong class="text-primary font-bold">${totalPlayers} deportista${totalPlayers === 1 ? '' : 's'}</strong> en la temporada.
                </p>
                <span class="font-label-sm text-label-sm text-on-surface-variant mt-0.5 block">Reciente</span>
              </div>
            </div>
          `;
        } else {
          changesContainer.innerHTML = `
            <div class="py-2 text-center">
              <span class="font-body-sm text-body-sm text-on-surface-variant">No hay cambios recientes registrados en el equipo.</span>
            </div>
          `;
        }
      }

    } catch (err) {
      console.warn("Could not sync coach home:", err);
    }
  }

  selectEventType(type) {
    this.selectedEventType = type;
    const types = ["TRAINING", "MATCH", "TOURNAMENT", "OTHER"];
    types.forEach(t => {
      const btn = document.getElementById(`event-type-btn-${t.toLowerCase()}`);
      if (!btn) return;
      if (t === type) {
        btn.className = "flex flex-col items-center justify-center py-2 px-1 rounded-lg bg-primary-container text-on-primary shadow-sm transition-all active:scale-[0.98] cursor-pointer";
        const icon = btn.querySelector(".material-symbols-outlined");
        if (icon) icon.className = "material-symbols-outlined text-[20px] mb-0.5 text-on-primary";
        const label = btn.querySelector("span:last-child");
        if (label) label.className = "font-label-sm text-label-sm font-bold";
      } else {
        btn.className = "flex flex-col items-center justify-center py-2 px-1 rounded-lg bg-surface-container-lowest text-on-surface hover:bg-surface-container transition-all active:scale-[0.98] cursor-pointer";
        const icon = btn.querySelector(".material-symbols-outlined");
        if (icon) icon.className = "material-symbols-outlined text-[20px] mb-0.5 text-on-surface-variant";
        const label = btn.querySelector("span:last-child");
        if (label) label.className = "font-label-sm text-label-sm font-semibold";
      }
    });
  }

  autofillEventTitle() {
    const titleInput = document.getElementById("event-title");
    if (!titleInput) return;
    const type = this.selectedEventType || "TRAINING";
    if (type === "TRAINING") titleInput.value = "Entrenamiento semanal";
    else if (type === "MATCH") titleInput.value = "Partido de Liga";
    else if (type === "TOURNAMENT") titleInput.value = "Torneo Amistoso";
    else titleInput.value = "Actividad de equipo";
  }

  async submitCreateEvent() {
    const reqGen = this.contextGeneration;
    const isDemo = this.appMode === "DEMO";
    const activeTeamSeasonId = isDemo ? DEMO_CONFIG.TEAM_SEASON_ID : this.beta.teamSeasonId;
    if (!activeTeamSeasonId) {
      this.showToast("No hay temporada activa para registrar el evento.");
      return;
    }

    const titleInput = document.getElementById("event-title");
    const locationInput = document.getElementById("location-input");
    const notesInput = document.getElementById("event-notes");
    const dateInput = document.getElementById("event-date");
    const timeInput = document.getElementById("event-time");
    const arrivalInput = document.getElementById("event-arrival");

    const title = titleInput?.value?.trim() || "Entrenamiento semanal";
    const location = locationInput?.value?.trim() || "Campo Municipal";
    const notes = notesInput?.value?.trim() || null;
    const type = this.selectedEventType || "TRAINING";

    let startsAtDate;
    if (dateInput?.value && timeInput?.value) {
      const [year, month, day] = dateInput.value.split("-").map(Number);
      const [hours, minutes] = timeInput.value.split(":").map(Number);
      startsAtDate = new Date(year, month - 1, day, hours, minutes, 0);
    } else {
      const now = new Date();
      startsAtDate = new Date(now.getTime() + 2 * 3600 * 1000);
    }

    let arrivalAtDate;
    if (dateInput?.value && arrivalInput?.value) {
      const [year, month, day] = dateInput.value.split("-").map(Number);
      const [arrHours, arrMinutes] = arrivalInput.value.split(":").map(Number);
      arrivalAtDate = new Date(year, month - 1, day, arrHours, arrMinutes, 0);
    } else {
      arrivalAtDate = new Date(startsAtDate.getTime() - 15 * 60 * 1000);
    }

    const startsAt = startsAtDate.toISOString();
    const arrivalAt = arrivalAtDate.toISOString();

    const payload = {
      type,
      title,
      startsAt,
      arrivalAt,
      location,
      notes,
      availabilityEnabled: true,
      callupEnabled: type !== "TRAINING"
    };

    const scope = this.createScope();
    try {
      await this.ensureAuth("coach");
      if (!this.isScopeActive(scope)) return;
      const res = await api.events.createEvent(activeTeamSeasonId, payload);
      if (!this.isScopeActive(scope)) return;
      this.showToast(`✓ Evento "${res.title}" creado con éxito.`);
      if (titleInput) titleInput.value = "";
      if (locationInput) locationInput.value = "";
      if (notesInput) notesInput.value = "";

      await this.syncCoachHome();
      if (!this.isScopeActive(scope)) return;
      await this.goToScreen("v2_01_coach_home", "inicio");
    } catch (err) {
      if (!this.isScopeActive(scope)) return;
      console.error("Error creating event:", err);
      if (err?.status === 401 && err.wasAuthenticated) {
        this.handleSessionExpired(err);
        return;
      }
      this.showToast(`Error al crear evento: ${mapDomainError(err)}`);
    }
  }

  async syncCoachAgenda() {
    const reqGen = this.contextGeneration;
    const isDemo = this.appMode === "DEMO";
    const activeTeamSeasonId = isDemo ? DEMO_CONFIG.TEAM_SEASON_ID : this.beta.teamSeasonId;

    const teamTitleEl = document.getElementById("agenda-team-title");
    const seasonLabelEl = document.getElementById("agenda-season-label");
    const crestEl = document.getElementById("agenda-team-crest");
    const emptyContainer = document.getElementById("agenda-empty-container");
    const eventsContainer = document.getElementById("agenda-events-container");
    const statsWidget = document.getElementById("agenda-weekly-stats-widget");
    const createBtn = document.getElementById("agenda-create-event-btn");
    const emptyCreateBtn = document.getElementById("agenda-empty-create-btn");

    const isGuardian = this.currentRole === "parent";
    if (createBtn) createBtn.classList.toggle("hidden", isGuardian);
    if (emptyCreateBtn) emptyCreateBtn.classList.toggle("hidden", isGuardian);

    if (isDemo) {
      if (teamTitleEl) teamTitleEl.textContent = "S. D. Indautxu · Infantil A";
      if (seasonLabelEl) seasonLabelEl.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-secondary"></span> Temporada 2026/27`;
      if (crestEl) crestEl.textContent = "IN";
      if (emptyContainer) emptyContainer.classList.add("hidden");
      if (statsWidget) statsWidget.classList.remove("hidden");
      if (eventsContainer) {
        eventsContainer.classList.remove("hidden");
        if (this._demoAgendaHtml) {
          eventsContainer.innerHTML = this._demoAgendaHtml;
        } else {
          this._demoAgendaHtml = eventsContainer.innerHTML;
        }
      }
      return;
    }

    // BETA_NORMAL
    if (eventsContainer && !this._demoAgendaHtml) {
      this._demoAgendaHtml = eventsContainer.innerHTML;
    }

    if (teamTitleEl) {
      teamTitleEl.textContent = `${this.beta.team?.name || 'Equipo'} · ${this.beta.teamSeason?.display_label || 'Categoría'}`;
    }
    if (seasonLabelEl) {
      seasonLabelEl.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-secondary"></span> Temporada ${escapeHtml(this.beta.teamSeason?.season_label || '2026/27')}`;
    }
    if (crestEl) {
      crestEl.textContent = (this.beta.team?.name || 'EQ').slice(0, 2).toUpperCase();
    }

    if (!activeTeamSeasonId) {
      if (emptyContainer) emptyContainer.classList.remove("hidden");
      if (eventsContainer) eventsContainer.classList.add("hidden");
      if (statsWidget) statsWidget.classList.add("hidden");
      return;
    }

    try {
      await this.ensureAuth(isGuardian ? "parent" : "coach");
      if (reqGen !== this.contextGeneration) return;
      const eventsRes = await api.events.getEvents(activeTeamSeasonId);
      if (reqGen !== this.contextGeneration) {
        console.warn("syncCoachAgenda: Stale response discarded due to context switch.");
        return;
      }
      const events = eventsRes?.items || [];
      this.live.events = events;

      if (events.length === 0) {
        if (emptyContainer) emptyContainer.classList.remove("hidden");
        if (eventsContainer) eventsContainer.classList.add("hidden");
        if (statsWidget) statsWidget.classList.add("hidden");
      } else {
        if (emptyContainer) emptyContainer.classList.add("hidden");
        if (statsWidget) statsWidget.classList.add("hidden");
        if (eventsContainer) {
          eventsContainer.classList.remove("hidden");
          eventsContainer.innerHTML = events.map(ev => {
            const d = new Date(ev.starts_at);
            const dateFormatted = d.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });
            const timeFormatted = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
            let arrivalFormatted = '';
            if (ev.arrival_at) {
              const arrD = new Date(ev.arrival_at);
              arrivalFormatted = ` (Citación: ${arrD.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}h)`;
            }
            const typeLabel = ev.type === 'MATCH' ? 'Partido' : (ev.type === 'TOURNAMENT' ? 'Torneo' : 'Entrenamiento');
            let callupSectionHtml = '';
            if (ev.callup_enabled) {
              if (isGuardian) {
                if (!ev.callup_status || ev.callup_status !== 'PUBLISHED') {
                  callupSectionHtml = `
                    <div class="mt-2 pt-2 border-t border-outline-variant/30 flex items-center justify-between">
                      <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-50 border border-amber-300 text-amber-900 font-label-sm text-[11px] font-extrabold">
                        <span class="material-symbols-outlined text-[13px] text-amber-700">hourglass_top</span>
                        <span>Convocatoria pendiente</span>
                      </span>
                      <span class="text-[11px] text-on-surface-variant font-medium">Por publicar</span>
                    </div>
                  `;
                } else {
                  callupSectionHtml = `
                    <div class="mt-2 pt-2 border-t border-outline-variant/30 flex items-center justify-between">
                      <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-50 border border-emerald-300 text-emerald-900 font-label-sm text-[11px] font-bold">
                        <span class="material-symbols-outlined text-[13px] text-emerald-700">check_circle</span>
                        <span>Convocatoria publicada (Rev. ${escapeHtml(ev.callup_revision || 1)})</span>
                      </span>
                    </div>
                  `;
                }
              } else {
                if (!ev.callup_status || ev.callup_status !== 'PUBLISHED') {
                  callupSectionHtml = `
                    <div class="mt-2 pt-2 border-t border-outline-variant/30 flex items-center justify-between gap-2">
                      <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-50 border border-amber-300 text-amber-900 font-label-sm text-[11px] font-extrabold">
                        <span class="material-symbols-outlined text-[13px] text-amber-700">hourglass_top</span>
                        <span>Convocatoria pendiente</span>
                      </span>
                      <button id="coach-agenda-publish-btn-${escapeHtml(ev.id)}" data-event-id="${escapeHtml(ev.id)}" class="btn-publish-callup-action h-8 px-3 rounded-lg bg-primary-container hover:bg-primary text-on-primary font-label-sm text-[11px] font-bold flex items-center gap-1 shadow-xs cursor-pointer active:scale-95 transition-all">
                        <span class="material-symbols-outlined text-[14px]">send</span>
                        <span>Publicar convocatoria</span>
                      </button>
                    </div>
                  `;
                } else {
                  callupSectionHtml = `
                    <div class="mt-2 pt-2 border-t border-outline-variant/30 flex items-center justify-between">
                      <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-50 border border-emerald-300 text-emerald-900 font-label-sm text-[11px] font-bold">
                        <span class="material-symbols-outlined text-[13px] text-emerald-700">check_circle</span>
                        <span>✓ Convocatoria publicada (Rev. ${escapeHtml(ev.callup_revision || 1)})</span>
                      </span>
                    </div>
                  `;
                }
              }
            }

            return `
              <div class="flex flex-col gap-2">
                <div class="flex items-center justify-between px-0.5">
                  <div class="flex items-center gap-2">
                    <span class="relative inline-flex rounded-full h-2.5 w-2.5 bg-primary"></span>
                    <h2 class="font-label-lg text-label-lg text-on-surface tracking-wide uppercase capitalize">${dateFormatted}</h2>
                  </div>
                  <span class="font-label-sm text-label-sm bg-surface-container text-on-surface-variant px-2 py-0.5 rounded-md font-bold">
                    ${escapeHtml(typeLabel)}
                  </span>
                </div>
                <article class="bg-surface-container-lowest rounded-2xl border border-outline-variant/80 p-4 shadow-sm flex flex-col gap-3.5 transition-all">
                  <div class="flex items-start justify-between gap-2">
                    <div>
                      <div class="flex items-center gap-2 mb-1">
                        <span class="font-label-sm text-label-sm bg-surface-container text-primary font-bold px-2 py-0.5 rounded">
                          ${escapeHtml(typeLabel)}
                        </span>
                      </div>
                      <h3 class="font-headline-sm text-headline-sm text-on-surface font-bold">${escapeHtml(ev.title)}</h3>
                    </div>
                    <span class="material-symbols-outlined text-outline">fitness_center</span>
                  </div>
                  <div class="bg-surface-bright rounded-xl p-3 border border-outline-variant/40 flex flex-col gap-2 text-body-sm font-body-sm text-on-surface">
                    <div class="flex items-center gap-2.5">
                      <span class="material-symbols-outlined text-primary text-[18px]">schedule</span>
                      <span><strong>${timeFormatted}</strong> <span class="text-on-surface-variant font-normal">${arrivalFormatted}</span></span>
                    </div>
                    <div class="flex items-center gap-2.5">
                      <span class="material-symbols-outlined text-primary text-[18px]">location_on</span>
                      <span class="text-on-surface-variant">${escapeHtml(ev.location || 'Campo de juego')}</span>
                    </div>
                    ${ev.notes ? `
                    <div class="flex items-center gap-2.5 text-xs text-on-surface-variant italic">
                      <span class="material-symbols-outlined text-outline text-[16px]">notes</span>
                      <span>${escapeHtml(ev.notes)}</span>
                    </div>` : ''}
                  </div>
                  ${callupSectionHtml}
                </article>
              </div>
            `;
          }).join('');

          if (typeof eventsContainer.querySelectorAll === "function") {
            eventsContainer.querySelectorAll(".btn-publish-callup-action").forEach(btn => {
              btn.addEventListener("click", () => {
                this.prepareAndPublishCallup(btn.dataset.eventId);
              });
            });
          }
        }
      }
    } catch (err) {
      if (reqGen !== this.contextGeneration) return;
      if (err?.status === 401 && err?.wasAuthenticated) {
        this.handleSessionExpired(err);
        return;
      }
      console.warn("Error syncing agenda:", err);
    }
  }

  async prepareAndPublishCallup(eventId) {
    if (this.eventsDomain) {
      return this.eventsDomain.prepareAndPublishCallup(eventId);
    }
  }

  async syncCoachRoster() {
    const reqGen = this.contextGeneration;
    const isDemo = this.appMode === "DEMO";
    const activeTeamSeasonId = isDemo ? DEMO_CONFIG.TEAM_SEASON_ID : this.beta.teamSeasonId;

    const teamTitleEl = document.getElementById("roster-team-title");
    const seasonLabelEl = document.getElementById("roster-season-label");
    const crestEl = document.getElementById("roster-team-crest");
    const headerCount = document.getElementById("roster-header-count");
    const listCount = document.getElementById("roster-list-count");
    const countAll = document.getElementById("roster-count-all");
    const countDisp = document.getElementById("roster-count-disp");
    const countCallup = document.getElementById("roster-count-callup");
    const countBaja = document.getElementById("roster-count-baja");
    const summaryText = document.getElementById("roster-summary-text");
    const statusSubtext = document.getElementById("roster-status-subtext");
    const emptyContainer = document.getElementById("roster-empty-container");
    const listContainer = document.getElementById("roster-players-list-container");
    const staffBar = document.getElementById("roster-staff-bar");

    if (isDemo) {
      if (teamTitleEl) teamTitleEl.textContent = "S. D. Indautxu · Infantil A";
      if (seasonLabelEl) seasonLabelEl.textContent = "Temporada 2026/27 · S. D. Indautxu Cantera";
      if (crestEl) crestEl.innerHTML = `<span class="tracking-tight text-sm">IN</span>`;
      if (headerCount) headerCount.textContent = "18 jugadores inscritos";
      if (listCount) listCount.textContent = "18 jugadores";
      if (countAll) countAll.textContent = "18";
      if (countDisp) countDisp.textContent = "15";
      if (countCallup) countCallup.textContent = "11";
      if (countBaja) countBaja.textContent = "1";
      if (summaryText) summaryText.textContent = "18 Jugadores · 2 Entrenadores";
      if (statusSubtext) statusSubtext.textContent = "Plantilla al día (18 jugadores)";
      if (staffBar) staffBar.classList.remove("hidden");
      if (emptyContainer) emptyContainer.classList.add("hidden");
      if (listContainer) {
        listContainer.classList.remove("hidden");
        if (this._demoRosterHtml) {
          listContainer.innerHTML = this._demoRosterHtml;
        } else {
          this._demoRosterHtml = listContainer.innerHTML;
        }
      }
      return;
    }

    // BETA_NORMAL
    if (listContainer && !this._demoRosterHtml) {
      this._demoRosterHtml = listContainer.innerHTML;
    }

    if (teamTitleEl) {
      teamTitleEl.textContent = `${this.beta.team?.name || 'Equipo'} · ${this.beta.teamSeason?.display_label || 'Categoría'}`;
    }
    if (seasonLabelEl) {
      seasonLabelEl.textContent = `Temporada ${this.beta.teamSeason?.season_label || '2026/27'}`;
    }
    if (crestEl) {
      crestEl.innerHTML = `<span class="tracking-tight text-sm">${escapeHtml((this.beta.team?.name || 'EQ').slice(0, 2).toUpperCase())}</span>`;
    }
    if (staffBar) {
      staffBar.classList.add("hidden");
    }

    if (!activeTeamSeasonId) {
      if (emptyContainer) emptyContainer.classList.remove("hidden");
      if (listContainer) listContainer.classList.add("hidden");
      if (headerCount) headerCount.textContent = "0 jugadores inscritos";
      if (listCount) listCount.textContent = "0 jugadores";
      if (countAll) countAll.textContent = "0";
      if (countDisp) countDisp.textContent = "0";
      if (countCallup) countCallup.textContent = "0";
      if (countBaja) countBaja.textContent = "0";
      return;
    }

    try {
      await this.ensureAuth("coach");
      if (reqGen !== this.contextGeneration) return;
      const playersRes = await api.teams.getPlayers(activeTeamSeasonId);
      if (reqGen !== this.contextGeneration) {
        console.warn("syncCoachRoster: Stale response discarded due to context switch.");
        return;
      }
      const players = playersRes?.items || [];
      const total = players.length;

      if (headerCount) headerCount.textContent = `${total} ${total === 1 ? 'jugador inscrito' : 'jugadores inscritos'}`;
      if (listCount) listCount.textContent = `${total} ${total === 1 ? 'jugador' : 'jugadores'}`;
      if (countAll) countAll.textContent = `${total}`;
      if (countDisp) countDisp.textContent = `${total}`;
      if (countCallup) countCallup.textContent = "0";
      if (countBaja) countBaja.textContent = "0";
      if (summaryText) summaryText.textContent = `${total} ${total === 1 ? 'Jugador' : 'Jugadores'} · Cuerpo Técnico`;
      if (statusSubtext) statusSubtext.textContent = total === 0 ? "Sin jugadores registrados" : `Plantilla al día (${total} ${total === 1 ? 'jugador' : 'jugadores'})`;

      if (total === 0) {
        if (emptyContainer) emptyContainer.classList.remove("hidden");
        if (listContainer) listContainer.classList.add("hidden");
      } else {
        if (emptyContainer) emptyContainer.classList.add("hidden");
        if (listContainer) {
          listContainer.classList.remove("hidden");
          listContainer.innerHTML = players.map(p => {
            const num = p.shirt_number !== null && p.shirt_number !== undefined ? `#${p.shirt_number}` : '-';
            const pos = p.position || 'Deportista';
            const safeName = `${escapeHtml(p.first_name)} ${escapeHtml(p.last_name)}`;
            return `
              <article class="bg-surface-container-lowest border border-outline-variant/60 rounded-xl p-3 shadow-sm flex items-center justify-between gap-3">
                <div class="flex items-center gap-3 min-w-0">
                  <div class="w-11 h-11 rounded-full bg-primary-container text-on-primary flex items-center justify-center font-bold text-sm shrink-0">
                    <span>${escapeHtml(num)}</span>
                  </div>
                  <div class="truncate">
                    <div class="flex items-center gap-1.5">
                      <span class="font-label-lg text-label-lg text-on-surface truncate font-bold">${safeName}</span>
                    </div>
                    <p class="font-body-sm text-body-sm text-outline mb-1">${escapeHtml(pos)}</p>
                    <div class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200">
                      <span class="w-1.5 h-1.5 rounded-full bg-emerald-600"></span>
                      <span class="font-label-sm text-label-sm font-bold">En regla</span>
                    </div>
                  </div>
                </div>
                <div class="flex items-center gap-1 shrink-0">
                  <button id="btn-invite-family-${escapeHtml(p.id)}" data-player-id="${escapeHtml(p.id)}" class="btn-invite-family-action px-2.5 py-1.5 rounded-lg bg-surface-container-high hover:bg-surface-container text-primary font-bold text-xs flex items-center gap-1 shadow-xs cursor-pointer">
                    <span class="material-symbols-outlined text-[16px]">share</span>
                    <span>Invitar familia</span>
                  </button>
                </div>
              </article>
            `;
          }).join('');

          if (typeof listContainer.querySelectorAll === "function") {
            const buttons = listContainer.querySelectorAll(".btn-invite-family-action");
            if (buttons && buttons.forEach) {
              buttons.forEach(btn => {
                const pId = btn.getAttribute("data-player-id") || btn.dataset?.playerId;
                const playerObj = players.find(p => String(p.id) === String(pId));
                const pName = playerObj ? `${playerObj.first_name || ''} ${playerObj.last_name || ''}`.trim() : "";
                if (btn.dataset) btn.dataset.playerName = pName;
                btn.addEventListener("click", () => {
                  this.openPlayerInviteModal(pId, pName);
                });
              });
            }
          }
        }
      }
    } catch (err) {
      if (reqGen !== this.contextGeneration) return;
      if (err?.status === 401 && err?.wasAuthenticated) {
        this.handleSessionExpired(err);
        return;
      }
      console.warn("Error syncing roster:", err);
    }
  }

  async syncNotices() {
    const isDemo = this.appMode === "DEMO";
    const teamTitle = document.getElementById("notices-team-title");
    const badgeCount = document.getElementById("notices-badge-count");
    const badgePill = document.getElementById("notices-badge-pill");
    const emptyContainer = document.getElementById("notices-empty-container");
    const feedContainer = document.getElementById("notices-feed-container");

    if (isDemo) {
      if (teamTitle) teamTitle.textContent = "S. D. Indautxu · Infantil A";
      if (badgeCount) badgeCount.textContent = "1 nuevo";
      if (badgePill) badgePill.classList.remove("hidden");
      if (emptyContainer) emptyContainer.classList.add("hidden");
      if (feedContainer) feedContainer.classList.remove("hidden");
      return;
    }

    // BETA_NORMAL: Authentically empty
    if (teamTitle) teamTitle.textContent = `${this.beta.team?.name || 'Equipo'}`;
    if (badgeCount) badgeCount.textContent = "0 avisos";
    if (badgePill) badgePill.classList.add("hidden");
    if (emptyContainer) emptyContainer.classList.remove("hidden");
    if (feedContainer) feedContainer.classList.add("hidden");
  }

  async syncEventHubNormal() {
    if (this.currentRole !== "coach") return;
    const isDemo = this.appMode === "DEMO";
    const activeTeamSeasonId = isDemo ? DEMO_CONFIG.TEAM_SEASON_ID : (this.beta?.teamSeasonId || localStorage.getItem("talde_team_season_id"));
    let eventId = isDemo ? DEMO_CONFIG.EVENT_INDAUTXU_ID : (this.beta?.activeEventId || null);

    const scope = this.createScope({ role: "coach", teamSeasonId: activeTeamSeasonId, eventId: eventId || undefined });
    await this.ensureAuth("coach");
    if (!this.isScopeActive(scope)) return;

    let activeEvent = null;

    if (activeTeamSeasonId || isDemo) {
      if (eventId) {
        const evRes = await this.safeFetch(api.events.getEvent(eventId), null, scope);
        if (!this.isScopeActive(scope)) return;
        activeEvent = (evRes && evRes.event) ? evRes.event : evRes;
      }
      if (!activeEvent && activeTeamSeasonId) {
        const eventsRes = await this.safeFetch(api.events.getEvents(activeTeamSeasonId), { items: [] }, scope);
        if (!this.isScopeActive(scope)) return;
        const events = eventsRes?.items || [];
        if (events.length > 0) {
          const hasPending = this.concurrencyTracker ? this.concurrencyTracker.hasPendingIntent("event") : false;
          const hasExplicitEvent = Boolean(this.beta?.activeEventId);
          if (!hasPending && !hasExplicitEvent && !isDemo) {
            const autoEventId = events[0].id;
            if (this.concurrencyTracker && this.contextCoordinator) {
              const token = this.concurrencyTracker.startIntent("event", autoEventId, null);
              const targetScope = this.contextCoordinator.createTargetScope(autoEventId, token);
              if (this.contextCoordinator.commitSelection(targetScope)) {
                this.beta.activeEventId = autoEventId;
                try { localStorage.setItem("talde_active_event_id", autoEventId); } catch {}
                activeEvent = events[0];
                eventId = autoEventId;
              }
            } else {
              this.beta.activeEventId = autoEventId;
              try { localStorage.setItem("talde_active_event_id", autoEventId); } catch {}
              activeEvent = events[0];
              eventId = autoEventId;
            }
          } else if (hasExplicitEvent) {
            eventId = this.beta.activeEventId;
            activeEvent = events.find(e => e.id === eventId) || null;
            if (!activeEvent && eventId) {
              const evRes = await this.safeFetch(api.events.getEvent(eventId), null, scope);
              if (!this.isScopeActive(scope)) return;
              activeEvent = (evRes && evRes.event) ? evRes.event : evRes;
            }
          }
        }
      }
    }

    if (isDemo && !eventId) eventId = DEMO_CONFIG.EVENT_INDAUTXU_ID;

    if (!eventId || !activeEvent || activeEvent.id !== eventId) {
      if (!eventId) {
        const titleEl = document.getElementById("hub-hero-title");
        if (titleEl) titleEl.textContent = "No hay eventos creados";
      }
      return;
    }

    // 1. Fetch Availability & Roster
    const availRes = await this.safeFetch(api.availability.getEventAvailability(eventId), { counts: {}, items: [] }, scope);
    if (!this.isScopeActive(scope)) return;
    this.live.availability = availRes;

    let players = [];
    if (!isDemo && activeTeamSeasonId) {
      const playersRes = await this.safeFetch(api.teams.getPlayers(activeTeamSeasonId), { items: [] }, scope);
      if (!this.isScopeActive(scope)) return;
      players = playersRes?.items || [];
    } else {
      players = (availRes?.items || []);
    }

    const totalSquad = players.length || (availRes.items || []).length || (isDemo ? 18 : 0);

    const rawCounts = availRes.counts || {};
    const canAttendCount = rawCounts.CAN_ATTEND ?? 0;
    const cannotAttendCount = rawCounts.CANNOT_ATTEND ?? 0;
    const unsureCount = rawCounts.UNSURE ?? 0;
    const noResponseCount = rawCounts.NO_RESPONSE ?? Math.max(0, totalSquad - (canAttendCount + cannotAttendCount + unsureCount));

    const pendingTotal = noResponseCount + unsureCount;

    // 2. DOM Counts & Breakdown
    const elDisp = document.getElementById("hub-count-disponibles");
    const elBajas = document.getElementById("hub-count-bajas");
    const elPend = document.getElementById("hub-count-pendientes");

    if (elDisp) elDisp.textContent = canAttendCount;
    if (elBajas) elBajas.textContent = cannotAttendCount;
    if (elPend) elPend.textContent = pendingTotal;

    const pctDisp = totalSquad > 0 ? Math.round((canAttendCount / totalSquad) * 100) : 0;
    const pctBajas = totalSquad > 0 ? Math.round((cannotAttendCount / totalSquad) * 100) : 0;
    const pctPend = totalSquad > 0 ? Math.round((pendingTotal / totalSquad) * 100) : 0;
    const pctAnswered = Math.min(100, pctDisp + pctBajas);

    const barDisp = document.getElementById("hub-bar-disponibles");
    const barBajas = document.getElementById("hub-bar-bajas");
    const barPend = document.getElementById("hub-bar-pendientes");
    const pctLabel = document.getElementById("hub-progress-pct");
    const progressHeader = document.getElementById("hub-progress-header");
    const statSi = document.getElementById("hub-stat-si");
    const statNo = document.getElementById("hub-stat-no");
    const statDuda = document.getElementById("hub-stat-duda");
    const squadChip = document.getElementById("hub-squad-chip-text");

    if (barDisp) barDisp.style.width = `${pctDisp}%`;
    if (barBajas) barBajas.style.width = `${pctBajas}%`;
    if (barPend) barPend.style.width = `${pctPend}%`;
    if (pctLabel) pctLabel.textContent = `${pctAnswered}% respondido`;
    if (progressHeader) progressHeader.textContent = `Progreso de respuestas (${totalSquad} ${totalSquad === 1 ? 'jugador' : 'jugadores'})`;
    if (statSi) statSi.textContent = `${canAttendCount} Sí (${pctDisp}%)`;
    if (statNo) statNo.textContent = `${cannotAttendCount} No (${pctBajas}%)`;
    if (statDuda) statDuda.textContent = `${pendingTotal} Espera (${pctPend}%)`;
    if (squadChip) squadChip.textContent = `Plantilla completa para el evento (${totalSquad} ${totalSquad === 1 ? 'jugador' : 'jugadores'})`;

    // 3. Hydrate Event Header & Hero Details dynamically
    if (activeEvent) {
      const headerTitle = document.getElementById("hub-header-title");
      const headerSub = document.getElementById("hub-header-subtitle");
      const heroTitle = document.getElementById("hub-hero-title");
      const heroSchedule = document.getElementById("hub-hero-schedule");
      const heroLocation = document.getElementById("hub-hero-location-name");
      const heroLocationSub = document.getElementById("hub-hero-location-sub");
      const heroBadge = document.getElementById("hub-hero-badge");
      const arrivalContainer = document.getElementById("hub-hero-arrival-container");
      const arrivalTime = document.getElementById("hub-hero-arrival-time");
      const logisticsEq = document.getElementById("hub-logistics-equipment");

      const startDate = activeEvent.starts_at ? new Date(activeEvent.starts_at) : new Date();
      const dateFormatted = startDate.toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" });
      const timeFormatted = startDate.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });

      if (headerTitle) headerTitle.textContent = activeEvent.title;
      if (headerSub) headerSub.textContent = `${dateFormatted} · ${timeFormatted} h`;
      if (heroTitle) heroTitle.textContent = activeEvent.title;
      if (heroSchedule) heroSchedule.textContent = `${dateFormatted} · ${timeFormatted} h`;
      if (heroLocation) heroLocation.textContent = activeEvent.location || "Campo de juego";
      if (heroLocationSub) heroLocationSub.textContent = activeEvent.notes || "Instalaciones del equipo";
      if (heroBadge) heroBadge.textContent = activeEvent.type === "MATCH" ? "Partido Oficial" : (activeEvent.type === "TRAINING" ? "Entrenamiento" : (activeEvent.type === "TOURNAMENT" ? "Torneo Oficial" : "Evento"));

      if (activeEvent.arrival_at) {
        const arrDate = new Date(activeEvent.arrival_at);
        const arrTimeStr = arrDate.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
        if (arrivalTime) arrivalTime.textContent = `Citación vestuario: ${arrTimeStr} h`;
        if (arrivalContainer) arrivalContainer.classList.remove("hidden");
      } else if (arrivalContainer) {
        arrivalContainer.classList.add("hidden");
      }

      if (logisticsEq) logisticsEq.textContent = activeEvent.notes || "1ª Equipación Oficial del equipo";
    }

    // 4. Hydrate Pending Names & Alerts (Dynamic from Availability API for both BETA and DEMO)
    const pendingAlertBanner = document.getElementById("hub-pending-alert-banner");
    const pendingNamesEl = document.getElementById("hub-pending-names");
    const nudgeBtn = document.getElementById("hub-btn-nudge");
    const sendNoticeBtn = document.getElementById("hub-btn-send-notice");

    const items = availRes.items || [];
    const pendingItems = items.filter(p => p.status === "NO_RESPONSE" || p.status === "UNSURE");

    if (pendingItems.length > 0) {
      const namesFormatted = pendingItems.map(p => {
        const fn = escapeHtml(p.first_name || p.firstName || '');
        const ln = escapeHtml(p.last_name || p.lastName || '');
        const sn = escapeHtml(p.shirt_number || p.shirtNumber || '-');
        return `<strong class="text-on-surface">${fn} ${ln} (#${sn})</strong>`;
      }).join(" y ");
      if (pendingNamesEl) pendingNamesEl.innerHTML = `${namesFormatted} aún no ${pendingItems.length === 1 ? 'ha' : 'han'} respondido al aviso.`;
      if (pendingAlertBanner) pendingAlertBanner.classList.remove("hidden");
    } else {
      if (pendingNamesEl) pendingNamesEl.innerHTML = `<span class="text-emerald-800 font-bold">✓ Todos los jugadores han respondido a la disponibilidad.</span>`;
      if (pendingAlertBanner) pendingAlertBanner.classList.remove("hidden");
    }

    if (!isDemo) {
      if (nudgeBtn) nudgeBtn.classList.add("hidden");
      if (sendNoticeBtn) sendNoticeBtn.classList.add("hidden");
    } else {
      if (nudgeBtn) {
        nudgeBtn.classList.remove("hidden");
        nudgeBtn.onclick = () => this.showToast("Simulación DEMO: Recordatorio enviado.");
        const textSpan = nudgeBtn.querySelector("span:last-child");
        if (textSpan) textSpan.textContent = `Recordar a pendientes (${pendingTotal})`;
      }
      if (sendNoticeBtn) {
        sendNoticeBtn.classList.remove("hidden");
        sendNoticeBtn.onclick = () => this.showToast("Simulación DEMO: Aviso a familias enviado.");
      }
    }

    // 5. Hydrate Callup Section State
    const callupBtn = document.getElementById("hub-callup-btn");
    const callupBadge = document.getElementById("hub-callup-phase-badge");
    const callupNotice = document.getElementById("hub-callup-notice");
    const callupSubtitle = document.getElementById("hub-callup-subtitle");
    const callupBtnText = document.getElementById("hub-callup-btn-text");

    let storedCallup = null;
    if (this.resourceStore && activeTeamSeasonId && eventId) {
      if (activeEvent?.callup_id) {
        storedCallup = this.resourceStore.getCallup({
          teamSeasonId: activeTeamSeasonId,
          eventId: eventId,
          callupId: activeEvent.callup_id,
          namespace: "live"
        });
      }
      if (!storedCallup && typeof this.resourceStore.getActiveCallup === "function") {
        storedCallup = this.resourceStore.getActiveCallup(activeTeamSeasonId, eventId, "live");
      }
    }
    const effectiveCallup = storedCallup;
    const isPublished = Boolean(effectiveCallup && effectiveCallup.status === "PUBLISHED");
    const callupRev = isDemo ? (this.live.callup?.current_revision_number || 1) : (effectiveCallup?.current_revision_number || effectiveCallup?.version || 1);

    if (isPublished) {
      if (callupBadge) {
        callupBadge.className = "inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-900 font-label-sm text-label-sm font-bold border border-emerald-300";
        callupBadge.innerHTML = `<span class="material-symbols-outlined text-[13px]">check_circle</span> Convocatoria Publicada (Rev. ${escapeHtml(callupRev)})`;
      }
      if (callupSubtitle) {
        callupSubtitle.textContent = `${totalSquad} ${totalSquad === 1 ? 'jugador convocado' : 'jugadores convocados'} de ${totalSquad} en plantilla`;
      }
      if (callupNotice) {
        callupNotice.innerHTML = `<p class="font-body-sm text-body-sm text-emerald-800 font-medium leading-relaxed">
          <strong class="text-emerald-900 font-bold">Convocatoria oficial cerrada y comunicada.</strong> ${totalSquad} ${totalSquad === 1 ? 'jugador convocado' : 'jugadores convocados'} para ${isDemo ? 'el Torneo Indautxu' : escapeHtml(activeEvent?.title || 'el evento')}.
        </p>`;
      }
      if (callupBtn) {
        callupBtn.className = "w-full h-[50px] bg-secondary hover:bg-emerald-700 text-white font-label-lg text-label-lg rounded-xl flex items-center justify-center gap-2 cursor-pointer shadow-sm";
        callupBtn.onclick = () => this.showToast(`✓ Convocatoria publicada (${totalSquad} ${totalSquad === 1 ? 'jugador' : 'jugadores'}).`);
        if (callupBtnText) callupBtnText.textContent = `✓ Convocatoria publicada (${totalSquad} ${totalSquad === 1 ? 'jugador' : 'jugadores'})`;
      }
    } else {
      if (callupBadge) {
        callupBadge.className = "inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-900 font-label-sm text-label-sm font-extrabold border border-amber-300";
        callupBadge.innerHTML = `<span class="material-symbols-outlined text-[13px] text-amber-700">hourglass_top</span> Convocatoria Pendiente`;
      }
      if (callupSubtitle) {
        callupSubtitle.textContent = `${totalSquad} ${totalSquad === 1 ? 'jugador disponible en plantilla' : 'jugadores disponibles en plantilla'}`;
      }
      if (callupNotice) {
        callupNotice.innerHTML = `<p class="font-body-sm text-body-sm text-on-surface-variant leading-relaxed">
          <strong class="text-on-surface font-medium">Paso 2 · Convocatoria por publicar.</strong> Podrás seleccionar los convocados y publicar la lista oficial cuando lo desees.
        </p>`;
      }
      if (callupBtn) {
        callupBtn.className = "w-full h-[50px] bg-primary-container hover:bg-primary text-on-primary font-label-lg text-label-lg rounded-xl flex items-center justify-center gap-2 cursor-pointer border border-primary/30 shadow-sm active:scale-[0.98] transition-all";
        callupBtn.onclick = () => this.handlePrepareCallup(eventId);
        if (callupBtnText) callupBtnText.textContent = `Preparar convocatoria (${totalSquad} ${totalSquad === 1 ? 'jugador' : 'jugadores'})`;
      }
    }
  }

  async handlePrepareCallup(eventId) {
    if (this.eventsDomain) {
      return this.eventsDomain.handlePrepareCallup(eventId);
    }
  }

  async syncSquadPrep() {
    if (this.eventsDomain) {
      return this.eventsDomain.syncSquadPrep();
    }
  }

  async executePublishCallupFromSquad() {
    if (this.eventsDomain) {
      return this.eventsDomain.executePublishCallupFromSquad();
    }
  }

  async handlePublishCallup(eventIdParam) {
    if (this.eventsDomain) {
      return this.eventsDomain.handlePublishCallup(eventIdParam);
    }
  }

  async syncParentHome() {
    if (this.tokens.parent || this.appMode === "DEMO") {
      this.currentRole = "parent";
    }
    let scope = this.createScope({ role: "parent" });
    if (this.appMode === "DEMO") {
      await this.ensureAuth("parent");
      if (!this.isScopeActive(scope)) return;
      try {
        const statusRes = await api.callup.getPlayerCallupStatus(DEMO_CONFIG.EVENT_INDAUTXU_ID, DEMO_CONFIG.IBAI_PLAYER_ID);
        if (!this.isScopeActive(scope)) return;
        this.live.parentCallupStatus = statusRes;

        const availRes = await api.availability.getPlayerAvailability(DEMO_CONFIG.EVENT_INDAUTXU_ID, DEMO_CONFIG.IBAI_PLAYER_ID);
        if (!this.isScopeActive(scope)) return;
        this.live.parentAvailability = availRes.current;

        const badge = document.getElementById("parent-ibai-callup-badge");
        if (badge) {
          if (availRes.current?.status === "CANNOT_ATTEND") {
            badge.className = "inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-rose-100 border border-rose-300 text-rose-900 font-label-sm text-[11px] font-extrabold";
            badge.innerHTML = `<span class="material-symbols-outlined text-[14px] text-rose-700">cancel</span><span>No asistirá (Baja comunicada)</span>`;
          } else if (statusRes.called) {
            badge.className = "inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-100 border border-emerald-300 text-emerald-900 font-label-sm text-[11px] font-extrabold";
            badge.innerHTML = `<span class="material-symbols-outlined text-[14px] text-emerald-700">check_circle</span><span>✓ Convocado al partido (Rev. ${escapeHtml(statusRes.revision || 1)})</span>`;
          } else {
            badge.className = "inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-slate-100 border border-slate-300 text-slate-700 font-label-sm text-[11px] font-bold";
            badge.innerHTML = `<span class="material-symbols-outlined text-[14px]">remove_circle_outline</span><span>No convocado</span>`;
          }
        }
      } catch (err) {
        if (!this.isScopeActive(scope)) return;
        if (err?.status === 401 && err.wasAuthenticated) {
          this.handleSessionExpired(err, scope);
          return;
        }
        console.warn("Parent home sync error:", err);
      }
      return;
    }

    // Clean BETA mode
    if (this.tokens.parent) api.client.setToken(this.tokens.parent);
    try {
      if (!this.beta.guardianPlayer || !this.beta.guardianPlayers?.length) {
        const ok = await this.loadUserContext();
        if (!ok || this.currentRole !== "parent" || !this.beta.guardianPlayer) return;
        scope = this.createScope({ role: "parent" });
      }
      const activePlayer = this.beta.guardianPlayer || (this.beta.guardianPlayers && this.beta.guardianPlayers[0]);
      const pName = activePlayer ? `${activePlayer.firstName || activePlayer.first_name} ${activePlayer.lastName || activePlayer.last_name}` : "Deportista";
      const pNum = activePlayer ? (activePlayer.shirtNumber ?? activePlayer.shirt_number ?? "-") : "-";

      const nameEl = document.getElementById("parent-home-player-name");
      if (nameEl) nameEl.textContent = pName;
      const teamEl = document.getElementById("parent-home-team-name");
      if (teamEl && this.beta.team) teamEl.textContent = `${this.beta.team.name} · ${this.beta.teamSeason?.display_label || 'Temporada'}`;
      const jerseyBadge = document.getElementById("parent-home-jersey-badge");
      if (jerseyBadge) jerseyBadge.textContent = `${pNum}`;

      const greetingEl = document.getElementById("parent-home-greeting");
      if (greetingEl) greetingEl.textContent = "Hola, Familia";

      const commitmentsTitle = document.getElementById("parent-commitments-title");
      if (commitmentsTitle) commitmentsTitle.textContent = `Próximos compromisos de ${activePlayer?.first_name || activePlayer?.firstName || 'deportista'}`;

      const childSwitcher = document.getElementById("parent-home-child-switcher");
      if (childSwitcher) {
        if (this.beta.guardianPlayers && this.beta.guardianPlayers.length > 1) {
          childSwitcher.onclick = () => this.cycleGuardianPlayer();
          childSwitcher.title = "Haz clic para cambiar de hijo/a";
        } else {
          childSwitcher.onclick = () => this.goToScreen("v2_04_player_detail", "hijos");
          childSwitcher.title = "Haz clic para ver la ficha del menor";
        }
      }

      const urgentSection = document.getElementById("parent-urgent-section");
      const commitmentsList = document.getElementById("parent-commitments-list");
      const summaryEl = document.getElementById("parent-home-pending-summary");

      if (this.beta.teamSeasonId) {
        const eventsRes = await this.safeFetch(api.events.getEvents(this.beta.teamSeasonId), { items: [] }, scope);
        if (!this.isScopeActive(scope)) {
          console.warn("syncParentHome: Stale response discarded due to context switch.");
          return;
        }
        const events = eventsRes?.items || [];

        if (events.length === 0) {
          if (urgentSection) urgentSection.classList.add("hidden");
          if (summaryEl) {
            summaryEl.innerHTML = `<span class="material-symbols-outlined text-secondary text-[18px]">check_circle</span><span>No tienes acciones pendientes para esta semana</span>`;
          }
          if (commitmentsList) {
            commitmentsList.innerHTML = `
              <div class="py-12 px-4 bg-surface-container-lowest rounded-2xl border border-dashed border-outline-variant text-center flex flex-col items-center gap-3 shadow-xs">
                <div class="w-12 h-12 rounded-full bg-surface-container flex items-center justify-center text-primary-container">
                  <span class="material-symbols-outlined text-[28px]">event_available</span>
                </div>
                <div class="space-y-1">
                  <h3 class="font-headline-sm text-headline-sm font-bold text-on-surface">Sin compromisos pendientes</h3>
                  <p class="font-body-sm text-body-sm text-on-surface-variant max-w-xs mx-auto">El cuerpo técnico aún no ha convocado o programado próximos eventos.</p>
                </div>
              </div>
            `;
          }
        } else {
          if (urgentSection) urgentSection.classList.add("hidden");
          if (commitmentsList) {
            const eventCards = await Promise.all(events.map(async ev => {
              if (!this.isScopeActive(scope)) return '';
              const d = new Date(ev.starts_at);
              const dateFormatted = d.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });
              const timeFormatted = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
              
              let callupBadge = '';
              if (ev.callup_enabled) {
                if (!ev.callup_status || ev.callup_status !== 'PUBLISHED') {
                  callupBadge = `
                    <div class="flex items-center justify-between pt-2 border-t border-outline-variant/30">
                      <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-50 border border-amber-300 text-amber-900 font-label-sm text-[11px] font-extrabold">
                        <span class="material-symbols-outlined text-[13px] text-amber-700">hourglass_top</span>
                        <span>Convocatoria pendiente</span>
                      </span>
                      <span class="text-[11px] text-on-surface-variant">Sin publicar</span>
                    </div>
                  `;
                } else {
                  try {
                    const status = await this.safeFetch(api.callup.getPlayerCallupStatus(ev.id, activePlayer.id || activePlayer.playerId), null, scope);
                    if (!this.isScopeActive(scope) || !status) return '';
                    if (status.called) {
                      callupBadge = `
                        <div class="flex items-center justify-between pt-2 border-t border-outline-variant/30">
                          <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-100 border border-emerald-300 text-emerald-900 font-label-sm text-[11px] font-extrabold">
                            <span class="material-symbols-outlined text-[13px] text-emerald-700">check_circle</span>
                            <span>✓ Convocado (Rev. ${escapeHtml(status.revision || 1)})</span>
                          </span>
                        </div>
                      `;
                    } else {
                      callupBadge = `
                        <div class="flex items-center justify-between pt-2 border-t border-outline-variant/30">
                          <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-slate-100 border border-slate-300 text-slate-700 font-label-sm text-[11px] font-bold">
                            <span class="material-symbols-outlined text-[13px] text-slate-500">remove_circle_outline</span>
                            <span>No convocado (Rev. ${escapeHtml(status.revision || 1)})</span>
                          </span>
                        </div>
                      `;
                    }
                  } catch (e) {
                    console.warn("Could not fetch child callup status:", e);
                  }
                }
              }

              return `
                <article class="bg-surface-container-lowest rounded-xl border border-outline-variant/60 p-4 shadow-sm flex flex-col gap-2.5 cursor-pointer hover:border-secondary transition-colors" onclick="teamApp.goToScreen('v2_04_player_detail', 'hijos')">
                  <div class="flex items-center justify-between">
                    <div class="flex items-center gap-1.5 font-label-sm text-label-sm font-bold text-primary">
                      <span class="material-symbols-outlined text-[16px]">today</span>
                      <span>${dateFormatted} · ${timeFormatted}</span>
                    </div>
                    <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface-container text-on-surface-variant font-label-sm text-[11px] font-bold">
                      ${escapeHtml(ev.type === 'MATCH' ? 'Partido' : (ev.type === 'TOURNAMENT' ? 'Torneo' : 'Entrenamiento'))}
                    </span>
                  </div>
                  <div class="flex flex-col">
                    <h3 class="font-headline-sm text-headline-sm text-on-surface font-bold">${escapeHtml(ev.title)}</h3>
                    <div class="flex items-center gap-1.5 text-on-surface-variant mt-1">
                      <span class="material-symbols-outlined text-[16px] text-outline">location_on</span>
                      <span class="font-body-sm text-body-sm">${escapeHtml(ev.location || 'Instalaciones del club')}</span>
                    </div>
                  </div>
                  ${callupBadge}
                </article>
              `;
            }));
            if (!this.isScopeActive(scope)) return;
            commitmentsList.innerHTML = eventCards.join('');
          }
        }
      }
    } catch (err) {
      if (!this.isScopeActive(scope)) return;
      if (err?.status === 401 && err?.wasAuthenticated) {
        this.handleSessionExpired(err);
        return;
      }
      console.warn("Parent clean home sync error:", err);
    }
  }

  cycleGuardianPlayer() {
    if (!this.beta.guardianPlayers || this.beta.guardianPlayers.length <= 1) return;
    this._explicitIntentSeq = (this._explicitIntentSeq || 0) + 1;
    const parentContainer = document.getElementById("player-detail-parent-container");
    if (parentContainer) parentContainer.innerHTML = "";
    const currentId = this.beta.guardianPlayer?.playerId || this.beta.guardianPlayer?.id;
    const currentIndex = this.beta.guardianPlayers.findIndex(p => (p.playerId || p.id) === currentId);
    const nextIndex = (currentIndex + 1) % this.beta.guardianPlayers.length;
    const nextPlayer = this.beta.guardianPlayers[nextIndex];
    this.applyContextTransition({ guardianPlayer: nextPlayer });
    this.showToast(`Cambiando vista a: ${nextPlayer.firstName || nextPlayer.first_name}`);
    this.syncCurrentScreen();
  }

  selectGuardianChild(playerId) {
    if (!this.beta.guardianPlayers?.length) return;
    const found = this.beta.guardianPlayers.find(p => (p.id || p.playerId) === playerId);
    if (found) {
      this._explicitIntentSeq = (this._explicitIntentSeq || 0) + 1;
      this.applyContextTransition({ guardianPlayer: found });
      const parentContainer = document.getElementById("player-detail-parent-container");
      if (parentContainer) parentContainer.innerHTML = "";
      this.showToast(`Mostrando ficha de: ${found.first_name || found.firstName}`);
      this.syncCurrentScreen();
    }
  }

  async syncPlayerDetail() {
    let scope = this.createScope({ role: this.currentRole });
    const isDemo = this.appMode === "DEMO";
    const demoContainer = document.getElementById("player-detail-demo-container");
    const parentContainer = document.getElementById("player-detail-parent-container");
    const coachBar = document.getElementById("player-detail-coach-bar");
    const coachActions = document.getElementById("player-detail-coach-actions");
    const backLabel = document.getElementById("player-detail-back-label");
    const categoryBadge = document.getElementById("player-detail-category-badge");

    if (this.currentRole === "coach") {
      if (backLabel) backLabel.textContent = "Plantilla";
      if (coachActions) coachActions.classList.remove("hidden");
      if (coachBar) coachBar.classList.remove("hidden");
      if (parentContainer) parentContainer.classList.add("hidden");
      if (demoContainer) demoContainer.classList.remove("hidden");
      if (categoryBadge) {
        categoryBadge.textContent = isDemo
          ? "Infantil A"
          : (this.beta.teamSeason?.display_label || this.beta.teamSeason?.category || "Equipo");
      }
      return;
    }

    // Role is PARENT / GUARDIAN: strictly clean view for GuardianLink
    if (backLabel) backLabel.textContent = "Inicio";
    if (coachActions) coachActions.classList.add("hidden");
    if (coachBar) coachBar.classList.add("hidden");
    if (demoContainer) demoContainer.classList.add("hidden");
    if (!parentContainer) return;
    parentContainer.classList.remove("hidden");

    if (isDemo) {
      if (categoryBadge) categoryBadge.textContent = "Infantil A";
      parentContainer.innerHTML = `
        <section class="bg-surface-container-lowest rounded-2xl border border-outline-variant/50 p-space-md shadow-sm relative overflow-hidden">
          <div class="absolute top-0 left-0 right-0 h-1 bg-secondary"></div>
          <div class="flex items-start gap-4">
            <div class="relative flex-shrink-0">
              <div class="w-16 h-16 rounded-full bg-surface-container-highest border-2 border-secondary flex items-center justify-center text-secondary font-headline-lg text-headline-lg font-extrabold shadow-sm">
                IA
              </div>
              <div class="absolute -bottom-1 -right-1 bg-secondary text-on-secondary font-headline-sm text-headline-sm font-black px-2 py-0.5 rounded-md border-2 border-surface-container-lowest shadow-sm">
                #9
              </div>
            </div>
            <div class="flex-1 min-w-0">
              <span class="font-label-sm text-label-sm uppercase tracking-wider font-extrabold text-secondary">S. D. Indautxu · Infantil A</span>
              <h1 class="font-headline-lg text-headline-lg font-extrabold text-on-surface truncate leading-tight mt-0.5">Ibai Aranguren</h1>
              <p class="font-label-md text-label-md font-semibold text-on-surface-variant flex items-center gap-1 mt-0.5">
                <span class="material-symbols-outlined text-[16px] text-secondary">sports_soccer</span>
                Delantero Centro
              </p>
            </div>
          </div>
        </section>
      `;
      return;
    }

    // BETA_NORMAL mode
    await this.ensureAuth("parent");
    if (!this.isScopeActive(scope)) return;
    if (!this.beta.guardianPlayer || !this.beta.guardianPlayers?.length) {
      const ok = await this.loadUserContext();
      if (!ok || this.currentRole !== "parent" || !this.beta.guardianPlayer) return;
      scope = this.createScope({ role: "parent" });
    }

    const players = this.beta.guardianPlayers || [];
    const activePlayer = this.beta.guardianPlayer || players[0];
    scope = this.createScope({
      role: "parent",
      teamSeasonId: this.beta.teamSeasonId,
      childId: activePlayer ? (activePlayer.id || activePlayer.playerId) : null
    });

    if (categoryBadge) {
      categoryBadge.textContent = this.beta.teamSeason?.display_label || this.beta.teamSeason?.category || "Equipo";
    }

    if (!activePlayer) {
      if (!this.isScopeActive(scope)) return;
      parentContainer.innerHTML = `
        <div class="p-6 bg-surface-container-lowest rounded-2xl border border-dashed border-outline-variant text-center space-y-2">
          <p class="font-label-lg font-bold text-on-surface">No hay deportista vinculado a este perfil familiar</p>
          <p class="font-body-sm text-on-surface-variant">Usa el enlace o código de invitación proporcionado por el entrenador.</p>
        </div>
      `;
      return;
    }

    const firstName = activePlayer.first_name || activePlayer.firstName || "Deportista";
    const lastName = activePlayer.last_name || activePlayer.lastName || "";
    const shirtNum = activePlayer.shirt_number ?? activePlayer.shirtNumber ?? "-";
    const position = activePlayer.position || "Deportista";
    const initials = `${firstName[0] || ''}${lastName[0] || ''}`.toUpperCase();
    const teamName = this.beta.team?.name || "Equipo";
    const seasonLabel = this.beta.teamSeason?.display_label || this.beta.teamSeason?.season_label || "Temporada";

    // Multi-child switcher HTML
    let switcherHtml = "";
    if (players.length > 1) {
      switcherHtml = `
        <div class="flex items-center gap-1.5 p-1 bg-surface-container-low rounded-xl border border-outline-variant/50">
          ${players.map(p => {
            const pId = p.id || p.playerId;
            const isSel = pId === (activePlayer.id || activePlayer.playerId);
            const pName = p.first_name || p.firstName;
            const pNum = p.shirt_number ?? p.shirtNumber ?? '-';
            return `
              <button data-child-id="${escapeHtml(pId)}" class="btn-select-guardian-child flex-1 py-1.5 px-3 rounded-lg text-xs font-bold transition-all cursor-pointer ${isSel ? 'bg-secondary text-white shadow-xs' : 'text-on-surface-variant hover:bg-surface-container'}">
                ${escapeHtml(pName)} (#${escapeHtml(pNum)})
              </button>
            `;
          }).join('')}
        </div>
      `;
    }

    // Upcoming events and callup status for this child
    let eventsHtml = "";
    try {
      if (this.beta.teamSeasonId) {
        const eventsRes = await api.events.getEvents(this.beta.teamSeasonId);
        if (!this.isScopeActive(scope)) {
          console.warn("syncPlayerDetail: Stale response discarded due to context switch.");
          return;
        }
        const events = eventsRes?.items || [];
        if (events.length > 0) {
          const cards = await Promise.all(events.map(async ev => {
            if (!this.isScopeActive(scope)) return '';
            const d = new Date(ev.starts_at);
            const dateFormatted = d.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });
            const timeFormatted = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
            let arrivalFormatted = '';
            if (ev.arrival_at) {
              const arrD = new Date(ev.arrival_at);
              arrivalFormatted = ` (Citación: ${arrD.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}h)`;
            }

            let callupBadgeHtml = "";
            let callupNoteHtml = "";

            if (ev.callup_enabled) {
              if (!ev.callup_status || ev.callup_status !== "PUBLISHED") {
                callupBadgeHtml = `
                  <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-50 border border-amber-300 text-amber-900 font-label-sm text-[11px] font-extrabold">
                    <span class="material-symbols-outlined text-[14px] text-amber-700">hourglass_top</span>
                    <span>Convocatoria pendiente</span>
                  </span>
                `;
                callupNoteHtml = `<p class="font-body-sm text-xs text-on-surface-variant mt-1.5 flex items-center gap-1">
                  <span class="material-symbols-outlined text-[14px] text-amber-600">info</span>
                  El cuerpo técnico aún no ha publicado la convocatoria oficial para este evento.
                </p>`;
              } else {
                try {
                  const status = await api.callup.getPlayerCallupStatus(ev.id, activePlayer.id || activePlayer.playerId);
                  if (!this.isScopeActive(scope)) return '';
                  if (status.called) {
                    callupBadgeHtml = `
                      <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-100 border border-emerald-300 text-emerald-900 font-label-sm text-[11px] font-extrabold">
                        <span class="material-symbols-outlined text-[14px] text-emerald-700">check_circle</span>
                        <span>✓ Convocado (Rev. ${escapeHtml(status.revision || 1)})</span>
                      </span>
                    `;
                  } else {
                    callupBadgeHtml = `
                      <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-slate-100 border border-slate-300 text-slate-700 font-label-sm text-[11px] font-bold">
                        <span class="material-symbols-outlined text-[14px] text-slate-500">remove_circle_outline</span>
                        <span>No convocado (Rev. ${escapeHtml(status.revision || 1)})</span>
                      </span>
                    `;
                  }
                } catch (e) {
                  if (e?.status === 401 && e?.wasAuthenticated && this.isScopeActive(scope)) {
                    this.handleSessionExpired(e, scope);
                    return '';
                  }
                  console.warn("Could not check child callup status:", e);
                }
              }
            }

            return `
              <div class="p-3.5 bg-surface-container-low rounded-xl border border-outline-variant/40 space-y-2">
                <div class="flex items-center justify-between">
                  <span class="font-label-sm text-label-sm font-bold text-primary flex items-center gap-1">
                    <span class="material-symbols-outlined text-[15px]">calendar_today</span>
                    ${dateFormatted} · ${timeFormatted}
                  </span>
                  <span class="px-2 py-0.5 rounded-full bg-surface-container font-label-sm text-[10px] font-bold text-on-surface-variant">
                    ${escapeHtml(ev.type === 'MATCH' ? 'Partido' : (ev.type === 'TOURNAMENT' ? 'Torneo' : 'Entrenamiento'))}
                  </span>
                </div>
                <div>
                  <h4 class="font-headline-sm text-sm font-bold text-on-surface">${escapeHtml(ev.title)}</h4>
                  <p class="font-body-sm text-xs text-on-surface-variant flex items-center gap-1 mt-0.5">
                    <span class="material-symbols-outlined text-[13px]">location_on</span>
                    ${escapeHtml(ev.location || 'Campo de juego')} ${arrivalFormatted}
                  </p>
                </div>
                ${callupBadgeHtml ? `<div class="pt-2 border-t border-outline-variant/30 flex items-center justify-between">${callupBadgeHtml}</div>` : ''}
                ${callupNoteHtml}
              </div>
            `;
          }));
          if (!this.isScopeActive(scope)) return;
          eventsHtml = cards.join('');
        }
      }
    } catch (e) {
      if (!this.isScopeActive(scope)) return;
      if (e?.status === 401 && e?.wasAuthenticated) {
        this.handleSessionExpired(e, scope);
        return;
      }
      console.warn("Error loading child events:", e);
    }

    if (!this.isScopeActive(scope)) return;
    parentContainer.innerHTML = `
      ${switcherHtml}
      <!-- Hero Card del Menor Vinculado -->
      <section class="bg-surface-container-lowest rounded-2xl border border-outline-variant/50 p-space-md shadow-sm relative overflow-hidden">
        <div class="absolute top-0 left-0 right-0 h-1 bg-secondary"></div>
        <div class="flex items-start gap-4">
          <div class="relative flex-shrink-0">
            <div class="w-16 h-16 rounded-full bg-surface-container-highest border-2 border-secondary flex items-center justify-center text-secondary font-headline-lg text-headline-lg font-extrabold shadow-sm">
              ${escapeHtml(initials)}
            </div>
            <div class="absolute -bottom-1 -right-1 bg-secondary text-on-secondary font-headline-sm text-headline-sm font-black px-2 py-0.5 rounded-md border-2 border-surface-container-lowest shadow-sm">
              #${escapeHtml(shirtNum)}
            </div>
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center justify-between">
              <span class="font-label-sm text-label-sm uppercase tracking-wider font-extrabold text-secondary">${escapeHtml(teamName)}</span>
              <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                <span class="w-1.5 h-1.5 rounded-full bg-emerald-600"></span>
                Plantilla activa
              </span>
            </div>
            <h1 class="font-headline-lg text-headline-lg font-extrabold text-on-surface truncate leading-tight mt-0.5">
              ${escapeHtml(firstName)} ${escapeHtml(lastName)}
            </h1>
            <p class="font-label-md text-label-md font-semibold text-on-surface-variant flex items-center gap-1 mt-0.5">
              <span class="material-symbols-outlined text-[16px] text-secondary">sports_soccer</span>
              ${escapeHtml(position)} · Dorsal #${escapeHtml(shirtNum)}
            </p>
          </div>
        </div>

        <!-- Metadatos Básicos -->
        <div class="grid grid-cols-2 gap-2 mt-4 pt-3 border-t border-outline-variant/30">
          <div class="bg-surface-container-low rounded-xl p-2.5 text-center border border-outline-variant/30">
            <span class="block font-label-sm text-[10px] uppercase font-bold text-on-surface-variant">Equipo</span>
            <span class="font-label-md text-label-md font-extrabold text-on-surface truncate block">${escapeHtml(teamName)}</span>
          </div>
          <div class="bg-surface-container-low rounded-xl p-2.5 text-center border border-outline-variant/30">
            <span class="block font-label-sm text-[10px] uppercase font-bold text-on-surface-variant">Temporada</span>
            <span class="font-label-md text-label-md font-extrabold text-on-surface truncate block">${escapeHtml(seasonLabel)}</span>
          </div>
        </div>
      </section>

      <!-- Próximos eventos y Convocatoria -->
      <section class="bg-surface-container-lowest rounded-2xl border border-outline-variant/50 p-space-md shadow-sm space-y-3">
        <div class="flex items-center justify-between">
          <h2 class="font-headline-sm text-headline-sm font-bold text-on-surface">Próximos eventos y convocatoria</h2>
          <span class="font-label-sm text-[11px] font-bold text-secondary bg-secondary-container/30 px-2 py-0.5 rounded-full">Oficial</span>
        </div>
        ${eventsHtml || `
          <div class="p-4 bg-surface-container-low rounded-xl text-center text-body-sm text-on-surface-variant">
            No hay eventos programados para este equipo en este momento.
          </div>
        `}
      </section>
    `;

    if (typeof parentContainer.querySelectorAll === "function") {
      parentContainer.querySelectorAll(".btn-select-guardian-child").forEach(btn => {
        btn.addEventListener("click", () => {
          this.selectGuardianChild(btn.dataset.childId);
        });
      });
    }
  }

  async syncParentRsvp() {
    const scope = this.createScope({
      role: "parent",
      teamSeasonId: this.beta?.teamSeasonId || null,
      childId: this.beta?.guardianPlayer?.id || this.beta?.guardianPlayer?.playerId || null
    });
    await this.ensureAuth("parent");
    if (!this.isScopeActive(scope)) return;

    const isDemo = this.appMode === "DEMO";
    const eventId = isDemo ? DEMO_CONFIG.EVENT_INDAUTXU_ID : (this.beta.activeEventId || localStorage.getItem("talde_active_event_id"));
    const playerId = isDemo ? DEMO_CONFIG.IBAI_PLAYER_ID : (this.beta.guardianPlayer?.id || this.beta.linkedPlayerId || localStorage.getItem("talde_linked_player_id"));

    if (!eventId || !playerId) return;

    try {
      const availRes = await api.availability.getPlayerAvailability(eventId, playerId);
      if (!this.isScopeActive(scope)) return;
      const incomingEntity = availRes?.current || availRes;
      if (this.resourceStore && incomingEntity && typeof incomingEntity === "object") {
        const teamSeasonId = this.beta?.teamSeasonId || incomingEntity.team_season_id || null;
        const key = {
          teamSeasonId,
          eventId,
          playerId,
          namespace: "live"
        };
        const rec = this.resourceStore.reconcileAvailability(key, incomingEntity);
        const stored = this.resourceStore.getAvailability(key);
        this.live.parentAvailability = stored || null;
      } else {
        this.live.parentAvailability = null;
      }
    } catch (err) {
      if (err?.status === 401 && err.wasAuthenticated && this.isScopeActive(scope)) {
        this.handleSessionExpired(err, scope);
      }
    }
  }

  selectRsvpOption(choice) {
    this.parentRsvpChoice = choice;
  }

  async saveParentRsvp() {
    if (this.familiesDomain) {
      return this.familiesDomain.saveParentRsvp();
    }
  }

  async syncEventHubInjury() {
    const reqGen = this.contextGeneration;
    try {
      await this.ensureAuth("coach");
      if (reqGen !== this.contextGeneration) return;

      const pendingData = await api.pending.getPending(DEMO_CONFIG.TEAM_SEASON_ID);
      if (reqGen !== this.contextGeneration) return;

      const bajaItem = (pendingData.actionItems || []).find(item => item.type === "CALLED_PLAYER_UNAVAILABLE" && item.status === "OPEN");
      this.live.activeActionItem = bajaItem;

      if (bajaItem) {
        const candidatesRes = await api.pending.getReplacementCandidates(bajaItem.id);
        if (reqGen !== this.contextGeneration) return;
        this.live.candidates = candidatesRes.items || [];
        this.renderCandidates(this.live.candidates);
      }
    } catch (err) {
      if (reqGen !== this.contextGeneration) return;
      if (err?.status === 401 && err.wasAuthenticated) {
        this.handleSessionExpired(err);
      }
    }
  }

  renderCandidates(candidates) {
    const container = document.getElementById("injury-candidates-container");
    if (!container || !candidates.length) return;

    container.innerHTML = "";
    candidates.forEach((c, idx) => {
      const isSelected = c.id === this.selectedCandidateId || idx === 0;
      if (isSelected && !this.selectedCandidateId) {
        this.selectedCandidateId = c.id;
        this.selectedSubstitute = `${c.first_name} ${c.last_name}`;
      }

      const initials = `${c.first_name[0] || ""}${c.last_name[0] || ""}`.toUpperCase();
      const num = c.shirt_number || (idx === 0 ? 16 : (idx === 1 ? 12 : 15));

      const card = document.createElement("div");
      card.id = `sub-cand-${c.id}`;
      card.className = isSelected
        ? "player-card relative p-3 rounded-xl border-2 border-primary-container bg-surface-container-high/40 cursor-pointer transition-all active:scale-[0.98]"
        : "player-card relative p-3 rounded-xl border border-outline-variant bg-surface-container-lowest hover:border-outline cursor-pointer transition-all active:scale-[0.98]";

      card.onclick = () => this.selectCandidate(c.id, `${c.first_name} ${c.last_name}`);

      card.innerHTML = `
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div class="relative">
              <div class="w-10 h-10 rounded-full ${isSelected ? "bg-primary-fixed text-on-primary-fixed" : "bg-surface-container-low text-on-surface-variant border border-outline-variant"} flex items-center justify-center font-bold text-[14px]">
                ${escapeHtml(initials)}
              </div>
              <span class="absolute -bottom-1 -right-1 ${isSelected ? "bg-primary text-on-primary" : "bg-surface-container-highest text-on-surface"} font-label-sm text-[10px] px-1 rounded-full font-bold">#${escapeHtml(num)}</span>
            </div>
            <div>
              <p class="font-label-lg text-label-lg text-on-surface font-bold">${escapeHtml(c.first_name)} ${escapeHtml(c.last_name)}</p>
              <p class="font-body-sm text-[12px] text-on-surface-variant">Reserva disponible · Criterio técnico</p>
            </div>
          </div>
          <div class="radio-slot ${isSelected ? "text-primary" : "text-outline"}">
            <span class="material-symbols-outlined text-[24px] ${isSelected ? "icon-filled" : ""}">
              ${isSelected ? "check_circle" : "radio_button_unchecked"}
            </span>
          </div>
        </div>
        <div class="mt-2 pt-2 border-t border-outline-variant/60 flex items-center justify-between text-secondary font-label-sm text-label-sm">
          <span class="inline-flex items-center gap-1.5 font-bold">
            <span class="w-2 h-2 rounded-full bg-secondary"></span>
            Disponible · Confirmó asistencia
          </span>
        </div>
      `;
      container.appendChild(card);
    });
  }

  selectCandidate(candidateId, name) {
    this.selectedCandidateId = candidateId;
    this.selectedSubstitute = name;
    if (this.live.candidates) {
      this.renderCandidates(this.live.candidates);
    }
    this.showToast(`Sustituta seleccionada: ${name}`);
  }

  selectReserve(name) {
    this.selectedSubstitute = name;
    if (name.includes("Ane")) this.selectedCandidateId = DEMO_CONFIG.ANE_PLAYER_ID;
    this.showToast(`Sustituta elegida: ${name}`);
  }

  async confirmSubstitution() {
    const scope = this.createScope({ role: "coach" });
    await this.ensureAuth("coach");
    if (!this.isScopeActive(scope)) return;
    if (!this.live.activeActionItem) {
      this.showToast("No hay una incidencia de baja abierta.");
      return;
    }

    const actionItemId = this.live.activeActionItem.id;
    const substituteId = this.selectedCandidateId || DEMO_CONFIG.ANE_PLAYER_ID;
    const expectedRevision = 1;

    const idemKey = idempotencyManager.getOrCreateKey(`replace-player-${actionItemId}`);

    try {
      const res = await api.pending.replacePlayer(actionItemId, {
        substitutePlayerId: substituteId,
        expectedCallupRevision: expectedRevision
      }, idemKey);
      if (!this.isScopeActive(scope)) return;

      idempotencyManager.clearKey(`replace-player-${actionItemId}`);

      const banner = document.getElementById("injury-resolved-banner");
      if (banner) banner.classList.remove("hidden");

      this.showToast(`✓ Sustitución completada en PostgreSQL: ${this.selectedSubstitute} incorporada (Revisión ${res.revisionNumber}).`);

      const viewScope = this.contextCoordinator ? this.contextCoordinator.createViewScope(this.currentScreen) : null;
      this.registerManagedTimeout(() => {
        if (!this.isScopeActive(scope)) return;
        if (this.currentRole !== "coach") return;
        if (this.currentScreen !== "v2_06_coach_substitute") return;
        if (viewScope && this.contextCoordinator && !this.contextCoordinator.isViewScopeActive(viewScope)) return;
        this.goToScreen("v2_01_coach_home", "inicio");
      }, 1500, { ...scope, role: "coach", viewId: "v2_06_coach_substitute", expectedScreen: "v2_06_coach_substitute" });
    } catch (err) {
      if (!this.isScopeActive(scope)) return;
      if (err?.status === 401 && err.wasAuthenticated) {
        this.handleSessionExpired(err, scope);
        return;
      }
      this.showToast(`Error: ${mapDomainError(err)}`);
    }
  }

  // --- Modo Beta y Escenario Demo ---

  startBetaClean() {
    this._explicitIntentSeq = (this._explicitIntentSeq || 0) + 1;
    this.tokens = { coach: null, parent: null };
    this.currentSessionId = null;
    localStorage.removeItem("talde_token_coach");
    localStorage.removeItem("talde_token_parent");
    localStorage.removeItem("talde_session_token");
    localStorage.removeItem("talde_active_session");
    localStorage.removeItem("talde_team_season_id");
    localStorage.removeItem("talde_join_code");
    localStorage.removeItem("talde_guardian_child_id");
    localStorage.removeItem("talde_linked_player_id");
    localStorage.removeItem("talde_active_event_id");
    this.setAppMode("BETA_NORMAL");
    this.applyContextTransition({
      forceTransition: true,
      appMode: "BETA_NORMAL",
      role: "onboard",
      teamSeasonId: null,
      team: null,
      teamSeason: null,
      guardianPlayers: [],
      guardianPlayer: null,
      activeEventId: null,
      bearer: null
    });
    this.goToScreen("v2_00_onboarding_welcome", "onboard");
    this.showToast("✓ Modo BETA Limpio: Configuración desde cero.");
  }

  async startDemoMode() {
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
  }

  confirmResetBeta() {
    const modal = document.getElementById("reset-beta-modal");
    if (modal) modal.classList.remove("hidden");
  }

  cancelResetBeta() {
    const modal = document.getElementById("reset-beta-modal");
    if (modal) modal.classList.add("hidden");
  }

  async executeResetBeta() {
    this.contextGeneration++;
    this.currentSessionId = null;
    this.clearAllManagedTimers();
    this.abortAllInFlight();
    api.client.setToken(null);
    try {
      const modal = document.getElementById("reset-beta-modal");
      if (modal) modal.classList.add("hidden");

      if (this.appMode === "DEMO") {
        await api.dev.resetDataset();
        this.showToast("✓ Entorno DEMO reiniciado (PostgreSQL Indautxu restaurado).");
      } else {
        await api.dev.emptyDatabase();
        this.showToast("✓ Entorno BETA vaciado completamente en PostgreSQL y navegador.");
      }

      // 2. Clear browser storage
      try {
        localStorage.clear();
        sessionStorage.clear();
      } catch (e) {
        console.warn("Storage clear exception:", e);
      }

      // 3. Clear tokens, idempotency keys, and synchronized state
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

      // 4. Hide demo UI controls
      document.getElementById("demo-mode-badge")?.classList.add("hidden");
      document.getElementById("demo-toolbar")?.classList.add("hidden");
      document.getElementById("demo-step-card")?.classList.add("hidden");

      // 5. Navigate back to clean beta entry screen
      this.goToScreen("beta_entry_screen", "onboard");
      this.updateBottomNav();
      this.updateRoleUI();
      this.updateStepUI();
    } catch (err) {
      this.showToast(`Error al reiniciar entorno beta: ${mapDomainError(err)}`);
    }
  }

  applyCleanUI() {
    // Header badge & cards
    const badgeText = document.getElementById("welcome-club-badge-text");
    if (badgeText) badgeText.textContent = "BETA · Modo Limpio";
    const demoCard = document.getElementById("welcome-demo-indicator-card");
    if (demoCard) demoCard.classList.add("hidden");

    // Coach setup screen
    const coachBadge = document.getElementById("coach-club-badge");
    if (coachBadge) coachBadge.textContent = "Nuevo equipo";
    const teamName = document.getElementById("team-name");
    if (teamName) teamName.value = "";
    const clubName = document.getElementById("club-name");
    if (clubName) clubName.value = "";
    const pitchLoc = document.getElementById("pitch-location");
    if (pitchLoc) pitchLoc.value = "";
    const coachEmail = document.getElementById("coach-email");
    if (coachEmail) coachEmail.value = "mister@beta.test";
    const coachName = document.getElementById("coach-name");
    if (coachName) coachName.value = "Mikel Entrenador";

    const bootstrapContainer = document.getElementById("coach-bootstrap-action-container");
    if (bootstrapContainer) bootstrapContainer.classList.remove("hidden");
    const bootstrapBtn = document.getElementById("coach-bootstrap-btn");
    if (bootstrapBtn) {
      bootstrapBtn.disabled = false;
      bootstrapBtn.innerHTML = `<span class="material-symbols-outlined text-[20px]" data-icon="add_circle">add_circle</span><span>Crear equipo y generar código</span>`;
    }

    const rosterBanner = document.getElementById("coach-roster-banner");
    if (rosterBanner) rosterBanner.classList.add("hidden");

    const coachNotice = document.getElementById("coach-clean-backend-notice");
    if (coachNotice) coachNotice.classList.add("hidden");

    const coachCodeSection = document.getElementById("coach-code-section");
    const rosterMgmtSection = document.getElementById("coach-roster-management-section");
    if (this.beta.teamSeasonId) {
      if (coachCodeSection) coachCodeSection.classList.remove("hidden");
      if (rosterMgmtSection) rosterMgmtSection.classList.remove("hidden");
    } else {
      if (coachCodeSection) coachCodeSection.classList.add("hidden");
      if (rosterMgmtSection) rosterMgmtSection.classList.add("hidden");
    }

    const coachReadyBadge = document.getElementById("coach-ready-badge");
    if (coachReadyBadge) coachReadyBadge.textContent = "Paso 1: Configuración inicial";
    const coachReadyTitle = document.getElementById("coach-ready-title");
    if (coachReadyTitle) coachReadyTitle.textContent = "Alta de equipo";
    const coachReadyDesc = document.getElementById("coach-ready-desc");
    if (coachReadyDesc) coachReadyDesc.textContent = "El código de invitación se generará una vez registrado el equipo en el sistema.";
    const coachCode = document.getElementById("coach-code-display");
    if (coachCode) coachCode.textContent = this.beta.joinCode || "------";
    const coachShareBtn = document.getElementById("coach-share-btn");
    if (coachShareBtn) coachShareBtn.classList.add("hidden");
    const coachFooter = document.getElementById("coach-footer-text");
    if (coachFooter) coachFooter.textContent = "Talde Hemendik! BETA • Entorno limpio";

    // Parent join screen
    const parentNotice = document.getElementById("parent-clean-backend-notice");
    if (parentNotice) parentNotice.classList.add("hidden");
    const parentCodeInput = document.getElementById("parent-join-code-input");
    if (parentCodeInput) {
      parentCodeInput.value = "";
      parentCodeInput.readOnly = false;
      parentCodeInput.placeholder = "CÓDIGO DE EQUIPO (EJ: BARA12)";
    }
    const parentCodeBadge = document.getElementById("parent-code-valid-badge");
    if (parentCodeBadge) parentCodeBadge.classList.add("hidden");
    const parentTeamCard = document.getElementById("parent-located-team-card");
    if (parentTeamCard) parentTeamCard.classList.add("hidden");
    const parentPlayerSec = document.getElementById("parent-player-select-section");
    if (parentPlayerSec) parentPlayerSec.classList.add("hidden");
    const parentClaimSec = document.getElementById("parent-claim-player-section");
    if (parentClaimSec) parentClaimSec.classList.add("hidden");

    const tutorName = document.getElementById("tutor-name");
    if (tutorName) tutorName.value = "";
    const tutorEmail = document.getElementById("tutor-email");
    if (tutorEmail) tutorEmail.value = "tutor@beta.test";
    const tutorPhone = document.getElementById("tutor-phone");
    if (tutorPhone) tutorPhone.value = "";

    const parentValDesc = document.getElementById("parent-validation-desc");
    if (parentValDesc) parentValDesc.innerHTML = "Por protección y privacidad del menor, el cuerpo técnico del equipo validará esta solicitud antes de conceder acceso a los avisos y eventos.";
    const parentProtocol = document.getElementById("parent-footer-protocol");
    if (parentProtocol) parentProtocol.textContent = "Protocolo oficial de cantera";
  }

  applyDemoUI() {
    // Header badge & cards
    const badgeText = document.getElementById("welcome-club-badge-text");
    if (badgeText) badgeText.textContent = "S. D. Indautxu · Infantil A";
    const demoCard = document.getElementById("welcome-demo-indicator-card");
    if (demoCard) demoCard.classList.remove("hidden");

    // Coach setup screen
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

    // Parent join screen
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
  }

  // --- Reset y Pruebas de Conflicto en Vivo ---

  async resetBackendDataset(silent = false) {
    try {
      await api.dev.resetDataset();
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
  }

  async triggerTestConflictVersion() {
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
  }

  async triggerTestConflictSubstitute() {
    const scope = this.createScope({ role: "coach" });
    await this.ensureAuth("coach");
    if (!this.isScopeActive(scope)) return;
    try {
      if (!this.live.activeActionItem) {
        this.showToast("Primero debes registrar la baja de Ibai para que haya una incidencia abierta.");
        return;
      }
      this.showToast("⚡ Intentando sustituir con suplente no elegible...");
      // Intentar reemplazar con jugador no disponible (Olatz Bengoa CANNOT_ATTEND)
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
  }

  nudgePending() {
    this.showToast("🔔 Recordatorio enviado a familias sin respuesta vía backend.");
  }

  async finishCoachSetup() {
    const scope = this.createScope({ role: "coach" });
    if (this.appMode === "DEMO") {
      await this.switchMembership("indautxu_inf_a");
      if (!this.isScopeActive(scope)) return;
      await this.goToScreen("v2_01_coach_home", "inicio");
      this.showToast("✓ Equipo S. D. Indautxu · Infantil A creado con éxito. Código INDA16.");
      return;
    }

    this.currentRole = "coach";
    if (!this.isScopeActive(scope)) return;
    await this.goToScreen("v2_01_coach_home", "inicio");
    this.showToast(`✓ Mesa del entrenador activada para ${this.beta.team?.name || 'tu equipo'}.`);
  }

  shareInviteCode() {
    const code = this.appMode === "DEMO" ? "INDA16" : (this.beta.joinCode || "INDA16");
    const inviteLink = `${window.location.origin}/?join=${code}`;
    if (navigator.clipboard) navigator.clipboard.writeText(inviteLink).catch(() => {});
    this.showToast(`📲 Enlace de invitación copiado: Código ${code}.`);
  }

  copyInviteCode() {
    const code = this.appMode === "DEMO" ? "INDA16" : (this.beta.joinCode || "INDA16");
    if (navigator.clipboard) navigator.clipboard.writeText(code).catch(() => {});
    this.showToast(`Código ${code} copiado al portapapeles.`);
  }

  copyText(text) {
    if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {});
    this.showToast("Copiado al portapapeles.");
  }

  // --- VS03: Clean Beta Methods ---

  async submitCoachBootstrap() {
    const teamNameInput = document.getElementById("team-name")?.value?.trim();
    const clubNameInput = document.getElementById("club-name")?.value?.trim();
    const coachEmail = document.getElementById("coach-email")?.value?.trim() || "coach@beta.test";
    const coachName = document.getElementById("coach-name")?.value?.trim() || "Entrenador Beta";
    const categorySelect = document.querySelector("#v2_00_coach_create_team select");
    const category = categorySelect?.value?.split("(")[0]?.trim() || "Infantil";

    if (!teamNameInput && !clubNameInput) {
      this.showToast("⚠️ Introduce al menos el nombre del equipo o club.");
      return;
    }

    if (!coachEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(coachEmail)) {
      this.showToast("⚠️ Introduce un correo electrónico de entrenador válido.");
      return;
    }

    const teamName = clubNameInput || teamNameInput;
    const displayLabel = teamNameInput || "Infantil A";

    // If coach already has an active session token, proceed directly
    const currentToken = this.tokens.coach || localStorage.getItem("talde_session_token");
    if (currentToken) {
      api.client.setToken(currentToken);
      await this.executeCoachBootstrap({ teamName, displayLabel, category, coachEmail, coachName });
      return;
    }

    // Otherwise, initiate real OTP authentication
    this.openOtpModal({
      email: coachEmail,
      displayName: coachName,
      role: "coach",
      onSuccess: async () => {
        await this.executeCoachBootstrap({ teamName, displayLabel, category, coachEmail, coachName });
      }
    });
  }

  async executeCoachBootstrap({ teamName, displayLabel, category, coachEmail, coachName }) {
    const scope = this.createScope();
    const btn = document.getElementById("coach-bootstrap-btn");
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<span class="material-symbols-outlined text-[20px] animate-spin">progress_activity</span><span>Creando equipo en PostgreSQL...</span>`;
    }

    try {
      this.beta.coachName = coachName;

      // 2. Client Idempotency-Key
      const idemKey = idempotencyManager.getOrCreateKey(`bootstrap-${coachEmail}-${teamName}-${displayLabel}`);

      // Verify scope before dispatching remote write
      if (!this.isScopeActive(scope)) return;

      // 3. POST /v1/teams/bootstrap
      const res = await api.teams.bootstrap({
        team: { name: teamName, sport: "FOOTBALL" },
        teamSeason: {
          seasonLabel: "2026/27",
          category: category,
          displayLabel: displayLabel
        },
        createGeneralJoinCode: true
      }, idemKey);

      if (!this.isScopeActive(scope)) {
        console.warn("executeCoachBootstrap: Stale bootstrap discarded due to context switch.");
        return;
      }

      this.applyContextTransition({
        role: "coach",
        teamSeasonId: res.teamSeason.id,
        team: res.team,
        teamSeason: res.teamSeason,
        joinCode: res.joinCode
      }, scope);

      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `<span class="material-symbols-outlined text-[20px]" data-icon="check_circle">check_circle</span><span>Equipo creado correctamente</span>`;
      }

      // Update UI displays
      const codeDisplay = document.getElementById("coach-code-display");
      if (codeDisplay) codeDisplay.textContent = res.joinCode || "------";

      const codeSection = document.getElementById("coach-code-section");
      if (codeSection) codeSection.classList.remove("hidden");

      const rosterSection = document.getElementById("coach-roster-management-section");
      if (rosterSection) rosterSection.classList.remove("hidden");

      const readyBadge = document.getElementById("coach-ready-badge");
      if (readyBadge) readyBadge.textContent = "✓ ¡Equipo creado en PostgreSQL!";

      const readyTitle = document.getElementById("coach-ready-title");
      if (readyTitle) readyTitle.textContent = `${res.team.name} · ${res.teamSeason.display_label || res.teamSeason.displayLabel}`;

      const readyDesc = document.getElementById("coach-ready-desc");
      if (readyDesc) readyDesc.textContent = `Código general de unión: ${res.joinCode}. Añade deportistas abajo para generar invitaciones individuales.`;

      this.showToast(`✓ Equipo ${res.team.name} registrado con éxito (Código: ${res.joinCode}).`);
      this.renderBetaPlayersList();
    } catch (err) {
      if (!this.isScopeActive(scope)) return;
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `<span class="material-symbols-outlined text-[20px]" data-icon="add_circle">add_circle</span><span>Crear equipo y generar código</span>`;
      }
      console.error("Bootstrap error:", err);
      if (err?.status === 401 && err.wasAuthenticated) {
        this.handleSessionExpired(err);
        return;
      }
      this.showToast(`Error al crear equipo: ${mapDomainError(err)}`);
    }
  }

  async submitAddPlayer() {
    const scope = this.createScope();
    if (!this.beta.teamSeasonId) {
      this.showToast("Primero debes crear el equipo para poder añadir jugadores.");
      return;
    }
    const firstName = document.getElementById("player-firstname")?.value?.trim();
    const lastName = document.getElementById("player-lastname")?.value?.trim();
    const shirtNumberVal = document.getElementById("player-number")?.value;
    const shirtNumber = shirtNumberVal ? parseInt(shirtNumberVal, 10) : undefined;
    const position = document.getElementById("player-position")?.value?.trim() || undefined;

    if (!firstName || !lastName) {
      this.showToast("El nombre y los apellidos del jugador son obligatorios.");
      return;
    }

    const idemKey = idempotencyManager.getOrCreateKey(`add-player-${this.beta.teamSeasonId}-${firstName}-${lastName}`);

    try {
      if (!this.isScopeActive(scope)) return;
      const res = await api.teams.addPlayer(this.beta.teamSeasonId, {
        firstName,
        lastName,
        shortName: firstName,
        shirtNumber,
        position
      }, idemKey);

      if (!this.isScopeActive(scope)) return;

      this.beta.players.push({
        id: res.player.id,
        player: res.player,
        rosterEntry: res.rosterEntry,
        firstName: res.player.first_name,
        lastName: res.player.last_name,
        shirtNumber: res.rosterEntry.shirt_number,
        position: res.rosterEntry.position
      });
      localStorage.setItem("talde_players", JSON.stringify(this.beta.players));

      this.renderBetaPlayersList();
      this.showToast(`✓ Jugador ${res.player.first_name} ${res.player.last_name} añadido a la plantilla.`);

      const fnInput = document.getElementById("player-firstname");
      const lnInput = document.getElementById("player-lastname");
      if (fnInput) fnInput.value = "";
      if (lnInput) lnInput.value = "";
    } catch (err) {
      if (!this.isScopeActive(scope)) return;
      console.error("Add player error:", err);
      if (err?.status === 401 && err.wasAuthenticated) {
        this.handleSessionExpired(err);
        return;
      }
      this.showToast(`Error al añadir jugador: ${mapDomainError(err)}`);
    }
  }

  // --- Modales y acciones de Roster (Equipo -> Añadir & Invitar familia) ---
  openAddPlayerModal() {
    const fn = document.getElementById("modal-player-firstname");
    const ln = document.getElementById("modal-player-lastname");
    const num = document.getElementById("modal-player-number");
    const pos = document.getElementById("modal-player-position");
    if (fn) fn.value = "";
    if (ln) ln.value = "";
    if (num) num.value = "";
    if (pos) pos.value = "";
    const modal = document.getElementById("modal-add-player");
    if (modal) modal.classList.remove("hidden");
    if (fn) fn.focus();
  }

  closeAddPlayerModal() {
    const modal = document.getElementById("modal-add-player");
    if (modal) modal.classList.add("hidden");
  }

  async saveNewPlayerFromRoster() {
    const scope = this.createScope();
    if (!this.beta.teamSeasonId) {
      this.showToast("⚠️ No hay temporada activa para añadir jugadores.");
      return;
    }
    const firstName = document.getElementById("modal-player-firstname")?.value?.trim();
    const lastName = document.getElementById("modal-player-lastname")?.value?.trim();
    const numVal = document.getElementById("modal-player-number")?.value;
    const shirtNumber = numVal ? parseInt(numVal, 10) : undefined;
    const position = document.getElementById("modal-player-position")?.value?.trim() || "Deportista";

    if (!firstName || !lastName) {
      this.showToast("⚠️ Introduce al menos el nombre y apellidos del deportista.");
      return;
    }

    const saveBtn = document.getElementById("modal-btn-save-player");
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.innerHTML = `<span class="material-symbols-outlined text-[16px] animate-spin">progress_activity</span><span>Guardando...</span>`;
    }

    const idemKey = idempotencyManager.getOrCreateKey(`add-player-${this.beta.teamSeasonId}-${firstName}-${lastName}-${Date.now()}`);

    try {
      await this.ensureAuth("coach");
      if (!this.isScopeActive(scope)) return;
      await api.teams.addPlayer(this.beta.teamSeasonId, {
        firstName,
        lastName,
        shortName: firstName,
        shirtNumber,
        position
      }, idemKey);

      if (!this.isScopeActive(scope)) return;
      this.closeAddPlayerModal();
      this.showToast(`✓ ${firstName} ${lastName} añadido a la plantilla.`);

      // Refrescar lista de jugadores y UI de roster
      if (!this.isScopeActive(scope)) return;
      const playersRes = await api.teams.getPlayers(this.beta.teamSeasonId);
      if (!this.isScopeActive(scope)) return;
      this.beta.players = (playersRes?.items || []).map(p => ({
        id: p.id,
        firstName: p.first_name,
        lastName: p.last_name,
        shirtNumber: p.shirt_number,
        position: p.position
      }));
      await this.syncCoachRoster();
    } catch (err) {
      if (!this.isScopeActive(scope)) return;
      console.error("Error adding player from roster:", err);
      if (err?.status === 401 && err.wasAuthenticated) {
        this.handleSessionExpired(err);
        return;
      }
      this.showToast(`Error al añadir deportista: ${mapDomainError(err)}`);
    } finally {
      if (this.isScopeActive(scope) && saveBtn) {
        saveBtn.disabled = false;
        saveBtn.innerHTML = `<span class="material-symbols-outlined text-[16px]">save</span><span>Guardar deportista</span>`;
      }
    }
  }

  async openPlayerInviteModal(playerId, playerName = "") {
    const scope = this.createScope({ role: "coach", teamSeasonId: this.beta?.teamSeasonId });
    if (!this.beta.teamSeasonId) return;
    try {
      await this.ensureAuth("coach");
      if (!this.isScopeActive(scope)) return;
      const res = await api.teams.createPlayerInvitation(this.beta.teamSeasonId, playerId);
      if (!this.isScopeActive(scope)) return;
      this.beta.lastInvitation = res;

      const origin = window.location.origin || "http://127.0.0.1:8000";
      const inviteUrl = `${origin}/?inviteToken=${res.token}`;
      this.beta.lastGeneratedInviteUrl = inviteUrl;

      const modal = document.getElementById("modal-player-invite");
      const titleEl = document.getElementById("modal-invite-title");
      const linkInput = document.getElementById("modal-invite-link-input");
      const copyText = document.getElementById("modal-copy-link-text");

      if (titleEl) titleEl.textContent = playerName ? `Invitar familia: ${playerName}` : "Invitar familia";
      if (linkInput) linkInput.value = inviteUrl;
      if (copyText) copyText.textContent = "Copiar enlace";
      if (modal) modal.classList.remove("hidden");

      this.showToast("✓ Invitación individual generada.");
    } catch (err) {
      if (!this.isScopeActive(scope)) return;
      console.error("Invite generation error:", err);
      if (err?.status === 401 && err.wasAuthenticated) {
        this.handleSessionExpired(err);
        return;
      }
      this.showToast(`Error al generar invitación: ${mapDomainError(err)}`);
    }
  }

  closePlayerInviteModal() {
    const modal = document.getElementById("modal-player-invite");
    if (modal) modal.classList.add("hidden");
  }

  copyInviteLinkFromModal() {
    if (!this.beta.lastGeneratedInviteUrl) return;
    this.copyText(this.beta.lastGeneratedInviteUrl);
    const copyText = document.getElementById("modal-copy-link-text");
    if (copyText) copyText.textContent = "¡Copiado!";
    this.showToast("✓ Enlace de invitación individual copiado al portapapeles.");
  }

  openInviteLinkFromModal() {
    if (!this.beta.lastGeneratedInviteUrl) return;
    this.closePlayerInviteModal();
    window.location.href = this.beta.lastGeneratedInviteUrl;
  }

  async generatePlayerInvite(playerId) {
    return this.openPlayerInviteModal(playerId);
  }

  renderBetaPlayersList() {
    const container = document.getElementById("coach-beta-players-list");
    const countBadge = document.getElementById("coach-beta-roster-count");
    if (countBadge) countBadge.textContent = `${this.beta.players.length} inscrito${this.beta.players.length === 1 ? '' : 's'}`;
    if (!container) return;

    if (!this.beta.players.length) {
      container.innerHTML = `<p class="text-xs text-slate-500 italic p-2 bg-slate-50 rounded-lg text-center">No hay deportistas dados de alta todavía en esta temporada.</p>`;
      return;
    }

    container.innerHTML = this.beta.players.map(p => {
      const fullName = `${p.firstName || ''} ${p.lastName || ''}`.trim();
      const safeName = escapeHtml(fullName);
      const safeId = escapeHtml(p.id);
      return `
        <div class="p-3 bg-surface-container-lowest rounded-xl border border-outline-variant shadow-xs flex flex-col gap-2">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2.5">
              <span class="w-8 h-8 rounded-full bg-primary-fixed text-primary font-bold text-xs flex items-center justify-center">#${escapeHtml(p.shirtNumber || '-')}</span>
              <div>
                <p class="font-bold text-xs text-on-surface">${safeName}</p>
                <p class="text-[11px] text-on-surface-variant">${escapeHtml(p.position || 'Deportista')} · Activo</p>
              </div>
            </div>
            <button id="btn-invite-${safeId}" class="btn-invite-player px-2.5 py-1 rounded-lg bg-primary-container hover:bg-primary text-on-primary font-bold text-[11px] shadow-xs cursor-pointer flex items-center gap-1" data-player-id="${safeId}" data-player-name="${safeName}">
              <span class="material-symbols-outlined text-[14px]">share</span>
              <span>Invitar familia</span>
            </button>
          </div>
        </div>
      `;
    }).join("");

    container.querySelectorAll(".btn-invite-player").forEach(btn => {
      btn.addEventListener("click", () => {
        const pid = btn.getAttribute("data-player-id");
        const pname = btn.getAttribute("data-player-name") || "";
        this.openPlayerInviteModal(pid, pname);
      });
    });
  }

  // --- Separación de Flujos de Vinculación de Tutor ---

  async setupIndividualInvite(token) {
    const scope = this.createScope();
    if (this.currentRole === "parent" && (this.beta.guardianPlayers || []).length > 0) {
      this.cleanInviteTokenFromUrl();
      this.goToScreen("v2_07_parent_home", "inicio");
      return;
    }

    this.beta.individualInviteToken = token;
    this.beta.joinFlowType = "INDIVIDUAL";

    const banner = document.getElementById("parent-individual-invite-banner");
    const generalSection = document.getElementById("parent-general-code-section");
    const claimSection = document.getElementById("parent-claim-player-section");
    const noticeClean = document.getElementById("parent-clean-backend-notice");

    if (generalSection) generalSection.classList.add("hidden");
    if (claimSection) claimSection.classList.add("hidden");

    try {
      const res = await api.invitations.getInvitation(token);
      if (!this.isScopeActive(scope)) {
        console.warn("setupIndividualInvite: Stale response discarded due to context switch.");
        return;
      }
      this.beta.verifiedInvitation = { type: "INDIVIDUAL", token: token, data: res };

      if (banner) {
        banner.classList.remove("hidden");
        const titleEl = document.getElementById("parent-individual-team-title");
        const subEl = document.getElementById("parent-individual-team-sub");
        const crestEl = document.getElementById("parent-individual-team-crest");
        if (titleEl) titleEl.textContent = `${res.team.name} · ${res.teamSeason.displayLabel}`;
        if (subEl) subEl.textContent = `Temporada ${res.teamSeason.seasonLabel} · Invitación Individual`;
        if (crestEl) crestEl.textContent = (res.team.name || 'TH').slice(0, 2).toUpperCase();
      }

      if (noticeClean) {
        noticeClean.classList.remove("hidden");
        noticeClean.innerHTML = `
          <div class="flex items-center gap-2 font-bold text-xs uppercase tracking-wide text-emerald-800">
            <span class="material-symbols-outlined text-[18px] text-emerald-600">shield</span>
            <span>Invitación individual verificada (Sin filtración de datos)</span>
          </div>
          <p class="text-xs text-emerald-900 mt-1">
            Equipo localizado: <strong>${escapeHtml(res.team.name)}</strong> (${escapeHtml(res.teamSeason.displayLabel)}). La privacidad del menor está protegida; los datos de la ficha se activarán cuando el entrenador apruebe la vinculación.
          </p>
        `;
      }
      this.showToast(`✓ Invitación individual válida para ${res.team.name}.`);
    } catch (err) {
      if (!this.isScopeActive(scope)) return;
      this.beta.verifiedInvitation = null;
      console.error("Error verifying individual invitation:", err);
      this.showToast(`⚠️ ${mapDomainError(err)}`);
    }
  }

  async verifyGeneralJoinCode() {
    const scope = this.createScope();
    this.beta.joinFlowType = "GENERAL";
    this.beta.individualInviteToken = null;

    const rawInput = document.getElementById("parent-join-code-input")?.value?.trim();
    if (!rawInput) {
      this.showToast("Introduce el código de equipo.");
      return;
    }

    const code = rawInput.toUpperCase();
    const teamCard = document.getElementById("parent-located-team-card");
    const teamTitle = document.getElementById("parent-located-team-title");
    const teamSub = document.getElementById("parent-located-team-subtitle");
    const claimSection = document.getElementById("parent-claim-player-section");
    const validBadge = document.getElementById("parent-code-valid-badge");
    const noticeClean = document.getElementById("parent-clean-backend-notice");
    const banner = document.getElementById("parent-individual-invite-banner");

    if (banner) banner.classList.add("hidden");

    try {
      const res = await api.invitations.getTeamJoinInfo(code);
      if (!this.isScopeActive(scope)) return;
      this.beta.verifiedInvitation = { type: "GENERAL", code: code, data: res };

      if (teamTitle) teamTitle.textContent = `${res.team.name} · ${res.teamSeason.displayLabel}`;
      if (teamSub) teamSub.textContent = `${res.team.sport || 'Deporte'} · Temporada ${res.teamSeason.seasonLabel} · Código General`;
      if (teamCard) teamCard.classList.remove("hidden");
      if (validBadge) validBadge.classList.remove("hidden");
      if (claimSection) claimSection.classList.remove("hidden");
      if (noticeClean) {
        noticeClean.classList.remove("hidden");
        noticeClean.innerHTML = `
          <div class="flex items-center gap-2 font-bold text-xs uppercase tracking-wide text-blue-800">
            <span class="material-symbols-outlined text-[18px] text-blue-600">info</span>
            <span>Código de equipo verificado</span>
          </div>
          <p class="text-xs text-blue-900 mt-1">
            Equipo localizado: <strong>${escapeHtml(res.team.name)}</strong>. Introduce abajo el nombre de tu hijo/a para que el entrenador valide su asignación en la plantilla.
          </p>
        `;
      }
      this.showToast(`✓ Código de equipo válido: ${res.team.name}.`);
    } catch (err) {
      if (!this.isScopeActive(scope)) return;
      this.beta.verifiedInvitation = null;
      console.error("General join code error:", err);
      this.showToast(`⚠️ ${mapDomainError(err)}`);
      if (validBadge) validBadge.classList.add("hidden");
      if (teamCard) teamCard.classList.add("hidden");
      if (claimSection) claimSection.classList.add("hidden");
    }
  }

  async verifyParentJoinInput() {
    return this.verifyGeneralJoinCode();
  }

  async submitParentJoinRequest() {
    if (this.appMode === "DEMO") {
      const btn = document.getElementById("btn-submit");
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<span class="material-symbols-outlined text-[20px] animate-spin">progress_activity</span><span>Enviando al entrenador...</span>`;
      }
      const scope = this.createScope();
      this.registerManagedTimeout(async () => {
        if (!this.isScopeActive(scope)) return;
        await this.switchMembership("indautxu_ale_b");
        if (!this.isScopeActive(scope)) return;
        await this.goToScreen("v2_07_parent_home", "inicio");
        this.showToast("✓ Solicitud de vinculación registrada para Ibai #9.");
        if (btn && this.isScopeActive(scope)) {
          btn.disabled = false;
          btn.innerHTML = `<span>Enviar solicitud de vinculación</span><span class="material-symbols-outlined text-[20px]" data-icon="send">send</span>`;
        }
      }, 600, scope);
      return;
    }

    const tutorName = document.getElementById("tutor-name")?.value?.trim() || "Tutor Familia";
    const tutorEmail = document.getElementById("tutor-email")?.value?.trim() || "tutor@beta.test";

    if (!tutorEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(tutorEmail)) {
      this.showToast("⚠️ Introduce un correo electrónico de tutor válido.");
      return;
    }

    const isIndividual = this.beta.joinFlowType === "INDIVIDUAL" || this.beta.verifiedInvitation?.type === "INDIVIDUAL";

    if (!isIndividual && !this.beta.verifiedInvitation) {
      await this.verifyGeneralJoinCode();
      if (!this.beta.verifiedInvitation) return;
    }

    const claimName = document.getElementById("parent-claim-name")?.value?.trim();
    const claimNumberVal = document.getElementById("parent-claim-number")?.value;
    const claimNumber = claimNumberVal ? parseInt(claimNumberVal, 10) : undefined;

    if (!isIndividual && !claimName) {
      this.showToast("⚠️ Para unirte con código general debes indicar el nombre del menor.");
      return;
    }

    // If tutor already has an active session token, proceed directly
    const currentToken = this.tokens.parent || localStorage.getItem("talde_session_token");
    if (currentToken) {
      api.client.setToken(currentToken);
      await this.executeParentJoin({ tutorEmail, tutorName, isIndividual, claimName, claimNumber });
      return;
    }

    // Otherwise, initiate real OTP authentication
    this.openOtpModal({
      email: tutorEmail,
      displayName: tutorName,
      role: "parent",
      onSuccess: async () => {
        await this.executeParentJoin({ tutorEmail, tutorName, isIndividual, claimName, claimNumber });
      }
    });
  }

  async executeParentJoin({ tutorEmail, tutorName, isIndividual, claimName, claimNumber }) {
    const scope = this.createScope();
    const btn = document.getElementById("btn-submit");
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<span class="material-symbols-outlined text-[20px] animate-spin">progress_activity</span><span>Enviando solicitud al entrenador...</span>`;
    }

    try {
      let res;
      if (isIndividual) {
        const token = this.beta.individualInviteToken || this.beta.verifiedInvitation?.token;
        if (!token) {
          throw new Error("Falta el token de invitación individual.");
        }
        if (!this.isScopeActive(scope)) return;
        res = await api.invitations.requestIndividualLink(token);
        if (!this.isScopeActive(scope)) {
          console.warn("executeParentJoin: Stale individual link response discarded due to context switch.");
          return;
        }
        if (res?.player_id) {
          this.beta.linkedPlayerId = res.player_id;
          localStorage.setItem("talde_linked_player_id", res.player_id);
        }
      } else {
        if (!this.isScopeActive(scope)) return;
        res = await api.invitations.requestGeneralLink(this.beta.verifiedInvitation.code, {
          claimedPlayerName: claimName,
          claimedShirtNumber: claimNumber
        });
        if (!this.isScopeActive(scope)) {
          console.warn("executeParentJoin: Stale general link response discarded due to context switch.");
          return;
        }
      }

      this.showToast(`✓ Solicitud enviada (ID: ${res.id.slice(0, 8)}...). Pendiente de validación por el entrenador.`);

      const notice = document.getElementById("parent-clean-backend-notice");
      if (notice) {
        notice.classList.remove("hidden");
        notice.innerHTML = `
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2 font-bold text-xs uppercase tracking-wide text-amber-800">
              <span class="material-symbols-outlined text-[18px] text-amber-600">hourglass_top</span>
              <span>Solicitud enviada al cuerpo técnico</span>
            </div>
            <button id="btn-check-pending-status" onclick="teamApp.checkParentApprovalStatus()" class="px-2.5 py-1 bg-amber-200 hover:bg-amber-300 text-amber-950 font-bold text-xs rounded-lg border border-amber-400 cursor-pointer flex items-center gap-1 shadow-xs transition-all" type="button">
              <span class="material-symbols-outlined text-[14px]">refresh</span>
              <span>Comprobar estado</span>
            </button>
          </div>
          <p class="text-xs text-amber-900 mt-1">
            Tu solicitud está <strong>PENDIENTE DE APROBACIÓN</strong>. Una vez que el entrenador confirme la vinculación, podrás acceder a la ficha y actividades del deportista.
          </p>
        `;
      }
    } catch (err) {
      if (!this.isScopeActive(scope)) return;
      console.error("Parent join error:", err);
      if (err?.status === 401 && err.wasAuthenticated) {
        this.handleSessionExpired(err);
        return;
      }
      this.showToast(`Error al enviar solicitud: ${mapDomainError(err)}`);
    } finally {
      if (this.isScopeActive(scope) && btn) {
        btn.disabled = false;
        btn.innerHTML = `<span>Solicitud registrada (Pendiente de aprobación)</span>`;
      }
    }
  }

  async approveBetaGuardianRequest(requestId, selectElementId) {
    const scope = this.createScope();
    let playerId = null;
    if (selectElementId) {
      const sel = document.getElementById(selectElementId);
      playerId = sel?.value;
      if (!playerId) {
        this.showToast("Selecciona un jugador del roster para vincular.");
        return;
      }
    }

    try {
      // CRITICAL: Guarantee coach session token is active before calling coach endpoint
      if (this.tokens.coach) {
        api.client.setToken(this.tokens.coach);
      } else {
        const coachTok = localStorage.getItem("talde_token_coach");
        if (coachTok) {
          this.tokens.coach = coachTok;
          api.client.setToken(coachTok);
        }
      }

      if (!this.isScopeActive(scope)) return;
      const res = await api.teams.approveGuardianRequest(requestId, playerId);
      if (!this.isScopeActive(scope)) {
        console.warn("approveBetaGuardianRequest: Stale approval response discarded due to context switch.");
        return;
      }
      this.showToast("✓ Solicitud de vinculación aprobada en PostgreSQL.");

      const successBadge = document.getElementById("coach-approval-success-badge");
      if (successBadge) successBadge.classList.remove("hidden");

      const linkedCount = document.getElementById("coach-linked-count");
      if (linkedCount) {
        const current = parseInt(linkedCount.textContent || "0", 10);
        linkedCount.textContent = current + 1;
      }

      await this.syncCoachHome();
    } catch (err) {
      if (!this.isScopeActive(scope)) return;
      console.error("Approve error:", err);
      if (err?.status === 401 && err.wasAuthenticated) {
        this.handleSessionExpired(err);
        return;
      }
      this.showToast(`Error al aprobar: ${mapDomainError(err)}`);
    }
  }

  async rejectBetaGuardianRequest(requestId) {
    const scope = this.createScope();
    try {
      // CRITICAL: Guarantee coach session token is active before calling coach endpoint
      if (this.tokens.coach) {
        api.client.setToken(this.tokens.coach);
      } else {
        const coachTok = localStorage.getItem("talde_token_coach");
        if (coachTok) {
          this.tokens.coach = coachTok;
          api.client.setToken(coachTok);
        }
      }

      if (!this.isScopeActive(scope)) return;
      await api.teams.rejectGuardianRequest(requestId);
      if (!this.isScopeActive(scope)) {
        console.warn("rejectBetaGuardianRequest: Stale rejection response discarded due to context switch.");
        return;
      }
      this.showToast("Solicitud rechazada en PostgreSQL.");
      await this.syncCoachHome();
    } catch (err) {
      if (!this.isScopeActive(scope)) return;
      console.error("Reject error:", err);
      if (err?.status === 401 && err.wasAuthenticated) {
        this.handleSessionExpired(err);
        return;
      }
      this.showToast(`Error al rechazar: ${mapDomainError(err)}`);
    }
  }

  approveGuardianRequest() {
    this.isElenaApproved = true;
    const reqCard = document.getElementById("coach-pending-approval-card");
    const successBadge = document.getElementById("coach-approval-success-badge");
    if (reqCard) reqCard.classList.add("hidden");
    if (successBadge) successBadge.classList.remove("hidden");
    this.showToast("✓ Vinculación aprobada: Elena Gómez vinculada a Ibai Aranguren (#9).");
  }

  rejectGuardianRequest() {
    const reqCard = document.getElementById("coach-pending-approval-card");
    if (reqCard) reqCard.classList.add("hidden");
    this.showToast("Solicitud rechazada.");
  }

  dismissOnboardingBanner() {
    const banner = document.getElementById("coach-onboarding-banner");
    if (banner) {
      banner.classList.add("hidden");
      this.showToast("✓ Puesta en marcha ocultada. Mostrando La Mesa del Entrenador.");
    }
  }

  showPlayerModal(playerId) {
    const player = SQUAD_DATA.find(p => p.id === playerId);
    if (!player) return;
    if (player.id === 9) {
      this.goToScreen("v2_04_player_detail", "equipo");
      return;
    }
    const modal = document.getElementById("player-detail-sheet");
    if (modal) {
      document.getElementById("sheet-player-num").textContent = `#${player.number}`;
      document.getElementById("sheet-player-name").textContent = player.name;
      document.getElementById("sheet-player-role").textContent = `${player.role} · S. D. Indautxu Infantil A`;
      document.getElementById("sheet-player-status").textContent = player.rsvp;
      document.getElementById("sheet-tutor-name").textContent = player.tutor;
      document.getElementById("sheet-tutor-phone").textContent = player.phone;
      modal.classList.remove("hidden");
    }
  }

  closePlayerModal() {
    const modal = document.getElementById("player-detail-sheet");
    if (modal) modal.classList.add("hidden");
  }

  filterRoster(type) {
    const rows = document.querySelectorAll(".roster-player-row");
    rows.forEach(r => {
      if (type === "all") r.classList.remove("hidden");
      else if (type === "disponibles") r.classList.toggle("hidden", r.dataset.status === "baja");
      else if (type === "convocados") r.classList.toggle("hidden", r.dataset.convocado !== "true");
      else if (type === "bajas") r.classList.toggle("hidden", r.dataset.status !== "baja");
    });
    this.showToast(`Filtro aplicado: ${type.toUpperCase()}`);
  }

  resetDemo() {
    this.currentStepIndex = 0;
    this.switchMembership("onboard");
    this.applyCurrentStep();
    this.showToast("Demo reiniciada al inicio de Onboarding.");
  }

  showToast(message) {
    const toast = document.getElementById("demo-toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.remove("opacity-0", "pointer-events-none", "translate-y-2");
    toast.classList.add("opacity-100", "translate-y-0");

    if (this._toastTimer) clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      toast.classList.remove("opacity-100", "translate-y-0");
      toast.classList.add("opacity-0", "pointer-events-none", "translate-y-2");
    }, 3500);
  }
}

// Global instance attached to window
const teamApp = new TeamAppState();
window.teamApp = teamApp;
window.api = api;
teamApp.api = api;
window.handleVinculacion = () => teamApp.submitParentJoinRequest();

document.addEventListener("DOMContentLoaded", () => {
  teamApp.init();
});
