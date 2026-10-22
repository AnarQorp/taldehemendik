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
    if (this.stateRef?.beta && Object.prototype.hasOwnProperty.call(this.stateRef.beta, "activeEventId")) {
      return this.stateRef.beta.activeEventId;
    }
    return this.confirmedContext.activeEventId;
  }

  _getCurrentSessionId() {
    return this.stateRef?.currentSessionId ?? this.sessionManager.getCurrentSessionId();
  }

  _getCurrentTeamSeasonId() {
    if (this.stateRef?.beta && Object.prototype.hasOwnProperty.call(this.stateRef.beta, "teamSeasonId")) {
      return this.stateRef.beta.teamSeasonId;
    }
    return this.confirmedContext.teamSeasonId;
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
    const {
      generation: _g,
      sessionId: _s,
      credentialEpoch: _c,
      bearerToken: _b,
      ...safeExtra
    } = extra || {};
    return Object.freeze({
      ...safeExtra,
      generation: this._getCurrentGeneration(),
      sessionId: this._getCurrentSessionId(),
      credentialEpoch: this.sessionManager.getCredentialEpoch(),
      bearerToken: this.sessionManager.getToken(),
      teamSeasonId: safeExtra.teamSeasonId !== undefined ? safeExtra.teamSeasonId : this._getCurrentTeamSeasonId()
    });
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
    const {
      viewId: _v,
      viewEpoch: _ve,
      eventEpoch: _ee,
      ...safeExtra
    } = extra || {};
    return Object.freeze({
      ...safeExtra,
      viewId: String(viewId),
      viewEpoch: this.confirmedContext.viewEpoch,
      eventEpoch: this.confirmedContext.eventEpoch,
      teamSeasonId: safeExtra.teamSeasonId !== undefined ? safeExtra.teamSeasonId : this._getCurrentTeamSeasonId(),
      eventId: safeExtra.eventId !== undefined ? safeExtra.eventId : this._getCurrentActiveEventId(),
      role: safeExtra.role || this.stateRef?.currentRole || this.confirmedContext.currentRole || null,
      currentScreen: this.stateRef?.currentScreen || null
    });
  }

  isDispatchScopeActive(scope) {
    if (!scope) return false;
    const currentSession = this._getCurrentSessionId();
    if (scope.sessionId !== undefined && scope.sessionId !== currentSession) return false;
    if (scope.credentialEpoch !== undefined && scope.credentialEpoch !== this.sessionManager.getCredentialEpoch()) return false;
    if (scope.generation !== undefined && scope.generation !== this._getCurrentGeneration()) return false;
    if (scope.teamSeasonId !== undefined && scope.teamSeasonId !== this._getCurrentTeamSeasonId()) return false;
    return true;
  }

  isViewScopeActive(scope) {
    if (!scope) return false;
    if (scope.viewEpoch !== undefined && scope.viewEpoch !== this.confirmedContext.viewEpoch) return false;
    if (scope.eventEpoch !== undefined && scope.eventEpoch !== this.confirmedContext.eventEpoch) return false;
    if (scope.teamSeasonId !== undefined && scope.teamSeasonId !== this._getCurrentTeamSeasonId()) return false;
    if (scope.eventId !== undefined && scope.eventId !== null && scope.eventId !== this._getCurrentActiveEventId()) return false;
    if (scope.viewId !== undefined && this.stateRef?.currentScreen && scope.viewId !== this.stateRef.currentScreen) return false;
    return true;
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

    if (payload.activeEventId !== undefined && payload.activeEventId !== this.confirmedContext.activeEventId) {
      this.confirmedContext.activeEventId = payload.activeEventId;
      if (payload.activeEventId === null) {
        this.confirmedContext.eventEpoch = 0;
      }
      changed.push("activeEventId", "eventEpoch");
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

    const effectiveSessId = payload.currentSessionId || this._getCurrentSessionId() || this.confirmedContext.currentSessionId || null;
    if (effectiveSessId) {
      this.confirmedContext.currentSessionId = effectiveSessId;
    }

    if (payload.bearer !== undefined || (payload.tokens && payload.tokens[payload.role || this.confirmedContext.currentRole])) {
      const tok = payload.bearer || (payload.tokens && payload.tokens[payload.role || this.confirmedContext.currentRole]);
      this.sessionManager.setSession(
        effectiveSessId,
        tok,
        payload.appMode || this.confirmedContext.appMode || "BETA_NORMAL"
      );
    } else if (payload.currentSessionId !== undefined) {
      this.sessionManager.setSession(
        payload.currentSessionId,
        this.sessionManager.getToken(),
        payload.appMode || this.confirmedContext.appMode || "BETA_NORMAL"
      );
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
