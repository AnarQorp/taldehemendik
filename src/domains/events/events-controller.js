/**
 * Talde Hemendik! — Events & Callups Domain Controller (REV-02)
 * Gestiona ciclo de vida de eventos, preparación y publicación de convocatorias,
 * y sustituciones conforme a las cuatro puertas de autoridad.
 */

import { api, DEMO_CONFIG, mapDomainError } from "../../api/index.js";

export class EventsDomainController {
  constructor(app) {
    this.app = app;
  }

  get coordinator() {
    return this.app.contextCoordinator;
  }

  get tracker() {
    return this.app.concurrencyTracker;
  }

  get store() {
    return this.app.resourceStore;
  }

  async handlePrepareCallup(eventId) {
    if (this.app.currentRole !== "coach") return;
    const isDemo = this.app.appMode === "DEMO";
    const targetEventId = eventId || this.app.beta?.activeEventId || (isDemo ? DEMO_CONFIG.EVENT_INDAUTXU_ID : null);
    const activeTeamSeasonId = this.app.beta?.teamSeasonId || (isDemo ? DEMO_CONFIG.TEAM_SEASON_ID : null);
    if (!targetEventId || !activeTeamSeasonId) return;

    let token = null;
    let targetScope = null;
    if (this.tracker && this.coordinator) {
      token = this.tracker.startIntent("event", targetEventId, this.app.beta?.activeEventId);
      targetScope = this.coordinator.createTargetScope(targetEventId, token);
    }
    const dispatchScope = this.coordinator ? this.coordinator.createDispatchScope({ role: "coach", eventId: targetEventId, intentToken: token }) : null;
    const scope = this.app.createScope({ role: "coach", teamSeasonId: activeTeamSeasonId });
    await this.app.ensureAuth("coach");
    if (!this.app.isScopeActive(scope)) {
      if (token && this.tracker) this.tracker.discardIntent(token);
      return;
    }

    try {
      if (targetEventId && targetEventId !== this.app.beta?.activeEventId) {
        const evRes = await api.events.getEvent(targetEventId);
        if (!this.app.isScopeActive(scope)) {
          if (token && this.tracker) this.tracker.discardIntent(token);
          return;
        }
        const ev = (evRes && evRes.event) ? evRes.event : evRes;
        const isKnownErrorStatus = ev && (ev.status === "CANCELLED" || ev.status === "COMPLETED" || ev.status === "INACTIVE");
        const isExplicitlyDisabled = ev && ev.callup_enabled === false;
        const isCrossTeam = ev && ev.team_season_id && activeTeamSeasonId && ev.team_season_id !== activeTeamSeasonId;
        const isEmptyObject = ev && typeof ev === "object" && Object.keys(ev).length === 0;
        if (!ev || isEmptyObject || isKnownErrorStatus || isExplicitlyDisabled || isCrossTeam) {
          throw new Error("Evento no disponible para convocatoria");
        }
      }

      if (targetScope && this.coordinator) {
        const committed = this.coordinator.commitSelection(targetScope);
        if (!committed) {
          return;
        }
      }

      this.app.beta.activeEventId = targetEventId;
      try { localStorage.setItem("talde_active_event_id", targetEventId); } catch {}

      if (this.app.appMode === "DEMO") {
        await this.handlePublishCallup();
      } else {
        await this.app.goToScreen("screen_e_create_squad", "agenda");
      }
    } catch (err) {
      if (token && this.tracker) this.tracker.discardIntent(token);
      if (err?.status === 401 && err.wasAuthenticated) {
        this.app.handleSessionExpired(err, dispatchScope || scope);
        return;
      }
      if (!this.app.isScopeActive(scope)) return;
      console.error("Error preparing callup:", err);
      this.app.showToast(`Error al preparar convocatoria: ${err.message || 'Error en backend'}`);
    }
  }

