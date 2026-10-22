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
    const viewScope = this.coordinator ? this.coordinator.createViewScope(this.app.currentScreen, { eventId: targetEventId }) : null;
    const preSessionId = this.coordinator ? this.coordinator._getCurrentSessionId() : this.app.currentSessionId;
    const preRole = this.app.currentRole;
    const preMode = this.app.appMode;
    const preGeneration = this.app.contextGeneration;
    const preTeam = this.app.beta?.teamSeasonId;

    await this.app.ensureAuth("coach");

    if (token && this.tracker && !this.tracker.isCurrent(token)) return;
    if (this.app.currentRole !== preRole || this.app.currentRole !== "coach") return;
    if (this.app.appMode !== preMode) return;
    if (this.app.contextGeneration !== preGeneration) return;
    if (this.app.beta?.teamSeasonId !== preTeam) return;
    const currentSession = this.coordinator ? this.coordinator._getCurrentSessionId() : this.app.currentSessionId;
    if (preSessionId && currentSession && preSessionId !== currentSession) return;

    const dispatchScope = this.coordinator ? this.coordinator.createDispatchScope({ role: "coach", eventId: targetEventId, intentToken: token }) : null;
    const scope = this.app.createScope({
      role: "coach",
      teamSeasonId: activeTeamSeasonId
    });

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

      if (!published || typeof published !== "object" || Object.keys(published).length === 0 || !published.id) {
        throw new Error("Respuesta inválida al publicar convocatoria.");
      }
      const callupEntity = published;

      // 1. Verificación de autorización de sesión y equipo (F01)
      const currentSession = this.coordinator ? this.coordinator._getCurrentSessionId() : this.app.currentSessionId;
      const currentTeam = this.coordinator ? this.coordinator._getCurrentTeamSeasonId() : this.app.beta?.teamSeasonId;
      const isSessionValid = Boolean(dispatchScope && dispatchScope.sessionId && dispatchScope.sessionId === currentSession);
      const isTeamValid = Boolean(activeTeamSeasonId && activeTeamSeasonId === currentTeam);
      const isEpochValid = !dispatchScope || dispatchScope.credentialEpoch === this.app.sessionManager.getCredentialEpoch();
      const isModeValid = !dispatchScope || (dispatchScope.mode ? dispatchScope.mode === this.app.appMode : this.app.appMode === "BETA_NORMAL");
      const isDispatchActive = this.coordinator ? this.coordinator.isDispatchScopeActive(dispatchScope) : (isSessionValid && isTeamValid);

      let reconcileResult = { applied: false };
      if (isSessionValid && isTeamValid && isEpochValid && isModeValid && isDispatchActive && this.store && callupEntity && callupEntity.id) {
        reconcileResult = this.store.reconcileCallup({
          teamSeasonId: activeTeamSeasonId,
          eventId: targetEventId,
          callupId: draft.id,
          namespace: "live"
        }, callupEntity);
      }

      // Si el almacén rechazó la entidad (por identidad o versión inválida), no proyectar (F08)
      if (!reconcileResult.applied && reconcileResult.reason !== "idempotent" && reconcileResult.reason !== "stale_version" && this.store) {
        return;
      }

      // 2. Puerta de selección y proyección visual (F03, F05, D12-F01)
      let committed = false;
      if (targetScope && this.coordinator) {
        committed = this.coordinator.commitSelection(targetScope);
      } else {
        committed = true;
      }

      const isTargetEventActive = (this.coordinator ? this.coordinator._getCurrentActiveEventId() : this.app.beta?.activeEventId) === targetEventId;

      if (committed || isTargetEventActive) {
        if (committed) {
          this.app.beta.activeEventId = targetEventId;
          try { localStorage.setItem("talde_active_event_id", targetEventId); } catch {}
        }
        if (isSessionValid && isTeamValid && isEpochValid && isModeValid) {
          const stored = this.store ? (this.store.getCallup({
            teamSeasonId: activeTeamSeasonId,
            eventId: targetEventId,
            callupId: draft.id,
            namespace: "live"
          }) || (typeof this.store.getActiveCallup === "function" ? this.store.getActiveCallup(activeTeamSeasonId, targetEventId, "live") : null)) : null;
          if (stored || !this.store) {
            this.app.live.callup = stored || callupEntity;
          }
        }

        const isViewStillCurrent = viewScope && this.coordinator
          ? (viewScope.viewEpoch === this.coordinator.confirmedContext.viewEpoch &&
             this.app.currentScreen === viewScope.viewId &&
             (committed || isTargetEventActive))
          : true;
        if (isViewStillCurrent) {
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
    const viewScope = this.coordinator ? this.coordinator.createViewScope(this.app.currentScreen, { eventId: targetEventId }) : null;
    const preSessionId = this.coordinator ? this.coordinator._getCurrentSessionId() : this.app.currentSessionId;
    const preRole = this.app.currentRole;
    const preMode = this.app.appMode;
    const preGeneration = this.app.contextGeneration;
    const preTeam = this.app.beta?.teamSeasonId;

    await this.app.ensureAuth("coach");

    if (token && this.tracker && !this.tracker.isCurrent(token)) return;
    if (this.app.currentRole !== preRole || this.app.currentRole !== "coach") return;
    if (this.app.appMode !== preMode) return;
    if (this.app.contextGeneration !== preGeneration) return;
    if (this.app.beta?.teamSeasonId !== preTeam) return;
    const currentSession = this.coordinator ? this.coordinator._getCurrentSessionId() : this.app.currentSessionId;
    if (preSessionId && currentSession && preSessionId !== currentSession) return;

    const dispatchScope = this.coordinator ? this.coordinator.createDispatchScope({ role: "coach", eventId: targetEventId, intentToken: token }) : null;
    const scope = this.app.createScope({ role: "coach", teamSeasonId: activeTeamSeasonId });

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

      if (!published || typeof published !== "object" || Object.keys(published).length === 0 || !published.id) {
        throw new Error("Respuesta inválida al publicar convocatoria desde plantilla.");
      }
      const callupEntity = published;

      // 1. Verificación de autorización de sesión y equipo (F01)
      const currentSession = this.coordinator ? this.coordinator._getCurrentSessionId() : this.app.currentSessionId;
      const currentTeam = this.coordinator ? this.coordinator._getCurrentTeamSeasonId() : this.app.beta?.teamSeasonId;
      const isSessionValid = Boolean(dispatchScope && dispatchScope.sessionId && dispatchScope.sessionId === currentSession);
      const isTeamValid = Boolean(activeTeamSeasonId && activeTeamSeasonId === currentTeam);
      const isEpochValid = !dispatchScope || dispatchScope.credentialEpoch === this.app.sessionManager.getCredentialEpoch();
      const isModeValid = !dispatchScope || (dispatchScope.mode ? dispatchScope.mode === this.app.appMode : this.app.appMode === "BETA_NORMAL");
      const isDispatchActive = this.coordinator ? this.coordinator.isDispatchScopeActive(dispatchScope) : (isSessionValid && isTeamValid);

      let reconcileResult = { applied: false };
      if (isSessionValid && isTeamValid && isEpochValid && isModeValid && isDispatchActive && this.store && callupEntity && callupEntity.id) {
        reconcileResult = this.store.reconcileCallup({
          teamSeasonId: activeTeamSeasonId,
          eventId: targetEventId,
          callupId: callupId,
          namespace: "live"
        }, callupEntity);
      }

      // Si el almacén rechazó la entidad (por identidad o versión inválida), no proyectar (F08)
      if (!reconcileResult.applied && reconcileResult.reason !== "idempotent" && reconcileResult.reason !== "stale_version" && this.store) {
        return;
      }

      // 2. Puerta de selección y proyección visual (F03, F05, D12-F01)
      let committed = false;
      if (targetScope && this.coordinator) {
        committed = this.coordinator.commitSelection(targetScope);
      } else {
        committed = true;
      }

      const isTargetEventActive = (this.coordinator ? this.coordinator._getCurrentActiveEventId() : this.app.beta?.activeEventId) === targetEventId;

      if (committed || isTargetEventActive) {
        if (committed) {
          this.app.beta.activeEventId = targetEventId;
          try { localStorage.setItem("talde_active_event_id", targetEventId); } catch {}
        }
        if (isSessionValid && isTeamValid && isEpochValid && isModeValid) {
          const stored = this.store ? (this.store.getCallup({
            teamSeasonId: activeTeamSeasonId,
            eventId: targetEventId,
            callupId: callupId,
            namespace: "live"
          }) || (typeof this.store.getActiveCallup === "function" ? this.store.getActiveCallup(activeTeamSeasonId, targetEventId, "live") : null)) : null;
          if (stored || !this.store) {
            this.app.live.callup = stored || callupEntity;
          }
        }

        const isViewStillCurrent = viewScope && this.coordinator
          ? (viewScope.viewEpoch === this.coordinator.confirmedContext.viewEpoch &&
             this.app.currentScreen === viewScope.viewId &&
             (committed || isTargetEventActive))
          : true;
        if (isViewStillCurrent) {
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
    this.app.beta.players = players;
    const event = (evRes && evRes.event) ? evRes.event : evRes;

    const squadScreen = document.getElementById("screen_e_create_squad") || (document.querySelector && document.querySelector("#screen_e_create_squad"));
    if (squadScreen && players.length > 0) {
      const playerListContainer = squadScreen.querySelector ? squadScreen.querySelector(".space-y-2") : null;
      const cardsHtml = players.map(p => `
<article class="bg-surface-container-lowest border border-outline-variant rounded-xl p-3 flex items-center justify-between shadow-sm active:scale-[0.99] transition-transform">
<div class="flex items-center gap-3">
<div class="w-9 h-9 rounded-full bg-surface-container-high text-on-surface font-label-lg text-label-lg flex items-center justify-center font-bold">
  ${p.shirt_number || p.number || '•'}
</div>
<div>
<p class="font-headline-sm text-headline-sm text-on-surface leading-snug">${p.name || `${p.first_name || ''} ${p.last_name || ''}`.trim() || 'Jugador'}</p>
<div class="flex items-center gap-2 mt-0.5">
<span class="font-label-sm text-label-sm text-on-surface-variant">${p.position || 'Jugador'}</span>
<span class="w-1 h-1 rounded-full bg-outline-variant"></span>
<span class="font-label-sm text-label-sm text-secondary font-bold">Disponible</span>
</div>
</div>
</div>
<button aria-label="Desmarcar ${p.name || 'jugador'}" class="w-8 h-8 rounded-lg bg-primary-container text-on-primary flex items-center justify-center shadow-sm active:scale-[0.95]" type="button">
<span class="material-symbols-outlined text-[20px]" style="font-variation-settings: 'FILL' 1;">check</span>
</button>
</article>`).join("");
      if (playerListContainer) {
        playerListContainer.innerHTML = cardsHtml;
      } else if (typeof squadScreen.innerHTML === "string" && squadScreen.innerHTML.includes('<div class="space-y-2">')) {
        const listStart = squadScreen.innerHTML.indexOf('<div class="space-y-2">');
        const listEnd = squadScreen.innerHTML.indexOf('</section>', listStart);
        if (listEnd !== -1) {
          squadScreen.innerHTML = squadScreen.innerHTML.slice(0, listStart) + '<div class="space-y-2">' + cardsHtml + '</div>' + squadScreen.innerHTML.slice(listEnd);
        }
      }
    }

    const submitBtn = document.querySelector("#screen_e_create_squad footer button");
    if (submitBtn) {
      submitBtn.onclick = () => this.executePublishCallupFromSquad();
      const btnSpan = submitBtn.querySelector("span:first-child");
      if (btnSpan) btnSpan.textContent = `Publicar Convocatoria Oficial (${players.length})`;
    }
  }
}

