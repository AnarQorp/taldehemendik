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
    if (!incomingEntity) {
      return { applied: false, reason: "null_entity" };
    }
    const k = this._toKey(key);
    const existing = this.store.get(k);

    if (existing) {
      // 1. Prohibición de degradación: PUBLISHED nunca baja a DRAFT
      if (existing.status === "PUBLISHED" && incomingEntity.status === "DRAFT") {
        return { applied: false, reason: "downgrade_prohibited" };
      }

      // 2. Ordenación formal de versiones
      const existingVer = Number(existing.version || 0);
      const incomingVer = Number(incomingEntity.version || 0);

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
      }
    }

    // Version mayor o inserción inicial o actualización válida
    this.store.set(k, { ...incomingEntity });
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
