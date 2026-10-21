/**
 * Talde Hemendik! — Core Concurrency Tracker
 * Gestiona secuencias monotónicas de intención e invalida intenciones obsoletas por canal.
 */

export class ConcurrencyTracker {
  constructor() {
    this.sequences = {
      event: 0,
      identity_context: 0,
      otp: 0
    };
    this.pending = {
      event: null,
      identity_context: null,
      otp: null
    };
  }

  startIntent(channel, targetId = null, originId = null) {
    if (!Object.prototype.hasOwnProperty.call(this.sequences, channel)) {
      this.sequences[channel] = 0;
    }
    const seq = ++this.sequences[channel];
    const token = {
      channel,
      seq,
      createdAt: Date.now(),
      targetId: targetId ? String(targetId) : null,
      originId: originId ? String(originId) : null
    };
    this.pending[channel] = token;
    return token;
  }

  isCurrent(token) {
    if (!token || !token.channel) return false;
    return this.sequences[token.channel] === token.seq;
  }

  hasPendingIntent(channel) {
    return Boolean(this.pending[channel]);
  }

  getPendingIntent(channel) {
    return this.pending[channel] || null;
  }

  completeIntent(token) {
    if (!token || !token.channel) return false;
    if (this.pending[token.channel]?.seq === token.seq) {
      this.pending[token.channel] = null;
    }
    return this.sequences[token.channel] === token.seq;
  }

  discardIntent(token) {
    if (!token || !token.channel) return;
    if (this.pending[token.channel]?.seq === token.seq) {
      this.pending[token.channel] = null;
    }
  }

  getCurrentSeq(channel) {
    return this.sequences[channel] || 0;
  }

  reset() {
    for (const ch of Object.keys(this.sequences)) {
      this.sequences[ch] = 0;
      this.pending[ch] = null;
    }
  }
}
