export class EventsService {
  constructor(client) {
    this.client = client;
  }

  async getEvents(teamSeasonId, query = {}) {
    const searchParams = new URLSearchParams();
    if (query.from) searchParams.set("from", query.from);
    if (query.to) searchParams.set("to", query.to);
    if (query.limit) searchParams.set("limit", String(query.limit));
    const qs = searchParams.toString();
    return this.client.get(`/team-seasons/${teamSeasonId}/events${qs ? `?${qs}` : ""}`);
  }

  async getEvent(eventId) {
    return this.client.get(`/events/${eventId}`);
  }

  async createEvent(teamSeasonId, eventData) {
    return this.client.post(`/team-seasons/${teamSeasonId}/events`, eventData);
  }
}
