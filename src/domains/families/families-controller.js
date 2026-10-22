/**
 * Talde Hemendik! — Families Domain Controller (REV-02)
 * Gestiona vinculación familiar, respuestas RSVP y autorizaciones parentales.
 */

import { api, DEMO_CONFIG, mapDomainError, idempotencyManager } from "../../api/index.js";

export class FamiliesDomainController {
  constructor(app) {
    this.app = app;
  }

  get coordinator() {
    return this.app.contextCoordinator;
  }

  get store() {
    return this.app.resourceStore;
  }

  async saveParentRsvp() {
    const isDemo = this.app.appMode === "DEMO";
    const eventId = isDemo ? DEMO_CONFIG.EVENT_INDAUTXU_ID : this.app.beta?.activeEventId;
    const playerId = isDemo ? DEMO_CONFIG.IBAI_PLAYER_ID : (this.app.beta?.guardianPlayer?.id || this.app.beta?.guardianPlayer?.playerId || this.app.beta?.linkedPlayerId);
    const teamSeasonId = this.app.beta?.teamSeasonId;
    const expectedVersion = Number(this.app.live?.parentAvailability?.version ?? 0);
    const status = this.app.parentRsvpChoice === "NO" ? "CANNOT_ATTEND" : (this.app.parentRsvpChoice === "SI" ? "CAN_ATTEND" : "UNSURE");

    if (!eventId || !playerId) return;

    const opContext = { eventId, playerId, teamSeasonId, expectedVersion, status };
    const viewScope = this.coordinator ? this.coordinator.createViewScope(this.app.currentScreen, { eventId }) : null;
    const preSessionId = this.coordinator ? this.coordinator._getCurrentSessionId() : this.app.currentSessionId;
    const preRole = this.app.currentRole;
    const preMode = this.app.appMode;
    const preGeneration = this.app.contextGeneration;
    const preTeam = this.app.beta?.teamSeasonId;

    await this.app.ensureAuth("parent");

    if (this.app.currentRole !== preRole || this.app.currentRole !== "parent") return;
    if (this.app.appMode !== preMode) return;
    if (this.app.contextGeneration !== preGeneration) return;
    if (this.app.beta?.teamSeasonId !== preTeam) return;
    const currentSession = this.coordinator ? this.coordinator._getCurrentSessionId() : this.app.currentSessionId;
    if (preSessionId && currentSession && preSessionId !== currentSession) return;

    const dispatchScope = this.coordinator ? this.coordinator.createDispatchScope({ role: "parent", teamSeasonId, childId: playerId, eventId }) : null;
    const scope = this.app.createScope({ role: "parent", teamSeasonId, childId: playerId, eventId });

    if (this.app.beta.teamSeasonId !== opContext.teamSeasonId || (this.app.beta.guardianPlayer && (this.app.beta.guardianPlayer.id || this.app.beta.guardianPlayer.playerId) !== opContext.playerId)) {
      return;
    }

    try {
      const idemKey = idempotencyManager.getOrCreateKey(`parent-rsvp-${opContext.eventId}`);

      const res = await api.availability.setGuardianAvailability(
        opContext.eventId,
        opContext.playerId,
        { status: opContext.status, expectedVersion: opContext.expectedVersion },
        idemKey
      );

      idempotencyManager.clearKey(`parent-rsvp-${opContext.eventId}`);

      // 1. RECONCILIACIÓN POR RECURSO Y VERSIÓN (D12-F05, F01, F02, F08)
      const hasVersionProp = res && Object.prototype.hasOwnProperty.call(res, "version");
      let confirmedVersion;
      if (hasVersionProp) {
        if (typeof res.version === "number" && Number.isInteger(res.version)) {
          confirmedVersion = res.version;
        } else {
          confirmedVersion = res.version;
        }
      } else {
        confirmedVersion = null; // Versión no confirmada no se fabrica
      }
      const availEntity = (res && typeof res === "object") ? {
        event_id: opContext.eventId,
        player_id: opContext.playerId,
        team_season_id: opContext.teamSeasonId,
        ...res,
        version: confirmedVersion
      } : {
        event_id: opContext.eventId,
        player_id: opContext.playerId,
        team_season_id: opContext.teamSeasonId,
        status: opContext.status,
        version: confirmedVersion
      };

      const currentSession = this.coordinator ? this.coordinator._getCurrentSessionId() : this.app.currentSessionId;
      const currentTeam = this.coordinator ? this.coordinator._getCurrentTeamSeasonId() : this.app.beta?.teamSeasonId;
      const isSessionValid = Boolean(scope.sessionId && scope.sessionId === currentSession);
      const isTeamValid = Boolean(opContext.teamSeasonId && opContext.teamSeasonId === currentTeam);
      const isModeValid = this.app.appMode === "BETA_NORMAL";
      const isReconcileAllowed = this.coordinator && typeof this.coordinator.isWriteReconciliationAllowed === "function"
        ? this.coordinator.isWriteReconciliationAllowed(dispatchScope)
        : (isSessionValid && isTeamValid && isModeValid);

      let reconcileResult = { applied: false };
      if (isReconcileAllowed && this.store) {
        reconcileResult = this.store.reconcileAvailability({
          teamSeasonId: opContext.teamSeasonId,
          eventId: opContext.eventId,
          playerId: opContext.playerId,
          namespace: "live"
        }, availEntity);
      }

      // Si el almacén rechazó la entidad (por identidad o versión inválida), no proyectar al singleton activo (F02, F08)
      if (!reconcileResult.applied && reconcileResult.reason !== "idempotent" && reconcileResult.reason !== "stale_version" && this.store) {
        return;
      }

      // Actualizar autoridad local parentAvailability sólo si el contexto activo coincide unívocamente (F02)
      const isCurrentActiveEvent = (this.coordinator ? this.coordinator._getCurrentActiveEventId() : this.app.beta?.activeEventId) === opContext.eventId;
      const currentChild = this.app.beta?.guardianPlayer?.id || this.app.beta?.guardianPlayer?.playerId || this.app.beta?.linkedPlayerId || (isDemo ? DEMO_CONFIG.IBAI_PLAYER_ID : null);
      const isCurrentActiveChild = currentChild === opContext.playerId;

      if (isReconcileAllowed && isCurrentActiveEvent && isCurrentActiveChild) {
        this.app.live.parentAvailability = this.store ? (this.store.getAvailability({
          teamSeasonId: opContext.teamSeasonId,
          eventId: opContext.eventId,
          playerId: opContext.playerId,
          namespace: "live"
        }) || availEntity) : availEntity;
      }

      // 2. PUERTA VISUAL (D12-F05 / F06 / parent-view-only)
      const isViewStillActive = viewScope && this.coordinator ? this.coordinator.isViewScopeActive(viewScope) : true;
      if (isViewStillActive && this.app.isScopeActive(scope) && isCurrentActiveEvent && isCurrentActiveChild) {
        this.app.showToast(opContext.status === "CANNOT_ATTEND"
          ? "✓ Disponibilidad guardada en PostgreSQL: NO asistirá (Baja registrada)."
          : "✓ Disponibilidad guardada con éxito.");

        this.app.registerManagedTimeout(() => {
          if (!this.app.isScopeActive(scope)) return;
          if (viewScope && this.coordinator && !this.coordinator.isViewScopeActive(viewScope)) return;
          if (this.app.currentRole !== "parent") return;
          if (this.app.currentScreen !== "v2_08_parent_rsvp") return;
          if (this.app.beta?.activeEventId !== opContext.eventId) return;
          const liveChild = this.app.beta?.guardianPlayer?.id || this.app.beta?.guardianPlayer?.playerId || this.app.beta?.linkedPlayerId;
          if (liveChild && liveChild !== opContext.playerId) return;
          this.app.goToScreen("v2_07_parent_home", "inicio");
        }, 1000, scope);
      }
    } catch (err) {
      if (err?.status === 401 && err.wasAuthenticated) {
        this.app.handleSessionExpired(err, scope);
        return;
      }
      if (!this.app.isScopeActive(scope)) return;
      this.app.showToast(`Error al guardar: ${mapDomainError(err)}`);
    }
  }
}