  async prepareAndPublishCallup(eventId) {
    if (this.app.currentRole !== "coach") return;
    const isDemo = this.app.appMode === "DEMO";
    const targetEventId = eventId || this.app.beta?.activeEventId || (isDemo ? DEMO_CONFIG.EVENT_INDAUTXU_ID : null);
    const activeTeamSeasonId = this.app.beta?.teamSeasonId || (isDemo ? DEMO_CONFIG.TEAM_SEASON_ID : null);
    if (!targetEventId || !activeTeamSeasonId) return;

    // Registro inmediato de intención antes de cualquier await (D12-F01 & D12-F04)
    let token = null;
    let targetScope = null;
    if (this.tracker && this.coordinator) {
      token = this.tracker.startIntent("event", targetEventId, this.app.beta?.activeEventId);
      targetScope = this.coordinator.createTargetScope(targetEventId, token);
    }
    const dispatchScope = this.coordinator ? this.coordinator.createDispatchScope({ role: "coach", eventId: targetEventId, intentToken: token }) : null;
    const scope = this.app.createScope({
      role: "coach",
      teamSeasonId: activeTeamSeasonId
    });
    const viewScope = this.coordinator ? this.coordinator.createViewScope(this.app.currentScreen, { eventId: targetEventId }) : null;

    await this.app.ensureAuth("coach");
    if (token && this.tracker && !this.tracker.isCurrent(token)) return;
    if (!this.app.isScopeActive(scope)) return;

    try {
      const playersRes = await api.teams.getPlayers(activeTeamSeasonId);
      if (token && this.tracker && !this.tracker.isCurrent(token)) return;
      if (!this.app.isScopeActive(scope)) return;
      const players = playersRes.items || [];
      if (players.length === 0) {
        this.app.showToast("⚠️ La plantilla no tiene jugadores para convocar.");
        return;
      }
      const playerIds = players.map(p => p.id);

      let draft;
      try {
        if (token && this.tracker && !this.tracker.isCurrent(token)) return;
        draft = await api.callup.createDraft(targetEventId, playerIds);
      } catch (err) {
        if (err?.status === 401 && err.wasAuthenticated) {
          this.app.handleSessionExpired(err, dispatchScope || scope);
          return;
        }
        if (token && this.tracker && !this.tracker.isCurrent(token)) return;
        if (!this.app.isScopeActive(scope)) return;
        if (err?.status === 409 && (err?.code === "LINK_REQUEST_ALREADY_EXISTS" || err?.code === "DRAFT_ALREADY_EXISTS")) {
          const evRes = await api.events.getEvent(targetEventId);
          if (token && this.tracker && !this.tracker.isCurrent(token)) return;
          if (!this.app.isScopeActive(scope)) return;
          const ev = (evRes && evRes.event) ? evRes.event : evRes;
          if (
            !ev ||
            ev.id !== targetEventId ||
            ev.status !== "ACTIVE" ||
            ev.team_season_id !== activeTeamSeasonId ||
            !ev.callup_id
          ) {
            throw err;
          }
          const existingCallup = await api.callup.getCallup(ev.callup_id);
          if (token && this.tracker && !this.tracker.isCurrent(token)) return;
          if (!this.app.isScopeActive(scope)) return;
          if (
            !existingCallup ||
            existingCallup.id !== ev.callup_id ||
            existingCallup.status !== "DRAFT" ||
            existingCallup.event_id !== targetEventId ||
            existingCallup.team_season_id !== activeTeamSeasonId ||
            !Number.isInteger(existingCallup.version) ||
            existingCallup.version < 1
          ) {
            throw err;
          }
          draft = await api.callup.updateDraft(ev.callup_id, {
            playerIds,
            expectedVersion: existingCallup.version
          });
        } else {
          throw err;
        }
      }

      if (token && this.tracker && !this.tracker.isCurrent(token)) return;
      if (!this.app.isScopeActive(scope)) return;
      if (!draft || !draft.id) throw new Error("No se pudo obtener el borrador de convocatoria.");

      const confirmKeys = (draft.warnings || []).map(w => w.key);

      const published = await api.callup.publishCallup(
        draft.id,
        { expectedVersion: draft.version ?? 1, confirmWarnings: confirmKeys },
        `pub-${Date.now()}`
      );

      const callupEntity = (published && published.id) ? published : {
        ...draft,
        status: "PUBLISHED",
        version: (draft.version || 1) + 1
      };

      // 1. Reconciliación incondicional en ResourceStore (D12-F03)
      if (this.store && callupEntity && callupEntity.id) {
        this.store.reconcileCallup({
          teamSeasonId: activeTeamSeasonId,
          eventId: targetEventId,
          callupId: draft.id,
          namespace: "live"
        }, callupEntity);
      }

      // 2. Puerta de selección y proyección visual (D12-F01)
      let committed = false;
      if (targetScope && this.coordinator) {
        committed = this.coordinator.commitSelection(targetScope);
      } else {
        committed = true;
      }

      if (committed) {
        this.app.beta.activeEventId = targetEventId;
        try { localStorage.setItem("talde_active_event_id", targetEventId); } catch {}
        this.app.live.callup = (this.store ? this.store.getCallup({
          teamSeasonId: activeTeamSeasonId,
          eventId: targetEventId,
          callupId: draft.id,
          namespace: "live"
        }) : null) || callupEntity;

        const isViewActive = viewScope && this.coordinator ? this.coordinator.isViewScopeActive(viewScope) : true;
        if (isViewActive) {
          this.app.showToast(`✓ Convocatoria publicada (${playerIds.length} jugadores convocados).`);
          await this.app.syncCurrentScreen();
        }
      }
    } catch (err) {
      if (err?.status === 401 && err.wasAuthenticated) {
        this.app.handleSessionExpired(err, dispatchScope || scope);
        return;
      }
      if (token && this.tracker && !this.tracker.isCurrent(token)) return;
      if (!this.app.isScopeActive(scope)) return;
      console.error("Error publicando convocatoria:", err);
      this.app.showToast(`Error al publicar convocatoria: ${err.message || 'Error en backend'}`);
    }
  }

