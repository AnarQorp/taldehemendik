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
    const scope = this.app.createScope({ role: "parent", teamSeasonId, childId: playerId });
    const viewScope = this.coordinator ? this.coordinator.createViewScope(this.app.currentScreen, { eventId }) : null;

    await this.app.ensureAuth("parent");
    if (!this.app.isScopeActive(scope)) return;

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

      // 1. RECONCILIACIÓN INCONDICIONAL POR RECURSO Y VERSIÓN (D12-F05)
      const confirmedVersion = Number(res?.version ?? (expectedVersion + 1));
      const availEntity = (res && typeof res === "object") ? { ...res, version: confirmedVersion } : {
        event_id: opContext.eventId,
        player_id: opContext.playerId,
        status: opContext.status,
        version: confirmedVersion
      };

      if (this.store) {
        this.store.reconcileAvailability({
          teamSeasonId: opContext.teamSeasonId,
          eventId: opContext.eventId,
          playerId: opContext.playerId,
          namespace: "live"
        }, availEntity);
      }

      // Actualizar autoridad local parentAvailability
      this.app.live.parentAvailability = availEntity;

      // 2. PUERTA VISUAL (D12-F05 / parent-view-only)
      const isViewStillActive = viewScope && this.coordinator ? this.coordinator.isViewScopeActive(viewScope) : true;
      if (isViewStillActive && this.app.isScopeActive(scope)) {
        this.app.showToast(opContext.status === "CANNOT_ATTEND"
          ? "✓ Disponibilidad guardada en PostgreSQL: NO asistirá (Baja registrada)."
          : "✓ Disponibilidad guardada con éxito.");

        this.app.registerManagedTimeout(() => {
          if (!this.app.isScopeActive(scope)) return;
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
