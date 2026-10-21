/**
 * Talde Hemendik! — Core Resource Store (REV-02)
 * Almacén indexado de recursos con reconciliación por identidad, tupla y versión monotónica.
 * Regla M06: V' > V aplica; V' < V no-op; prohibición estricta de degradación de PUBLISHED a DRAFT.
 */

export class ResourceStore {
  constructor() {
    this.store = new Map();
    this.subscribers = new Set();
  }

  _toKey(key) {
    if (!key || !key.teamSeasonId || !key.eventId) {
      throw new Error("ResourceKey must include teamSeasonId and eventId");
    }
    const callupId = key.callupId || "primary";
    const ns = key.namespace || "default";
    return `${key.teamSeasonId}:${key.eventId}:${callupId}:${ns}`;
  }

  getCallup(key) {
    const k = this._toKey(key);
    return this.store.get(k) || null;
  }

  reconcileCallup(key, incomingEntity) {
    if (!incomingEntity || typeof incomingEntity !== "object" || Object.keys(incomingEntity).length === 0) {
      return { applied: false, reason: "null_or_empty_entity" };
    }

    // 1. Verificación de identidad estricta de recurso
    if (incomingEntity.event_id && key.eventId && incomingEntity.event_id !== key.eventId) {
      return { applied: false, reason: "identity_mismatch" };
    }
    if (incomingEntity.team_season_id && key.teamSeasonId && incomingEntity.team_season_id !== key.teamSeasonId) {
      return { applied: false, reason: "identity_mismatch" };
    }
    if (key.callupId && key.callupId !== "primary" && incomingEntity.id && incomingEntity.id !== key.callupId) {
      return { applied: false, reason: "identity_mismatch" };
    }

    // 2. Validación de formato de versión monotónica
    const incomingVer = Number(incomingEntity.version);
    if (!Number.isInteger(incomingVer) || (typeof incomingEntity.version === "string" && !/^\d+$/.test(incomingEntity.version)) || incomingVer < 0) {
      return { applied: false, reason: "invalid_version" };
    }

    const k = this._toKey(key);
    const existing = this.store.get(k);

    if (existing) {
      // 3. Prohibición estricta de degradación: PUBLISHED nunca baja a DRAFT
      if (existing.status === "PUBLISHED" && incomingEntity.status === "DRAFT") {
        return { applied: false, reason: "downgrade_prohibited" };
      }

      // 4. Ordenación formal de versiones
      const existingVer = Number(existing.version || 0);

      if (incomingVer < existingVer) {
        return { applied: false, reason: "stale_version" };
      }

      if (incomingVer === existingVer) {
        // Idempotencia si el contenido relevante es equivalente
        const isSameStatus = existing.status === incomingEntity.status;
        const isSameId = existing.id === incomingEntity.id;
        if (isSameStatus && isSameId) {
          return { applied: false, reason: "idempotent" };
        }
        return { applied: false, reason: "conflict_divergent" };
      }
    }

    // Versión mayor o inserción inicial o actualización válida
    this.store.set(k, { ...incomingEntity, version: incomingVer });
    this._notify(key, incomingEntity);
    return { applied: true, reason: existing ? "updated" : "created" };
  }

  _toAvailabilityKey(key) {
    if (!key || !key.eventId) {
      throw new Error("AvailabilityKey must include eventId");
    }
    const teamSeasonId = key.teamSeasonId || "default";
    const playerId = key.playerId || "all";
    const ns = key.namespace || "default";
    return `avail:${teamSeasonId}:${key.eventId}:${playerId}:${ns}`;
  }

  getAvailability(key) {
    const k = this._toAvailabilityKey(key);
    return this.store.get(k) || null;
  }

  reconcileAvailability(key, incomingEntity) {
    if (!incomingEntity || typeof incomingEntity !== "object" || Object.keys(incomingEntity).length === 0) {
      return { applied: false, reason: "null_or_empty_entity" };
    }
    const incomingVer = Number(incomingEntity.version !== undefined ? incomingEntity.version : 0);
    if (!Number.isInteger(incomingVer) || (typeof incomingEntity.version === "string" && !/^\d+$/.test(incomingEntity.version)) || incomingVer < 0) {
      return { applied: false, reason: "invalid_version" };
    }

    const k = this._toAvailabilityKey(key);
    const existing = this.store.get(k);
    if (existing) {
      const existingVer = Number(existing.version || 0);
      if (incomingVer < existingVer) {
        return { applied: false, reason: "stale_version" };
      }
      if (incomingVer === existingVer && existing.status === incomingEntity.status) {
        return { applied: false, reason: "idempotent" };
      }
    }

    this.store.set(k, { ...incomingEntity, version: incomingVer });
    this._notify(key, incomingEntity);
    return { applied: true, reason: existing ? "updated" : "created" };
  }

  clearNamespace(namespace) {
    const nsSuffix = `:${namespace}`;
    for (const k of this.store.keys()) {
      if (k.endsWith(nsSuffix)) {
        this.store.delete(k);
      }
    }
  }

  clearTeamSeason(teamSeasonId) {
    const prefix = `${teamSeasonId}:`;
    for (const k of this.store.keys()) {
      if (k.startsWith(prefix)) {
        this.store.delete(k);
      }
    }
  }

  clearAll() {
    this.store.clear();
  }

  subscribe(listener) {
    if (typeof listener !== "function") return () => {};
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  _notify(key, entity) {
    for (const sub of this.subscribers) {
      try {
        sub(key, entity);
      } catch (e) {
        console.error("ResourceStore subscriber error:", e);
      }
    }
  }
}