  async executePublishCallupFromSquad() {
    if (this.app.currentRole !== "coach") return;
    const isDemo = this.app.appMode === "DEMO";
    const targetEventId = isDemo ? DEMO_CONFIG.EVENT_INDAUTXU_ID : this.app.beta?.activeEventId;
    const activeTeamSeasonId = isDemo ? DEMO_CONFIG.TEAM_SEASON_ID : this.app.beta?.teamSeasonId;
    if (!targetEventId || !activeTeamSeasonId) return;

    // Registro inmediato de intención
    let token = null;
    let targetScope = null;
    if (this.tracker && this.coordinator) {
      token = this.tracker.startIntent("event", targetEventId, this.app.beta?.activeEventId);
      targetScope = this.coordinator.createTargetScope(targetEventId, token);
    }
    const dispatchScope = this.coordinator ? this.coordinator.createDispatchScope({ role: "coach", eventId: targetEventId, intentToken: token }) : null;
    const scope = this.app.createScope({ role: "coach", teamSeasonId: activeTeamSeasonId });
    const viewScope = this.coordinator ? this.coordinator.createViewScope(this.app.currentScreen, { eventId: targetEventId }) : null;

    await this.app.ensureAuth("coach");
    if (token && this.tracker && !this.tracker.isCurrent(token)) return;
    if (!this.app.isScopeActive(scope)) return;

    try {
      const playersRes = await api.teams.getPlayers(activeTeamSeasonId);
      if (token && this.tracker && !this.tracker.isCurrent(token)) return;
      if (!this.app.isScopeActive(scope)) return;
      const players = playersRes.items || [];
      if (players.length === 0) {
        this.app.showToast("⚠️ La plantilla no tiene jugadores para convocar.");
        return;
      }

      const availRes = await api.availability.getEventAvailability(targetEventId);
      if (token && this.tracker && !this.tracker.isCurrent(token)) return;
      if (!this.app.isScopeActive(scope)) return;
      const availItems = availRes.items || [];

      const cannotAttendIds = new Set(availItems.filter(a => a.status === "CANNOT_ATTEND").map(a => a.player_id));
      const selectedPlayerIds = players.filter(p => !cannotAttendIds.has(p.id)).map(p => p.id);

      if (selectedPlayerIds.length === 0) {
        this.app.showToast("⚠️ Todos los jugadores están dados de baja.");
        return;
      }

      let draft;
      try {
        if (token && this.tracker && !this.tracker.isCurrent(token)) return;
        draft = await api.callup.createDraft(targetEventId, selectedPlayerIds);
      } catch (err) {
        if (err?.status === 401 && err.wasAuthenticated) {
          this.app.handleSessionExpired(err, dispatchScope || scope);
          return;
        }
        if (token && this.tracker && !this.tracker.isCurrent(token)) return;
        if (!this.app.isScopeActive(scope)) return;
        if (err?.status === 409 && (err?.code === "LINK_REQUEST_ALREADY_EXISTS" || err?.code === "DRAFT_ALREADY_EXISTS")) {
          const evRes = await api.events.getEvent(targetEventId);
          if (token && this.tracker && !this.tracker.isCurrent(token)) return;
          if (!this.app.isScopeActive(scope)) return;
          const ev = (evRes && evRes.event) ? evRes.event : evRes;
          if (
            !ev ||
            ev.id !== targetEventId ||
            ev.status !== "ACTIVE" ||
            ev.team_season_id !== activeTeamSeasonId ||
            !ev.callup_id
          ) {
            throw err;
          }
          const existingCallup = await api.callup.getCallup(ev.callup_id);
          if (token && this.tracker && !this.tracker.isCurrent(token)) return;
          if (!this.app.isScopeActive(scope)) return;
          if (
            !existingCallup ||
            existingCallup.id !== ev.callup_id ||
            existingCallup.status !== "DRAFT" ||
            existingCallup.event_id !== targetEventId ||
            existingCallup.team_season_id !== activeTeamSeasonId ||
            !Number.isInteger(existingCallup.version) ||
            existingCallup.version < 1
          ) {
            throw err;
          }
          draft = await api.callup.updateDraft(ev.callup_id, {
            playerIds: selectedPlayerIds,
            expectedVersion: existingCallup.version
          });
        } else {
          throw err;
        }
      }

      if (token && this.tracker && !this.tracker.isCurrent(token)) return;
      if (!this.app.isScopeActive(scope)) return;
      const callupId = draft?.id;
      if (!callupId) {
        console.warn("No verified draft available for publication");
        return;
      }
      const expectedVersion = draft ? draft.version : 1;
      const confirmWarnings = (draft?.warnings || []).map(w => w.key);

      const idemKey = `pub-squad-${callupId}-${Date.now()}`;
      const published = await api.callup.publishCallup(callupId, {
        expectedVersion,
        confirmWarnings
      }, idemKey);

      const callupEntity = (published && published.id) ? published : {
        ...draft,
        status: "PUBLISHED",
        version: (draft.version || 1) + 1
      };

      // 1. Reconciliación incondicional en ResourceStore (D12-F03)
      if (this.store && callupEntity && callupEntity.id) {
        this.store.reconcileCallup({
          teamSeasonId: activeTeamSeasonId,
          eventId: targetEventId,
          callupId: callupId,
          namespace: "live"
        }, callupEntity);
      }

      // 2. Puerta de selección y proyección visual
      let committed = false;
      if (targetScope && this.coordinator) {
        committed = this.coordinator.commitSelection(targetScope);
      } else {
        committed = true;
      }

      if (committed) {
        this.app.beta.activeEventId = targetEventId;
        try { localStorage.setItem("talde_active_event_id", targetEventId); } catch {}
        this.app.live.callup = (this.store ? this.store.getCallup({
          teamSeasonId: activeTeamSeasonId,
          eventId: targetEventId,
          callupId: callupId,
          namespace: "live"
        }) : null) || callupEntity;

        const isViewActive = viewScope && this.coordinator ? this.coordinator.isViewScopeActive(viewScope) : true;
        if (isViewActive) {
          this.app.showToast(`✓ Convocatoria publicada (${selectedPlayerIds.length} ${selectedPlayerIds.length === 1 ? 'jugador convocado' : 'jugadores convocados'}).`);
          await this.app.goToScreen("v2_05_event_hub_normal", "agenda");
        }
      }
    } catch (err) {
      if (err?.status === 401 && err.wasAuthenticated) {
        this.app.handleSessionExpired(err, dispatchScope || scope);
        return;
      }
      if (token && this.tracker && !this.tracker.isCurrent(token)) return;
      if (!this.app.isScopeActive(scope)) return;
      console.error("Error al publicar convocatoria desde plantilla:", err);
      this.app.showToast(`Error publicando convocatoria: ${mapDomainError(err)}`);
    }
  }

