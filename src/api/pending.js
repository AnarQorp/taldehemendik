export class PendingService {
  constructor(client) {
    this.client = client;
  }

  async getPending(teamSeasonId) {
    return this.client.get(`/team-seasons/${teamSeasonId}/pending`);
  }

  async getReplacementCandidates(actionItemId) {
    return this.client.get(`/action-items/${actionItemId}/replacement-candidates`);
  }

  async replacePlayer(actionItemId, { substitutePlayerId, expectedCallupRevision }, idempotencyKey) {
    return this.client.post(
      `/action-items/${actionItemId}/replace`,
      { substitutePlayerId, expectedCallupRevision },
      { idempotencyKey }
    );
  }
}
