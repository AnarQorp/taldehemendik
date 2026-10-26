/**
 * NoticesService - Beta 0.2 Team Notices
 */
export class NoticesService {
  constructor(client) {
    this.client = client;
  }

  async createNotice(teamSeasonId, payload) {
    return this.client.post(`/team-seasons/${teamSeasonId}/notices`, payload);
  }

  async getNotices(teamSeasonId) {
    return this.client.get(`/team-seasons/${teamSeasonId}/notices`);
  }
}