  async handlePublishCallup(eventIdParam) {
    return this.prepareAndPublishCallup(eventIdParam);
  }

  async syncSquadPrep() {
    const eventId = this.app.beta?.activeEventId;
    const activeTeamSeasonId = this.app.beta?.teamSeasonId;
    if (!eventId || !activeTeamSeasonId) return;

    const viewScope = this.coordinator ? this.coordinator.createViewScope("screen_e_create_squad", {
      eventId,
      eventEpoch: this.coordinator.confirmedContext.eventEpoch
    }) : null;

    const scope = this.app.createScope({ role: "coach", teamSeasonId: activeTeamSeasonId, eventId });
    await this.app.ensureAuth("coach");
    if (!this.app.isScopeActive(scope)) return;

    const [playersRes, availRes, evRes] = await Promise.all([
      this.app.safeFetch(api.teams.getPlayers(activeTeamSeasonId), { items: [] }, scope),
      this.app.safeFetch(api.availability.getEventAvailability(eventId), { counts: {}, items: [] }, scope),
      this.app.safeFetch(api.events.getEvent(eventId), null, scope)
    ]);
    if (!this.app.isScopeActive(scope)) return;

    if (viewScope && this.coordinator) {
      if (!this.coordinator.isViewScopeActive(viewScope) || (this.app.beta?.activeEventId && this.app.beta.activeEventId !== eventId)) {
        return;
      }
    } else if (this.app.beta?.activeEventId && this.app.beta.activeEventId !== eventId) {
      return;
    }

    const players = playersRes.items || [];
    const event = (evRes && evRes.event) ? evRes.event : evRes;

    const submitBtn = document.querySelector("#screen_e_create_squad footer button");
    if (submitBtn) {
      submitBtn.onclick = () => this.executePublishCallupFromSquad();
      const btnSpan = submitBtn.querySelector("span:first-child");
      if (btnSpan) btnSpan.textContent = `Publicar Convocatoria Oficial (${players.length})`;
    }
  }
}

