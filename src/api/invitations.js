/**
 * InvitationsService - VS01/VS03 Individual Token & General Code Invitations
 */
export class InvitationsService {
  constructor(client) {
    this.client = client;
  }

  async getInvitation(token) {
    return this.client.get(`/invitations/${token}`);
  }

  async requestIndividualLink(token, payload = {}) {
    return this.client.post(`/invitations/${token}/guardian-link-requests`, payload);
  }

  async getTeamJoinInfo(code) {
    return this.client.get(`/team-join/${code}`);
  }

  async requestGeneralLink(code, payload) {
    return this.client.post(`/team-join/${code}/guardian-link-requests`, payload);
  }
}
