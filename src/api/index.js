import { DomainError, ERROR_MESSAGES, mapDomainError } from "./errors.js";
import { IdempotencyManager, idempotencyManager } from "./idempotency.js";
import { ApiClient, defaultClient } from "./client.js";
import { AuthService } from "./auth.js";
import { EventsService } from "./events.js";
import { AvailabilityService } from "./availability.js";
import { CallupService } from "./callup.js";
import { PendingService } from "./pending.js";
import { DevService } from "./dev.js";
import { TeamsService } from "./teams.js";
import { InvitationsService } from "./invitations.js";
import { MASTER_DATASET, API_BASE_URL, resolveApiBaseUrl, setApiBaseUrl } from "./config.js";

export const DEMO_CONFIG = {
  TEAM_SEASON_ID: "72000000-0000-4000-8000-000000000001",
  MAIN_EVENT_ID: "74000000-0000-4000-8000-000000000001",
  EVENT_INDAUTXU_ID: "74000000-0000-4000-8000-000000000001",
  IBAI_PLAYER_ID: "73000000-0000-4000-8000-000000000001",
  ANE_PLAYER_ID: "73000000-0000-4000-8000-000000000002",
  COACH_EMAIL: "mikel@example.test",
  GUARDIAN_EMAIL: "elena@example.test"
};

export function createApi(baseUrl = API_BASE_URL) {
  const client = new ApiClient(baseUrl);
  return {
    client,
    auth: new AuthService(client),
    events: new EventsService(client),
    availability: new AvailabilityService(client),
    callup: new CallupService(client),
    pending: new PendingService(client),
    teams: new TeamsService(client),
    invitations: new InvitationsService(client),
    dev: new DevService(client),
    idempotency: new IdempotencyManager()
  };
}

export const api = {
  client: defaultClient,
  auth: new AuthService(defaultClient),
  events: new EventsService(defaultClient),
  availability: new AvailabilityService(defaultClient),
  callup: new CallupService(defaultClient),
  pending: new PendingService(defaultClient),
  teams: new TeamsService(defaultClient),
  invitations: new InvitationsService(defaultClient),
  dev: new DevService(defaultClient),
  idempotency: idempotencyManager
};

export {
  MASTER_DATASET,
  API_BASE_URL,
  resolveApiBaseUrl,
  setApiBaseUrl,
  DomainError,
  ERROR_MESSAGES,
  mapDomainError,
  IdempotencyManager,
  idempotencyManager,
  ApiClient,
  AuthService,
  EventsService,
  AvailabilityService,
  CallupService,
  PendingService,
  TeamsService,
  InvitationsService,
  DevService
};

