export class IdempotencyManager {
  constructor() {
    this.keys = new Map();
  }

  generateUUID() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  getOrCreateKey(actionScope) {
    if (!this.keys.has(actionScope)) {
      this.keys.set(actionScope, this.generateUUID());
    }
    return this.keys.get(actionScope);
  }

  clearKey(actionScope) {
    this.keys.delete(actionScope);
  }

  resetKey(actionScope) {
    const nextKey = this.generateUUID();
    this.keys.set(actionScope, nextKey);
    return nextKey;
  }
}

export const idempotencyManager = new IdempotencyManager();
