export class CallupService {
  constructor(client) {
    this.client = client;
  }

  async createDraft(eventId, playerIds) {
    return this.client.post(`/events/${eventId}/callup`, { playerIds });
  }

  async updateDraft(callupId, { playerIds, expectedVersion }) {
    return this.client.patch(`/callups/${callupId}/draft`, { playerIds, expectedVersion });
  }

  async publishCallup(callupId, { expectedVersion, confirmWarnings = [] }, idempotencyKey) {
    return this.client.post(
      `/callups/${callupId}/publish`,
      { expectedVersion, confirmWarnings },
      { idempotencyKey }
    );
  }

  async reviseCallup(callupId, { playerIds, expectedRevision, confirmWarnings = [] }) {
    return this.client.post(`/callups/${callupId}/revisions`, {
      playerIds,
      expectedRevision,
      confirmWarnings
    });
  }

  async getCallup(callupId) {
    return this.client.get(`/callups/${callupId}`);
  }

  async getPlayerCallupStatus(eventId, playerId) {
    return this.client.get(`/events/${eventId}/players/${playerId}/callup-status`);
  }
}
