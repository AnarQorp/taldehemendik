/**
 * Talde Hemendik! — Core Context Coordinator (REV-02)
 * Committer exclusivo de contexto (activeEventId, teamSeasonId, roles, épocas).
 * Reglas M02, M03, M05, M07: TargetScope, ViewScope, 4 puertas de autoridad e invariantes monotónicas.
 */

export class ContextCoordinator {
  /**
   * @param {Object} options
   * @param {import('./session-manager.js').SessionManager} options.sessionManager
   * @param {import('./concurrency-tracker.js').ConcurrencyTracker} options.concurrencyTracker
   * @param {Object} [options.stateRef] - Referencia opcional a la instancia TeamAppState para sincronización reactiva.
   * @param {Partial<Object>} [options.initial]
   */
  constructor({ sessionManager, concurrencyTracker, stateRef = null, initial = {} }) {
    if (!sessionManager || !concurrencyTracker) {
      throw new Error("ContextCoordinator requires sessionManager and concurrencyTracker");
    }
    this.sessionManager = sessionManager;
    this.concurrencyTracker = concurrencyTracker;
    this.stateRef = stateRef;

    this.confirmedContext = {
      appMode: initial.appMode || null,
      currentSessionId: initial.currentSessionId || null,
      currentRole: initial.currentRole || "onboard",
      teamSeasonId: initial.teamSeasonId || null,
      activeEventId: initial.activeEventId || null,
      activeChildId: initial.activeChildId || null,
      contextGeneration: initial.contextGeneration !== undefined ? initial.contextGeneration : 0,
      eventEpoch: initial.eventEpoch || 0,
      viewEpoch: initial.viewEpoch || 0
    };

    this.subscribers = new Set();
  }

  _getCurrentActiveEventId() {
    return this.stateRef?.beta?.activeEventId ?? this.confirmedContext.activeEventId;
  }

  _getCurrentSessionId() {
    return this.stateRef?.currentSessionId ?? this.sessionManager.getCurrentSessionId();
  }

  _getCurrentTeamSeasonId() {
    return this.stateRef?.beta?.teamSeasonId ?? this.confirmedContext.teamSeasonId;
  }

  _getCurrentGeneration() {
    return this.stateRef?.contextGeneration ?? this.confirmedContext.contextGeneration;
  }

  getConfirmedContext() {
    return {
      ...this.confirmedContext,
      activeEventId: this._getCurrentActiveEventId(),
      teamSeasonId: this._getCurrentTeamSeasonId(),
      currentSessionId: this._getCurrentSessionId(),
      contextGeneration: this._getCurrentGeneration()
    };
  }

  createDispatchScope(extra = {}) {
    return {
      generation: this._getCurrentGeneration(),
      sessionId: this._getCurrentSessionId(),
      credentialEpoch: this.sessionManager.getCredentialEpoch(),
      bearerToken: this.sessionManager.getToken(),
      teamSeasonId: this._getCurrentTeamSeasonId(),
      ...extra
    };
  }

  createTargetScope(targetEventId, intentToken) {
    return {
      originEventId: this._getCurrentActiveEventId(),
      targetEventId: targetEventId ? String(targetEventId) : null,
      intentToken,
      generation: this._getCurrentGeneration()
    };
  }

  createViewScope(viewId, extra = {}) {
    return {
      viewId: String(viewId),
      viewEpoch: this.confirmedContext.viewEpoch,
      eventEpoch: this.confirmedContext.eventEpoch,
      teamSeasonId: this._getCurrentTeamSeasonId(),
      eventId: this._getCurrentActiveEventId(),
      ...extra
    };
  }

  isDispatchScopeActive(scope) {
    if (!scope) return false;
    const currentSession = this._getCurrentSessionId();
    const isSessionMatch = scope.sessionId === currentSession;
    const isEpochMatch = scope.credentialEpoch === this.sessionManager.getCredentialEpoch();
    return Boolean(isSessionMatch && isEpochMatch);
  }

  isViewScopeActive(scope) {
    if (!scope) return false;
    const isViewEpochMatch = scope.viewEpoch === this.confirmedContext.viewEpoch;
    const isEventEpochMatch = scope.eventEpoch === this.confirmedContext.eventEpoch;
    const currentEventId = this._getCurrentActiveEventId();
    const isEventMatch = scope.eventId === null || scope.eventId === currentEventId;
    return Boolean(isViewEpochMatch && isEventEpochMatch && isEventMatch);
  }

