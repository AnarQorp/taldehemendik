export class AvailabilityService {
  constructor(client) {
    this.client = client;
  }

  async getEventAvailability(eventId) {
    return this.client.get(`/events/${eventId}/availability`);
  }

  async getPlayerAvailability(eventId, playerId) {
    return this.client.get(`/events/${eventId}/players/${playerId}/availability`);
  }

  async setGuardianAvailability(eventId, playerId, { status, expectedVersion }, idempotencyKey) {
    return this.client.put(
      `/events/${eventId}/players/${playerId}/availability`,
      { status, expectedVersion },
      { idempotencyKey }
    );
  }

  async setStaffAvailability(eventId, playerId, { status, expectedVersion, note }, idempotencyKey) {
    return this.client.put(
      `/events/${eventId}/players/${playerId}/availability/staff-recorded`,
      { status, expectedVersion, note },
      { idempotencyKey }
    );
  }
}
