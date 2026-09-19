/**
 * TeamsService - VS03 Bootstrap, Roster & Memberships
 */
export class TeamsService {
  constructor(client) {
    this.client = client;
  }

  async bootstrap(payload, idempotencyKey) {
    return this.client.post("/teams/bootstrap", payload, { idempotencyKey });
  }

  async getMyMemberships() {
    return this.client.get("/me/memberships");
  }

  async addPlayer(teamSeasonId, payload, idempotencyKey) {
    return this.client.post(`/team-seasons/${teamSeasonId}/players`, payload, { idempotencyKey });
  }

  async createPlayerInvitation(teamSeasonId, playerId) {
    return this.client.post(`/team-seasons/${teamSeasonId}/players/${playerId}/invitations`, {});
  }

  async getPendingRequests(teamSeasonId) {
    return this.client.get(`/team-seasons/${teamSeasonId}/guardian-link-requests`);
  }

  async approveGuardianRequest(requestId, playerId = null) {
    const body = playerId ? { playerId } : {};
    return this.client.post(`/guardian-link-requests/${requestId}/approve`, body);
  }

  async rejectGuardianRequest(requestId) {
    return this.client.post(`/guardian-link-requests/${requestId}/reject`, {});
  }

  async getPlayer(teamSeasonId, playerId) {
    return this.client.get(`/team-seasons/${teamSeasonId}/players/${playerId}`);
  }

  async getPlayers(teamSeasonId) {
    return this.client.get(`/team-seasons/${teamSeasonId}/players`);
  }
}