  /**
   * Puerta 2: Commit atómico de selección de evento.
   * Valida TargetScope e IntentToken frente a la secuencia actual.
   * @param {Object} targetScope
   * @returns {boolean}
   */
  commitSelection(targetScope) {
    if (!targetScope || !targetScope.intentToken) return false;

    // 1. Debe ser la intención vigente en su canal
    if (!this.concurrencyTracker.isCurrent(targetScope.intentToken)) {
      return false;
    }

    // 2. La generación de contexto (identidad/equipo) debe seguir coincidiendo
    const currentGen = this._getCurrentGeneration();
    if (targetScope.generation !== currentGen) {
      this.concurrencyTracker.discardIntent(targetScope.intentToken);
      return false;
    }

    // Commit válido: avanza época de evento y confirma target
    this.confirmedContext.eventEpoch += 1;
    this.confirmedContext.activeEventId = targetScope.targetEventId;
    if (this.stateRef?.beta) {
      this.stateRef.beta.activeEventId = targetScope.targetEventId;
    }
    this.concurrencyTracker.completeIntent(targetScope.intentToken);

    this._notify(["activeEventId", "eventEpoch"]);
    return true;
  }

  /**
   * Puerta de Transiciones de Identidad y Equipo.
   * Avanza contextGeneration e invalida selecciones y épocas dependientes.
   * @param {Object} payload
   * @returns {boolean}
   */
  applyIdentityTransition(payload = {}) {
    const nextGen = (this.stateRef?.contextGeneration ?? this.confirmedContext.contextGeneration) + 1;
    this.confirmedContext.contextGeneration = nextGen;
    if (this.stateRef) {
      this.stateRef.contextGeneration = nextGen;
    }
    const changed = ["contextGeneration"];

    if (payload.currentSessionId !== undefined && payload.currentSessionId !== this.confirmedContext.currentSessionId) {
      this.confirmedContext.currentSessionId = payload.currentSessionId;
      if (this.stateRef) {
        this.stateRef.currentSessionId = payload.currentSessionId;
        if (this.stateRef.resourceStore) {
          this.stateRef.resourceStore.clearAll();
        }
      }
      changed.push("currentSessionId");
    }

    if (payload.teamSeasonId !== undefined && payload.teamSeasonId !== this.confirmedContext.teamSeasonId) {
      this.confirmedContext.teamSeasonId = payload.teamSeasonId;
      this.confirmedContext.activeEventId = null;
      this.confirmedContext.eventEpoch = 0;
      changed.push("teamSeasonId", "activeEventId", "eventEpoch");
    }

    if (payload.role !== undefined && payload.role !== this.confirmedContext.currentRole) {
      this.confirmedContext.currentRole = payload.role;
      if (this.stateRef) this.stateRef.currentRole = payload.role;
      changed.push("currentRole");
    } else if (payload.currentRole !== undefined && payload.currentRole !== this.confirmedContext.currentRole) {
      this.confirmedContext.currentRole = payload.currentRole;
      if (this.stateRef) this.stateRef.currentRole = payload.currentRole;
      changed.push("currentRole");
    }

    if (payload.activeChildId !== undefined && payload.activeChildId !== this.confirmedContext.activeChildId) {
      this.confirmedContext.activeChildId = payload.activeChildId;
      changed.push("activeChildId");
    }

    if (payload.appMode !== undefined && payload.appMode !== this.confirmedContext.appMode) {
      this.confirmedContext.appMode = payload.appMode;
      if (this.stateRef) this.stateRef.appMode = payload.appMode;
      changed.push("appMode");
    }

    this._notify(changed);
    return true;
  }

  advanceViewEpoch() {
    this.confirmedContext.viewEpoch += 1;
    this._notify(["viewEpoch"]);
  }

  subscribe(listener) {
    if (typeof listener !== "function") return () => {};
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  _notify(changedKeys) {
    const ctx = this.getConfirmedContext();
    for (const sub of this.subscribers) {
      try {
        sub(ctx, changedKeys);
      } catch (e) {
        console.error("ContextCoordinator subscriber error:", e);
      }
    }
  }
}
