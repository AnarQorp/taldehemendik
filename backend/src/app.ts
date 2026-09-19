import { createHash, randomBytes } from "node:crypto";
import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { z } from "zod";
import { pool, inTransaction } from "./db/pool.js";
import { DevelopmentAuthAdapter } from "./auth/development-adapter.js";
import type { AuthAdapter } from "./auth/adapter.js";
import { config } from "./config.js";
import { DomainError } from "./domain/errors.js";
import { requireGuardianPlayerAccess, requirePlayerInSeason, requireRole } from "./policy/authorization.js";
import { resetDemoDatabase } from "./db/demo-reset.js";
import { emptyDatabase } from "./db/empty.js";

const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
const emailSchema = z.string().email().max(254).transform((v) => v.toLowerCase());
const uuid = z.string().uuid();
const availability = z.enum(["CAN_ATTEND", "CANNOT_ATTEND", "UNSURE"]);

type BuildOptions = { authAdapter?: AuthAdapter; enableDevReset?: boolean };

export async function buildApp(options: BuildOptions = {}) {
  const auth = options.authAdapter ?? new DevelopmentAuthAdapter();
  const app = Fastify({ logger: false });
  await app.register(rateLimit, { max: 300, timeWindow: "1 minute" });
  await app.register(swagger, { openapi: { info: { title: "Talde Hemendik Backend", version: "0.3.0" } } });
  await app.register(swaggerUi, { routePrefix: "/documentation" });

  if(options.enableDevReset??config.devResetEnabled){
    app.post("/v1/dev/reset",async()=>inTransaction((db)=>resetDemoDatabase(db)));
    app.post("/v1/dev/empty",async()=>inTransaction((db)=>emptyDatabase(db)));
  }

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof DomainError) return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
    if (error instanceof z.ZodError) return reply.code(400).send({ error: { code: "VALIDATION_ERROR", issues: error.issues } });
    if ((error as { code?: string }).code === "23505") return reply.code(409).send({ error: { code: "LINK_REQUEST_ALREADY_EXISTS", message: "Resource already exists" } });
    if ((error as { statusCode?: number }).statusCode === 429) return reply.code(429).send({ error: { code: "RATE_LIMIT_EXCEEDED", message: (error as Error).message } });
    console.error("Fastify error:", error);
    return reply.code(500).send({ error: { code: "INTERNAL_ERROR", message: "Internal error" } });
  });

  async function actor(request: { headers: Record<string, unknown> }) {
    const value = request.headers.authorization;
    if (typeof value !== "string" || !value.startsWith("Bearer ")) throw new DomainError("AUTH_INVALID", 401, "Bearer token required");
    return auth.verifyAccessToken(value.slice(7));
  }

  const allowedOrigins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:8000",
    "http://127.0.0.1:8000",
    "http://localhost:5173",
    "http://127.0.0.1:5173"
  ];
  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      return cb(new Error("CORS origin not allowed"), false);
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Idempotency-Key"],
    exposedHeaders: ["Idempotency-Key"],
    credentials: true
  });

  app.get("/health", async () => {
    await pool.query("SELECT 1");
    return { status: "ok" };
  });

  const otpRequestLimit = config.devResetEnabled ? 1000 : 50;
  const otpVerifyLimit = config.devResetEnabled ? 1000 : 100;

  app.post("/v1/auth/otp/request", { config: { rateLimit: { max: otpRequestLimit, timeWindow: "5 minutes" } } }, async (request) => {
    const { email } = z.object({ email: emailSchema }).parse(request.body);
    return auth.requestOtp(email);
  });

  app.post("/v1/auth/otp/verify", { config: { rateLimit: { max: otpVerifyLimit, timeWindow: "5 minutes" } } }, async (request) => {
    const body = z.object({ email: emailSchema, challengeId: uuid, otp: z.string().regex(/^\d{6}$/), displayName: z.string().min(1).max(100).optional() }).parse(request.body);
    const identity = await auth.verifyOtp(body.email, body.challengeId, body.otp);
    const result = await pool.query(
      `INSERT INTO users (auth_subject,email,display_name) VALUES ($1,$2,$3)
       ON CONFLICT (auth_subject) DO UPDATE SET email=EXCLUDED.email
       RETURNING id,email,display_name`,
      [identity.subject, identity.email, body.displayName ?? identity.email.split("@")[0]]
    );
    return { accessToken: auth.issueAccessToken(result.rows[0].id), user: result.rows[0] };
  });

  app.post("/v1/teams/bootstrap", async(request,reply)=>{
    const {userId}=await actor(request);
    const key=typeof request.headers["idempotency-key"]==="string"?request.headers["idempotency-key"]:undefined;
    if(!key||key.length<8||key.length>100) throw new DomainError("BOOTSTRAP_IDEMPOTENCY_CONFLICT",400,"A valid Idempotency-Key is required");
    const body=z.object({
      team:z.object({name:z.string().trim().min(1).max(150),sport:z.string().trim().min(1).max(50)}),
      teamSeason:z.object({seasonLabel:z.string().trim().min(1).max(30),category:z.string().trim().min(1).max(100),displayLabel:z.string().trim().min(1).max(150)}),
      createGeneralJoinCode:z.boolean().default(false)
    }).parse(request.body);
    const result=await inTransaction(async(db)=>{
      const existing=await db.query(`SELECT ts.*,t.name team_name,t.sport,m.id membership_id,m.role,m.status FROM team_seasons ts JOIN teams t ON t.id=ts.team_id JOIN memberships m ON m.team_season_id=ts.id AND m.user_id=$1 AND m.role='COACH' WHERE ts.created_by_user_id=$1 AND ts.bootstrap_idempotency_key=$2 FOR UPDATE OF ts`,[userId,key]);
      if(existing.rowCount){
        const row=existing.rows[0];
        if(row.team_name!==body.team.name||row.sport!==body.team.sport||row.season_label!==body.teamSeason.seasonLabel||row.category!==body.teamSeason.category||row.display_label!==body.teamSeason.displayLabel) throw new DomainError("BOOTSTRAP_IDEMPOTENCY_CONFLICT",409,"Idempotency key was used with a different bootstrap payload");
        return {team:{id:row.team_id,name:row.team_name,sport:row.sport},teamSeason:row,membership:{id:row.membership_id,role:row.role,status:row.status},joinCode:row.join_code,idempotentReplay:true};
      }
      const team=(await db.query(`INSERT INTO teams(name,sport) VALUES($1,$2) RETURNING *`,[body.team.name,body.team.sport])).rows[0];
      const joinCode=body.createGeneralJoinCode?randomBytes(4).toString("hex").toUpperCase():null;
      const season=(await db.query(`INSERT INTO team_seasons(team_id,season_label,category,display_label,status,created_by_user_id,bootstrap_idempotency_key,join_code) VALUES($1,$2,$3,$4,'ACTIVE',$5,$6,$7) RETURNING *`,[team.id,body.teamSeason.seasonLabel,body.teamSeason.category,body.teamSeason.displayLabel,userId,key,joinCode])).rows[0];
      const membership=(await db.query(`INSERT INTO memberships(user_id,team_season_id,role,status) VALUES($1,$2,'COACH','ACTIVE') RETURNING *`,[userId,season.id])).rows[0];
      if(joinCode) await db.query(`INSERT INTO invitations(team_season_id,player_id,purpose,token_hash,expires_at,created_by_user_id) VALUES($1,NULL,'GUARDIAN_LINK',$2,now()+interval '1 year',$3)`,[season.id,tokenHash(joinCode),userId]);
      await db.query(`INSERT INTO audit_events(actor_user_id,team_season_id,action,entity_type,entity_id,metadata) VALUES($1,$2,'TEAM_BOOTSTRAPPED','TeamSeason',$2,$3)`,[userId,season.id,JSON.stringify({teamId:team.id,generalJoinCodeCreated:Boolean(joinCode)})]);
      await db.query(`INSERT INTO outbox_events(aggregate_type,aggregate_id,event_type,payload) VALUES('TeamSeason',$1,'TeamSeasonCreated',$2)`,[season.id,JSON.stringify({teamId:team.id,creatorUserId:userId})]);
      return {team,teamSeason:season,membership,joinCode,idempotentReplay:false};
    });
    return reply.code(result.idempotentReplay?200:201).send(result);
  });

  app.get("/v1/me/memberships",async(request)=>{
    const {userId}=await actor(request);
    const result=await pool.query(`SELECT m.id,m.role,m.status,m.created_at,ts.id team_season_id,ts.season_label,ts.category,ts.display_label,ts.status team_season_status,t.id team_id,t.name team_name,t.sport FROM memberships m JOIN team_seasons ts ON ts.id=m.team_season_id JOIN teams t ON t.id=ts.team_id WHERE m.user_id=$1 AND m.status='ACTIVE' ORDER BY t.name,ts.season_label`,[userId]);
    return {items:result.rows};
  });

  app.post("/v1/team-seasons/:teamSeasonId/players",async(request,reply)=>{
    const {userId}=await actor(request);const {teamSeasonId}=z.object({teamSeasonId:uuid}).parse(request.params);
    const key=typeof request.headers["idempotency-key"]==="string"?request.headers["idempotency-key"]:undefined;
    if(!key||key.length<8||key.length>100) throw new DomainError("ROSTER_IDEMPOTENCY_CONFLICT",400,"A valid Idempotency-Key is required");
    const body=z.object({firstName:z.string().trim().min(1).max(100),lastName:z.string().trim().min(1).max(150),shortName:z.string().trim().min(1).max(100).optional(),shirtNumber:z.number().int().min(0).max(999).optional(),position:z.string().trim().max(100).optional()}).parse(request.body);
    const result=await inTransaction(async(db)=>{
      await requireRole(db,userId,teamSeasonId,["COACH"]);
      const existing=await db.query(`SELECT re.*,p.first_name,p.last_name,p.short_name FROM roster_entries re JOIN players p ON p.id=re.player_id WHERE re.team_season_id=$1 AND re.creation_idempotency_key=$2 FOR UPDATE`,[teamSeasonId,key]);
      if(existing.rowCount){const row=existing.rows[0];if(row.first_name!==body.firstName||row.last_name!==body.lastName||row.short_name!==(body.shortName??null)||row.shirt_number!==(body.shirtNumber??null)||row.position!==(body.position??null))throw new DomainError("ROSTER_IDEMPOTENCY_CONFLICT",409,"Idempotency key was used with different player data");return {player:{id:row.player_id,first_name:row.first_name,last_name:row.last_name,short_name:row.short_name},rosterEntry:row,idempotentReplay:true};}
      const season=(await db.query(`SELECT team_id FROM team_seasons WHERE id=$1`,[teamSeasonId])).rows[0];
      const player=(await db.query(`INSERT INTO players(team_id,first_name,last_name,short_name) VALUES($1,$2,$3,$4) RETURNING *`,[season.team_id,body.firstName,body.lastName,body.shortName??null])).rows[0];
      const roster=(await db.query(`INSERT INTO roster_entries(player_id,team_season_id,shirt_number,position,status,creation_idempotency_key) VALUES($1,$2,$3,$4,'ACTIVE',$5) RETURNING *`,[player.id,teamSeasonId,body.shirtNumber??null,body.position??null,key])).rows[0];
      await db.query(`INSERT INTO audit_events(actor_user_id,team_season_id,action,entity_type,entity_id) VALUES($1,$2,'PLAYER_ADDED_TO_ROSTER','RosterEntry',$3)`,[userId,teamSeasonId,roster.id]);
      return {player,rosterEntry:roster,idempotentReplay:false};
    });
    return reply.code(result.idempotentReplay?200:201).send(result);
  });

  app.get("/v1/team-seasons/:teamSeasonId/players", async (request) => {
    const { userId } = await actor(request);
    const { teamSeasonId } = z.object({ teamSeasonId: uuid }).parse(request.params);
    await requireRole(pool, userId, teamSeasonId, ["COACH", "STAFF"]);
    const result = await pool.query(
      `SELECT p.id, p.first_name, p.last_name, p.short_name, re.shirt_number, re.position, re.status as roster_status,
              COUNT(gl.guardian_user_id)::int as guardians_count
       FROM roster_entries re
       JOIN players p ON p.id = re.player_id
       LEFT JOIN guardian_links gl ON gl.player_id = p.id AND gl.status = 'ACTIVE'
       WHERE re.team_season_id = $1 AND re.status = 'ACTIVE'
       GROUP BY p.id, p.first_name, p.last_name, p.short_name, re.shirt_number, re.position, re.status
       ORDER BY re.shirt_number NULLS LAST, p.first_name, p.last_name`,
      [teamSeasonId]
    );
    return { items: result.rows };
  });

  app.post("/v1/team-seasons/:teamSeasonId/players/:playerId/invitations", async (request, reply) => {
    const { userId } = await actor(request);
    const params = z.object({ teamSeasonId: uuid, playerId: uuid }).parse(request.params);
    await requireRole(pool, userId, params.teamSeasonId, ["COACH"]);
    await requirePlayerInSeason(pool, params.teamSeasonId, params.playerId);
    const plainToken = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + 7 * 86400_000);
    const result = await inTransaction(async (db) => {
      const inserted = await db.query(
        `INSERT INTO invitations(team_season_id,player_id,purpose,token_hash,expires_at,created_by_user_id)
         VALUES($1,$2,'GUARDIAN_LINK',$3,$4,$5) RETURNING id,expires_at`,
        [params.teamSeasonId, params.playerId, tokenHash(plainToken), expiresAt, userId]
      );
      await db.query(`INSERT INTO audit_events(actor_user_id,team_season_id,action,entity_type,entity_id) VALUES($1,$2,'INVITATION_CREATED','Invitation',$3)`, [userId, params.teamSeasonId, inserted.rows[0].id]);
      return inserted.rows[0];
    });
    return reply.code(201).send({ id: result.id, token: plainToken, expiresAt: result.expires_at });
  });

  app.get("/v1/invitations/:token", async (request) => {
    const { token } = z.object({ token: z.string().min(16) }).parse(request.params);
    const result = await pool.query(
      `SELECT i.status,i.expires_at,i.purpose,t.name,ts.season_label,ts.display_label
       FROM invitations i JOIN team_seasons ts ON ts.id=i.team_season_id JOIN teams t ON t.id=ts.team_id
       WHERE i.token_hash=$1`, [tokenHash(token)]
    );
    if (!result.rowCount || result.rows[0].status !== "ACTIVE") throw new DomainError("INVITATION_INVALID", 404, "Invitation is invalid");
    if (new Date(result.rows[0].expires_at) <= new Date()) throw new DomainError("INVITATION_EXPIRED", 410, "Invitation has expired");
    const row = result.rows[0];
    return { team: { name: row.name }, teamSeason: { seasonLabel: row.season_label, displayLabel: row.display_label }, purpose: row.purpose };
  });

  async function createGuardianRequest(token:string,userId:string,input:unknown){
    const claim=z.object({claimedPlayerName:z.string().trim().min(1).max(200).optional(),claimedShirtNumber:z.number().int().min(0).max(999).optional()}).parse(input??{});
    return inTransaction(async(db)=>{
      const invitation=await db.query(`SELECT * FROM invitations WHERE token_hash=$1 FOR UPDATE`,[tokenHash(token)]);
      if(!invitation.rowCount||invitation.rows[0].status!=="ACTIVE") throw new DomainError("INVITATION_INVALID",404,"Invitation is invalid");
      if(new Date(invitation.rows[0].expires_at)<=new Date()) throw new DomainError("INVITATION_EXPIRED",410,"Invitation has expired");
      const row=invitation.rows[0];
      if(!row.player_id&&!claim.claimedPlayerName) throw new DomainError("PLAYER_CLAIM_REQUIRED",422,"General invitation requires a manually entered player name");
      const created=await db.query(
        `INSERT INTO guardian_link_requests(invitation_id,requester_user_id,team_season_id,player_id,claimed_player_name,claimed_shirt_number)
         VALUES($1,$2,$3,$4,$5,$6) RETURNING id,status,created_at,player_id,claimed_player_name,claimed_shirt_number`,
        [row.id,userId,row.team_season_id,row.player_id,row.player_id?null:claim.claimedPlayerName??null,row.player_id?null:claim.claimedShirtNumber??null]
      );
      await db.query(`INSERT INTO audit_events(actor_user_id,team_season_id,action,entity_type,entity_id,metadata) VALUES($1,$2,'GUARDIAN_LINK_REQUEST_CREATED','GuardianLinkRequest',$3,$4)`,[userId,row.team_season_id,created.rows[0].id,JSON.stringify({invitationScope:row.player_id?"INDIVIDUAL":"GENERAL"})]);
      return created.rows[0];
    });
  }

  app.post("/v1/invitations/:token/guardian-link-requests", async (request, reply) => {
    const {userId}=await actor(request);const {token}=z.object({token:z.string().min(6)}).parse(request.params);
    return reply.code(201).send(await createGuardianRequest(token,userId,request.body));
  });

  app.get("/v1/team-join/:code",async(request)=>{
    const {code}=z.object({code:z.string().min(6).max(32).transform(v=>v.toUpperCase())}).parse(request.params);
    const result=await pool.query(`SELECT t.name,t.sport,ts.season_label,ts.display_label FROM team_seasons ts JOIN teams t ON t.id=ts.team_id WHERE ts.join_code=$1 AND ts.status='ACTIVE'`,[code]);
    if(!result.rowCount) throw new DomainError("GENERAL_JOIN_INVALID",404,"Team join code is invalid");
    const row=result.rows[0];return {team:{name:row.name,sport:row.sport},teamSeason:{seasonLabel:row.season_label,displayLabel:row.display_label},purpose:"GUARDIAN_LINK_REQUEST"};
  });

  app.post("/v1/team-join/:code/guardian-link-requests",async(request,reply)=>{
    const {userId}=await actor(request);const {code}=z.object({code:z.string().min(6).max(32).transform(v=>v.toUpperCase())}).parse(request.params);
    const season=await pool.query(`SELECT 1 FROM team_seasons WHERE join_code=$1 AND status='ACTIVE'`,[code]);
    if(!season.rowCount) throw new DomainError("GENERAL_JOIN_INVALID",404,"Team join code is invalid");
    return reply.code(201).send(await createGuardianRequest(code,userId,request.body));
  });

  app.get("/v1/team-seasons/:teamSeasonId/guardian-link-requests", async (request) => {
    const { userId } = await actor(request);
    const { teamSeasonId } = z.object({ teamSeasonId: uuid }).parse(request.params);
    await requireRole(pool, userId, teamSeasonId, ["COACH"]);
    const result = await pool.query(
      `SELECT r.id,r.status,r.created_at,r.claimed_player_name,r.claimed_shirt_number,u.id guardian_user_id,u.email,u.display_name,
              p.id player_id,p.first_name,p.last_name
       FROM guardian_link_requests r JOIN users u ON u.id=r.requester_user_id LEFT JOIN players p ON p.id=r.player_id
       WHERE r.team_season_id=$1 AND r.status='PENDING' ORDER BY r.created_at`, [teamSeasonId]
    );
    return { items: result.rows };
  });

  app.post("/v1/guardian-link-requests/:requestId/approve", async (request) => {
    const { userId } = await actor(request);
    const { requestId } = z.object({ requestId: uuid }).parse(request.params);
    const body=z.object({playerId:uuid.optional()}).parse(request.body??{});
    return inTransaction(async (db) => {
      const found = await db.query(`SELECT r.*,i.player_id invitation_player_id FROM guardian_link_requests r JOIN invitations i ON i.id=r.invitation_id WHERE r.id=$1 FOR UPDATE OF r`, [requestId]);
      if (!found.rowCount) throw new DomainError("PLAYER_NOT_ACCESSIBLE", 404, "Link request not found");
      const row = found.rows[0];
      await requireRole(db, userId, row.team_season_id, ["COACH"]);
      if (row.status === "APPROVED") {
        const existing = await db.query(`SELECT id FROM guardian_links WHERE guardian_user_id=$1 AND player_id=$2`, [row.requester_user_id, row.player_id]);
        return { requestId, status: "APPROVED", guardianLinkId: existing.rows[0].id, idempotentReplay: true };
      }
      if (row.status !== "PENDING") throw new DomainError("IDEMPOTENCY_CONFLICT", 409, "Only pending requests can be approved");
      const approvedPlayerId=row.player_id??body.playerId;
      if(!approvedPlayerId) throw new DomainError("PLAYER_CLAIM_REQUIRED",422,"Coach must select the claimed player when approving a general request");
      await requirePlayerInSeason(db,row.team_season_id,approvedPlayerId);
      await db.query(`INSERT INTO memberships(user_id,team_season_id,role,status) VALUES($1,$2,'GUARDIAN','ACTIVE') ON CONFLICT(user_id,team_season_id,role) DO UPDATE SET status='ACTIVE'`, [row.requester_user_id, row.team_season_id]);
      const link = await db.query(`INSERT INTO guardian_links(guardian_user_id,player_id,status) VALUES($1,$2,'ACTIVE') ON CONFLICT(guardian_user_id,player_id) DO UPDATE SET status='ACTIVE' RETURNING id`, [row.requester_user_id,approvedPlayerId]);
      await db.query(`UPDATE guardian_link_requests SET status='APPROVED',player_id=$3,reviewed_by_user_id=$2,reviewed_at=now() WHERE id=$1`, [requestId,userId,approvedPlayerId]);
      if(row.invitation_player_id) await db.query(`UPDATE invitations SET status='USED' WHERE id=$1`, [row.invitation_id]);
      await db.query(`INSERT INTO audit_events(actor_user_id,team_season_id,action,entity_type,entity_id) VALUES
        ($1,$2,'GUARDIAN_LINK_REQUEST_APPROVED','GuardianLinkRequest',$3),($1,$2,'GUARDIAN_LINK_ACTIVATED','GuardianLink',$4)`, [userId, row.team_season_id, requestId, link.rows[0].id]);
      await db.query(`INSERT INTO outbox_events(aggregate_type,aggregate_id,event_type,payload) VALUES('GuardianLink',$1,'GuardianLinkApproved',$2)`, [link.rows[0].id, JSON.stringify({teamSeasonId:row.team_season_id,playerId:approvedPlayerId,guardianUserId:row.requester_user_id})]);
      return { requestId, status: "APPROVED", guardianLinkId: link.rows[0].id, idempotentReplay: false };
    });
  });

  app.post("/v1/guardian-link-requests/:requestId/reject", async (request) => {
    const { userId } = await actor(request);
    const { requestId } = z.object({ requestId: uuid }).parse(request.params);
    return inTransaction(async (db) => {
      const found = await db.query(`SELECT * FROM guardian_link_requests WHERE id=$1 FOR UPDATE`, [requestId]);
      if (!found.rowCount) throw new DomainError("PLAYER_NOT_ACCESSIBLE", 404, "Link request not found");
      await requireRole(db, userId, found.rows[0].team_season_id, ["COACH"]);
      if (found.rows[0].status === "REJECTED") return { requestId, status: "REJECTED", idempotentReplay: true };
      if (found.rows[0].status !== "PENDING") throw new DomainError("IDEMPOTENCY_CONFLICT", 409, "Only pending requests can be rejected");
      await db.query(`UPDATE guardian_link_requests SET status='REJECTED',reviewed_by_user_id=$2,reviewed_at=now() WHERE id=$1`, [requestId, userId]);
      await db.query(`INSERT INTO audit_events(actor_user_id,team_season_id,action,entity_type,entity_id) VALUES($1,$2,'GUARDIAN_LINK_REQUEST_REJECTED','GuardianLinkRequest',$3)`, [userId, found.rows[0].team_season_id, requestId]);
      return { requestId, status: "REJECTED", idempotentReplay: false };
    });
  });

  app.get("/v1/team-seasons/:teamSeasonId/players/:playerId", async (request) => {
    const { userId } = await actor(request);
    const params = z.object({ teamSeasonId: uuid, playerId: uuid }).parse(request.params);
    try { await requireRole(pool, userId, params.teamSeasonId, ["COACH", "STAFF"]); }
    catch { await requireGuardianPlayerAccess(pool, userId, params.teamSeasonId, params.playerId); }
    const result = await pool.query(
      `SELECT p.id,p.first_name,p.last_name,p.short_name,re.shirt_number,re.position,ts.id team_season_id
       FROM players p JOIN roster_entries re ON re.player_id=p.id JOIN team_seasons ts ON ts.id=re.team_season_id
       WHERE p.id=$1 AND ts.id=$2 AND re.status='ACTIVE'`, [params.playerId, params.teamSeasonId]
    );
    if (!result.rowCount) throw new DomainError("PLAYER_NOT_ACCESSIBLE", 404, "Player is not accessible");
    return result.rows[0];
  });

  async function eventContext(eventId: string, playerId: string, db: typeof pool | import("pg").PoolClient = pool) {
    const result = await db.query(
      `SELECT e.*,re.status roster_status FROM events e JOIN roster_entries re ON re.team_season_id=e.team_season_id AND re.player_id=$2 WHERE e.id=$1`,
      [eventId, playerId]
    );
    if (!result.rowCount || result.rows[0].roster_status !== "ACTIVE") throw new DomainError("PLAYER_NOT_IN_TEAMSEASON", 422, "Player is not in event team season");
    return result.rows[0];
  }

  async function setAvailability(args: { eventId: string; playerId: string; userId: string; status: string; expectedVersion: number; source: string; note?: string; idempotencyKey?: string }) {
    return inTransaction(async (db) => {
      const event = await eventContext(args.eventId, args.playerId, db);
      if (event.status !== "ACTIVE" || !event.availability_enabled || event.availability_closed_at || (event.availability_deadline && new Date(event.availability_deadline) <= new Date())) throw new DomainError("AVAILABILITY_CLOSED", 409, "Availability is closed");
      const duplicate = args.idempotencyKey ? await db.query(`SELECT ar.* FROM availability_history h JOIN availability_responses ar ON ar.id=h.response_id WHERE h.actor_user_id=$1 AND h.idempotency_key=$2`, [args.userId, args.idempotencyKey]) : { rowCount: 0, rows: [] };
      if (duplicate.rowCount) {
        const prior = duplicate.rows[0];
        if (prior.status !== args.status || prior.source !== args.source || (prior.note ?? undefined) !== args.note) {
          throw new DomainError("IDEMPOTENCY_CONFLICT", 409, "Idempotency key was already used with a different payload");
        }
        return { ...prior, idempotentReplay: true };
      }
      const current = await db.query(`SELECT * FROM availability_responses WHERE event_id=$1 AND player_id=$2 FOR UPDATE`, [args.eventId, args.playerId]);
      const actualVersion = current.rowCount ? current.rows[0].version : 0;
      if (actualVersion !== args.expectedVersion) throw new DomainError("AVAILABILITY_VERSION_CONFLICT", 409, `Expected version ${args.expectedVersion}, current version ${actualVersion}`);
      const nextVersion = actualVersion + 1;
      const response = await db.query(
        `INSERT INTO availability_responses(event_id,player_id,status,source,actor_user_id,note,version,updated_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,now())
         ON CONFLICT(event_id,player_id) DO UPDATE SET status=EXCLUDED.status,source=EXCLUDED.source,actor_user_id=EXCLUDED.actor_user_id,note=EXCLUDED.note,version=EXCLUDED.version,updated_at=now()
         RETURNING *`, [args.eventId, args.playerId, args.status, args.source, args.userId, args.note ?? null, nextVersion]
      );
      const row = response.rows[0];
      await db.query(`INSERT INTO availability_history(response_id,event_id,player_id,status,source,actor_user_id,note,version,idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [row.id,args.eventId,args.playerId,args.status,args.source,args.userId,args.note ?? null,nextVersion,args.idempotencyKey ?? null]);
      await db.query(`INSERT INTO audit_events(actor_user_id,team_season_id,action,entity_type,entity_id,metadata) VALUES($1,$2,$3,'AvailabilityResponse',$4,$5)`, [args.userId,event.team_season_id,args.source === "STAFF_RECORDED" ? "AVAILABILITY_DELEGATED" : "AVAILABILITY_CHANGED",row.id,JSON.stringify({ version: nextVersion, source: args.source })]);
      await db.query(`INSERT INTO outbox_events(aggregate_type,aggregate_id,event_type,payload) VALUES('AvailabilityResponse',$1,'AvailabilityChanged',$2)`, [row.id,JSON.stringify({ eventId: args.eventId, playerId: args.playerId, status: args.status, version: nextVersion })]);
      const currentCallup = await db.query(
        `SELECT c.id,c.current_revision_number FROM callups c JOIN callup_revisions r ON r.callup_id=c.id AND r.revision_number=c.current_revision_number
         JOIN callup_selections s ON s.revision_id=r.id AND s.player_id=$2
         WHERE c.event_id=$1 AND c.status='PUBLISHED' FOR UPDATE OF c`,[args.eventId,args.playerId]
      );
      if(args.status==="CANNOT_ATTEND"&&currentCallup.rowCount){
        const callup=currentCallup.rows[0];
        const item=await db.query(
          `INSERT INTO action_items(team_season_id,event_id,player_id,type,payload)
           VALUES($1,$2,$3,'CALLED_PLAYER_UNAVAILABLE',$4)
           ON CONFLICT (event_id,player_id,type) WHERE status='OPEN' DO NOTHING RETURNING id`,
          [event.team_season_id,args.eventId,args.playerId,JSON.stringify({callupId:callup.id,callupRevision:callup.current_revision_number})]
        );
        if(item.rowCount){
          await db.query(`INSERT INTO audit_events(actor_user_id,team_season_id,action,entity_type,entity_id) VALUES($1,$2,'ACTION_ITEM_CREATED','ActionItem',$3)`,[args.userId,event.team_season_id,item.rows[0].id]);
          await db.query(`INSERT INTO outbox_events(aggregate_type,aggregate_id,event_type,payload) VALUES('ActionItem',$1,'CalledPlayerBecameUnavailable',$2),('ActionItem',$1,'ActionItemCreated',$2)`,[item.rows[0].id,JSON.stringify({eventId:args.eventId,playerId:args.playerId,callupId:callup.id,callupRevision:callup.current_revision_number})]);
        }
      } else if(args.status!=="CANNOT_ATTEND") {
        const open=await db.query(`SELECT * FROM action_items WHERE event_id=$1 AND player_id=$2 AND type='CALLED_PLAYER_UNAVAILABLE' AND status='OPEN' FOR UPDATE`,[args.eventId,args.playerId]);
        if(open.rowCount){
          const cause=open.rows[0];
          const revision=Number(cause.payload.callupRevision);
          const stillSame=await db.query(`SELECT 1 FROM callups c JOIN callup_revisions r ON r.callup_id=c.id AND r.revision_number=c.current_revision_number JOIN callup_selections s ON s.revision_id=r.id AND s.player_id=$2 WHERE c.id=$1 AND c.current_revision_number=$3`,[cause.payload.callupId,args.playerId,revision]);
          if(stillSame.rowCount){
            await db.query(`UPDATE action_items SET status='RESOLVED',resolved_at=now(),resolved_by_user_id=$2 WHERE id=$1`,[cause.id,args.userId]);
            await db.query(`INSERT INTO audit_events(actor_user_id,team_season_id,action,entity_type,entity_id,metadata) VALUES($1,$2,'ACTION_ITEM_AUTO_RESOLVED','ActionItem',$3,$4)`,[args.userId,event.team_season_id,cause.id,JSON.stringify({reason:"AVAILABILITY_RESTORED"})]);
            await db.query(`INSERT INTO outbox_events(aggregate_type,aggregate_id,event_type,payload) VALUES('ActionItem',$1,'ActionItemResolved',$2)`,[cause.id,JSON.stringify({reason:"AVAILABILITY_RESTORED"})]);
          }
        }
      }
      return { ...row, idempotentReplay: false };
    });
  }

  app.put("/v1/events/:eventId/players/:playerId/availability", async (request) => {
    const { userId } = await actor(request);
    const params = z.object({ eventId: uuid, playerId: uuid }).parse(request.params);
    const body = z.object({ status: availability, expectedVersion: z.number().int().min(0) }).parse(request.body);
    const event = await eventContext(params.eventId, params.playerId);
    await requireGuardianPlayerAccess(pool, userId, event.team_season_id, params.playerId);
    return setAvailability({ ...params, userId, ...body, source: "GUARDIAN_RECORDED", idempotencyKey: request.headers["idempotency-key"] as string | undefined });
  });

  app.put("/v1/events/:eventId/players/:playerId/availability/staff-recorded", async (request) => {
    const { userId } = await actor(request);
    const params = z.object({ eventId: uuid, playerId: uuid }).parse(request.params);
    const body = z.object({ status: availability, expectedVersion: z.number().int().min(0), note: z.string().max(280).optional() }).parse(request.body);
    const event = await eventContext(params.eventId, params.playerId);
    await requireRole(pool, userId, event.team_season_id, ["COACH", "STAFF"]);
    return setAvailability({ ...params, userId, ...body, source: "STAFF_RECORDED", idempotencyKey: request.headers["idempotency-key"] as string | undefined });
  });

  app.get("/v1/events/:eventId/availability", async (request) => {
    const { userId } = await actor(request);
    const { eventId } = z.object({ eventId: uuid }).parse(request.params);
    const event = await pool.query(`SELECT team_season_id FROM events WHERE id=$1`, [eventId]);
    if (!event.rowCount) throw new DomainError("PLAYER_NOT_ACCESSIBLE", 404, "Event not found");
    await requireRole(pool, userId, event.rows[0].team_season_id, ["COACH", "STAFF"]);
    const result = await pool.query(
      `SELECT p.id player_id,p.first_name,p.last_name,COALESCE(ar.status::text,'NO_RESPONSE') status,
              ar.version,ar.source,ar.actor_user_id,ar.updated_at
       FROM roster_entries re JOIN players p ON p.id=re.player_id
       LEFT JOIN availability_responses ar ON ar.player_id=p.id AND ar.event_id=$1
       WHERE re.team_season_id=$2 AND re.status='ACTIVE' ORDER BY p.last_name,p.first_name`, [eventId,event.rows[0].team_season_id]
    );
    const counts = { CAN_ATTEND: 0, CANNOT_ATTEND: 0, UNSURE: 0, NO_RESPONSE: 0 };
    for (const item of result.rows) counts[item.status as keyof typeof counts] += 1;
    return { counts, items: result.rows };
  });

  app.get("/v1/events/:eventId/players/:playerId/availability", async (request) => {
    const { userId } = await actor(request);
    const params = z.object({ eventId: uuid, playerId: uuid }).parse(request.params);
    const event = await eventContext(params.eventId, params.playerId);
    try { await requireRole(pool, userId, event.team_season_id, ["COACH", "STAFF"]); }
    catch { await requireGuardianPlayerAccess(pool, userId, event.team_season_id, params.playerId); }
    const current = await pool.query(`SELECT * FROM availability_responses WHERE event_id=$1 AND player_id=$2`, [params.eventId,params.playerId]);
    const history = await pool.query(`SELECT status,source,actor_user_id,note,version,created_at FROM availability_history WHERE event_id=$1 AND player_id=$2 ORDER BY version`, [params.eventId,params.playerId]);
    return { current: current.rowCount ? current.rows[0] : { eventId: params.eventId, playerId: params.playerId, status: "NO_RESPONSE", version: 0 }, history: history.rows };
  });

  const eventInput = z.object({
    type: z.enum(["TRAINING", "MATCH", "TOURNAMENT", "MEETING", "OTHER"]),
    title: z.string().min(1).max(200),
    startsAt: z.string().datetime(),
    arrivalAt: z.string().datetime().optional(),
    endsAt: z.string().datetime().optional(),
    location: z.string().max(300).optional(),
    notes: z.string().max(2000).optional(),
    availabilityEnabled: z.boolean(),
    availabilityDeadline: z.string().datetime().optional(),
    callupEnabled: z.boolean()
  });

  app.post("/v1/team-seasons/:teamSeasonId/events", async (request, reply) => {
    const { userId } = await actor(request);
    const { teamSeasonId } = z.object({ teamSeasonId: uuid }).parse(request.params);
    const body = eventInput.parse(request.body);
    await requireRole(pool, userId, teamSeasonId, ["COACH", "STAFF"]);
    const event = await inTransaction(async (db) => {
      const inserted = await db.query(
        `INSERT INTO events(team_season_id,type,title,starts_at,arrival_at,ends_at,location,notes,availability_enabled,availability_deadline,callup_enabled,status,created_by_user_id)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'ACTIVE',$12) RETURNING *`,
        [teamSeasonId,body.type,body.title,body.startsAt,body.arrivalAt ?? null,body.endsAt ?? null,body.location ?? null,body.notes ?? null,body.availabilityEnabled,body.availabilityDeadline ?? null,body.callupEnabled,userId]
      );
      const row = inserted.rows[0];
      await db.query(`INSERT INTO audit_events(actor_user_id,team_season_id,action,entity_type,entity_id,metadata) VALUES($1,$2,'EVENT_CREATED','Event',$3,$4)`, [userId,teamSeasonId,row.id,JSON.stringify({ version: row.version })]);
      await db.query(`INSERT INTO outbox_events(aggregate_type,aggregate_id,event_type,payload) VALUES('Event',$1,'EventCreated',$2)`, [row.id,JSON.stringify({ teamSeasonId, type: body.type, startsAt: body.startsAt })]);
      return row;
    });
    return reply.code(201).send(event);
  });

  app.get("/v1/team-seasons/:teamSeasonId/events", async (request) => {
    const { userId } = await actor(request);
    const { teamSeasonId } = z.object({ teamSeasonId: uuid }).parse(request.params);
    const query = z.object({ from: z.string().datetime().optional(), to: z.string().datetime().optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }).parse(request.query);
    await requireRole(pool, userId, teamSeasonId, ["COACH", "STAFF", "GUARDIAN"]);
    const result = await pool.query(
      `SELECT * FROM events WHERE team_season_id=$1 AND ($2::timestamptz IS NULL OR starts_at >= $2) AND ($3::timestamptz IS NULL OR starts_at < $3)
       ORDER BY starts_at LIMIT $4`, [teamSeasonId,query.from ?? null,query.to ?? null,query.limit]
    );
    return { items: result.rows };
  });

  app.get("/v1/events/:eventId", async (request) => {
    const { userId } = await actor(request);
    const { eventId } = z.object({ eventId: uuid }).parse(request.params);
    const found = await pool.query(`SELECT * FROM events WHERE id=$1`, [eventId]);
    if (!found.rowCount) throw new DomainError("PLAYER_NOT_ACCESSIBLE", 404, "Event not found");
    await requireRole(pool,userId,found.rows[0].team_season_id,["COACH","STAFF","GUARDIAN"]);
    return found.rows[0];
  });

  app.patch("/v1/events/:eventId", async (request) => {
    const { userId } = await actor(request);
    const { eventId } = z.object({ eventId: uuid }).parse(request.params);
    const body = eventInput.partial().extend({ expectedVersion: z.number().int().positive() }).parse(request.body);
    return inTransaction(async (db) => {
      const found = await db.query(`SELECT * FROM events WHERE id=$1 FOR UPDATE`,[eventId]);
      if (!found.rowCount) throw new DomainError("PLAYER_NOT_ACCESSIBLE",404,"Event not found");
      const row = found.rows[0];
      await requireRole(db,userId,row.team_season_id,["COACH","STAFF"]);
      if (row.status !== "ACTIVE") throw new DomainError("EVENT_NOT_ACTIVE",409,"Event is not active");
      if (row.version !== body.expectedVersion) throw new DomainError("EVENT_VERSION_CONFLICT",409,"Event version conflict");
      const next = { type: body.type ?? row.type,title:body.title ?? row.title,startsAt:body.startsAt ?? row.starts_at,arrivalAt:body.arrivalAt ?? row.arrival_at,endsAt:body.endsAt ?? row.ends_at,location:body.location ?? row.location,notes:body.notes ?? row.notes,availabilityEnabled:body.availabilityEnabled ?? row.availability_enabled,availabilityDeadline:body.availabilityDeadline ?? row.availability_deadline,callupEnabled:body.callupEnabled ?? row.callup_enabled };
      const updated = await db.query(`UPDATE events SET type=$2,title=$3,starts_at=$4,arrival_at=$5,ends_at=$6,location=$7,notes=$8,availability_enabled=$9,availability_deadline=$10,callup_enabled=$11,version=version+1,updated_at=now() WHERE id=$1 RETURNING *`,[eventId,next.type,next.title,next.startsAt,next.arrivalAt,next.endsAt,next.location,next.notes,next.availabilityEnabled,next.availabilityDeadline,next.callupEnabled]);
      await db.query(`INSERT INTO audit_events(actor_user_id,team_season_id,action,entity_type,entity_id,metadata) VALUES($1,$2,'EVENT_UPDATED','Event',$3,$4)`,[userId,row.team_season_id,eventId,JSON.stringify({ version: row.version+1 })]);
      await db.query(`INSERT INTO outbox_events(aggregate_type,aggregate_id,event_type,payload) VALUES('Event',$1,'EventUpdated',$2)`,[eventId,JSON.stringify({ version: row.version+1 })]);
      return updated.rows[0];
    });
  });

  async function closeEvent(eventId: string,userId: string,status: "CANCELLED"|"COMPLETED") {
    return inTransaction(async (db) => {
      const found = await db.query(`SELECT * FROM events WHERE id=$1 FOR UPDATE`,[eventId]);
      if (!found.rowCount) throw new DomainError("PLAYER_NOT_ACCESSIBLE",404,"Event not found");
      const row=found.rows[0];
      await requireRole(db,userId,row.team_season_id,["COACH","STAFF"]);
      if(row.status!=="ACTIVE") throw new DomainError("EVENT_NOT_ACTIVE",409,"Event is not active");
      const updated=await db.query(`UPDATE events SET status=$2,version=version+1,updated_at=now(),availability_closed_at=COALESCE(availability_closed_at,now()) WHERE id=$1 RETURNING *`,[eventId,status]);
      if(status==="CANCELLED") await db.query(`UPDATE action_items SET status='CANCELLED',resolved_at=now(),resolved_by_user_id=$2 WHERE event_id=$1 AND status='OPEN'`,[eventId,userId]);
      const action=status==="CANCELLED"?"EVENT_CANCELLED":"EVENT_COMPLETED";
      const eventType=status==="CANCELLED"?"EventCancelled":"EventCompleted";
      await db.query(`INSERT INTO audit_events(actor_user_id,team_season_id,action,entity_type,entity_id) VALUES($1,$2,$3,'Event',$4)`,[userId,row.team_season_id,action,eventId]);
      await db.query(`INSERT INTO outbox_events(aggregate_type,aggregate_id,event_type,payload) VALUES('Event',$1,$2,$3)`,[eventId,eventType,JSON.stringify({ teamSeasonId: row.team_season_id })]);
      return updated.rows[0];
    });
  }
  app.post("/v1/events/:eventId/cancel", async (request) => { const {userId}=await actor(request); const {eventId}=z.object({eventId:uuid}).parse(request.params); return closeEvent(eventId,userId,"CANCELLED"); });
  app.post("/v1/events/:eventId/complete", async (request) => { const {userId}=await actor(request); const {eventId}=z.object({eventId:uuid}).parse(request.params); return closeEvent(eventId,userId,"COMPLETED"); });

  async function evaluateSelections(db: typeof pool | import("pg").PoolClient, eventId: string, teamSeasonId: string, playerIds: string[]) {
    if (new Set(playerIds).size !== playerIds.length) throw new DomainError("IDEMPOTENCY_CONFLICT",400,"Duplicate player selection");
    const eligible = await db.query(
      `SELECT p.id,COALESCE(ar.status::text,'NO_RESPONSE') availability
       FROM players p JOIN roster_entries re ON re.player_id=p.id AND re.team_season_id=$2 AND re.status='ACTIVE'
       LEFT JOIN availability_responses ar ON ar.player_id=p.id AND ar.event_id=$1
       WHERE p.id=ANY($3::uuid[]) AND p.active=true`,[eventId,teamSeasonId,playerIds]
    );
    if(eligible.rowCount!==playerIds.length) throw new DomainError("PLAYER_NOT_IN_TEAMSEASON",422,"Every selected player must be active in this team season");
    const cannot=eligible.rows.find((row)=>row.availability==="CANNOT_ATTEND");
    if(cannot) throw new DomainError("PLAYER_CANNOT_ATTEND",422,`Player ${cannot.id} cannot attend`);
    return eligible.rows.filter((row)=>row.availability==="UNSURE"||row.availability==="NO_RESPONSE").map((row)=>({ code: row.availability==="UNSURE"?"PLAYER_UNSURE":"PLAYER_NO_RESPONSE",playerId:row.id,key:`${row.availability==="UNSURE"?"PLAYER_UNSURE":"PLAYER_NO_RESPONSE"}:${row.id}` }));
  }

  app.post("/v1/events/:eventId/callup", async(request,reply)=>{
    const {userId}=await actor(request); const {eventId}=z.object({eventId:uuid}).parse(request.params);
    const {playerIds}=z.object({playerIds:z.array(uuid).min(1)}).parse(request.body);
    const result=await inTransaction(async(db)=>{
      const event=(await db.query(`SELECT * FROM events WHERE id=$1 FOR UPDATE`,[eventId])).rows[0];
      if(!event) throw new DomainError("PLAYER_NOT_ACCESSIBLE",404,"Event not found");
      await requireRole(db,userId,event.team_season_id,["COACH","STAFF"]);
      if(event.status!=="ACTIVE") throw new DomainError("EVENT_NOT_ACTIVE",409,"Event is not active");
      if(!event.callup_enabled) throw new DomainError("CALLUP_NOT_ENABLED",422,"Callup is not enabled");
      const warnings=await evaluateSelections(db,eventId,event.team_season_id,playerIds);
      const callup=await db.query(`INSERT INTO callups(event_id,team_season_id,created_by_user_id) VALUES($1,$2,$3) RETURNING *`,[eventId,event.team_season_id,userId]);
      for(const playerId of playerIds) await db.query(`INSERT INTO callup_draft_selections(callup_id,player_id) VALUES($1,$2)`,[callup.rows[0].id,playerId]);
      return { ...callup.rows[0],playerIds,warnings };
    });
    return reply.code(201).send(result);
  });

  app.patch("/v1/callups/:callupId/draft",async(request)=>{
    const {userId}=await actor(request); const {callupId}=z.object({callupId:uuid}).parse(request.params);
    const body=z.object({playerIds:z.array(uuid).min(1),expectedVersion:z.number().int().positive()}).parse(request.body);
    return inTransaction(async(db)=>{
      const callup=(await db.query(`SELECT c.*,e.status event_status,e.callup_enabled FROM callups c JOIN events e ON e.id=c.event_id WHERE c.id=$1 FOR UPDATE`,[callupId])).rows[0];
      if(!callup) throw new DomainError("PLAYER_NOT_ACCESSIBLE",404,"Callup not found");
      await requireRole(db,userId,callup.team_season_id,["COACH","STAFF"]);
      if(callup.status!=="DRAFT"||callup.event_status!=="ACTIVE") throw new DomainError("EVENT_NOT_ACTIVE",409,"Draft cannot be changed");
      if(callup.version!==body.expectedVersion) throw new DomainError("CALLUP_VERSION_CONFLICT",409,"Callup version conflict");
      const warnings=await evaluateSelections(db,callup.event_id,callup.team_season_id,body.playerIds);
      await db.query(`DELETE FROM callup_draft_selections WHERE callup_id=$1`,[callupId]);
      for(const playerId of body.playerIds) await db.query(`INSERT INTO callup_draft_selections(callup_id,player_id) VALUES($1,$2)`,[callupId,playerId]);
      const updated=(await db.query(`UPDATE callups SET version=version+1,updated_at=now() WHERE id=$1 RETURNING *`,[callupId])).rows[0];
      return {...updated,playerIds:body.playerIds,warnings};
    });
  });

  app.post("/v1/callups/:callupId/publish",async(request)=>{
    const {userId}=await actor(request); const {callupId}=z.object({callupId:uuid}).parse(request.params);
    const body=z.object({expectedVersion:z.number().int().positive(),confirmWarnings:z.array(z.string()).default([])}).parse(request.body);
    const key=typeof request.headers["idempotency-key"]==="string"?request.headers["idempotency-key"]:undefined;
    return inTransaction(async(db)=>{
      const callup=(await db.query(`SELECT c.*,e.status event_status FROM callups c JOIN events e ON e.id=c.event_id WHERE c.id=$1 FOR UPDATE`,[callupId])).rows[0];
      if(!callup) throw new DomainError("PLAYER_NOT_ACCESSIBLE",404,"Callup not found");
      await requireRole(db,userId,callup.team_season_id,["COACH","STAFF"]);
      if(callup.status==="PUBLISHED"&&key&&callup.last_idempotency_key===key) return {...callup,idempotentReplay:true};
      if(callup.status!=="DRAFT"||callup.event_status!=="ACTIVE") throw new DomainError("EVENT_NOT_ACTIVE",409,"Callup cannot be published");
      if(callup.version!==body.expectedVersion) throw new DomainError("CALLUP_VERSION_CONFLICT",409,"Callup version conflict");
      const selections=(await db.query(`SELECT player_id FROM callup_draft_selections WHERE callup_id=$1 ORDER BY player_id`,[callupId])).rows.map(r=>r.player_id);
      const warnings=await evaluateSelections(db,callup.event_id,callup.team_season_id,selections);
      const missing=warnings.filter(w=>!body.confirmWarnings.includes(w.key));
      if(missing.length) throw new DomainError("CALLUP_WARNINGS_UNCONFIRMED",422,JSON.stringify(missing));
      const revision=(await db.query(`INSERT INTO callup_revisions(callup_id,revision_number,origin,actor_user_id) VALUES($1,1,'INITIAL_PUBLICATION',$2) RETURNING *`,[callupId,userId])).rows[0];
      for(const playerId of selections) await db.query(`INSERT INTO callup_selections(revision_id,player_id) VALUES($1,$2)`,[revision.id,playerId]);
      const updated=(await db.query(`UPDATE callups SET status='PUBLISHED',current_revision_number=1,version=version+1,updated_at=now(),last_idempotency_key=$2 WHERE id=$1 RETURNING *`,[callupId,key??null])).rows[0];
      await db.query(`INSERT INTO audit_events(actor_user_id,team_season_id,action,entity_type,entity_id,metadata) VALUES($1,$2,'CALLUP_PUBLISHED','Callup',$3,$4)`,[userId,callup.team_season_id,callupId,JSON.stringify({revision:1,count:selections.length})]);
      await db.query(`INSERT INTO outbox_events(aggregate_type,aggregate_id,event_type,payload) VALUES('Callup',$1,'CallupPublished',$2)`,[callupId,JSON.stringify({eventId:callup.event_id,revision:1,playerIds:selections})]);
      return {...updated,revision,playerIds:selections,warnings,idempotentReplay:false};
    });
  });

  app.post("/v1/callups/:callupId/revisions",async(request)=>{
    const {userId}=await actor(request); const {callupId}=z.object({callupId:uuid}).parse(request.params);
    const body=z.object({playerIds:z.array(uuid).min(1),expectedRevision:z.number().int().positive(),confirmWarnings:z.array(z.string()).default([])}).parse(request.body);
    return inTransaction(async(db)=>{
      const callup=(await db.query(`SELECT c.*,e.status event_status FROM callups c JOIN events e ON e.id=c.event_id WHERE c.id=$1 FOR UPDATE`,[callupId])).rows[0];
      if(!callup) throw new DomainError("PLAYER_NOT_ACCESSIBLE",404,"Callup not found");
      await requireRole(db,userId,callup.team_season_id,["COACH","STAFF"]);
      if(callup.status!=="PUBLISHED"||callup.event_status!=="ACTIVE") throw new DomainError("EVENT_NOT_ACTIVE",409,"Published callup cannot be revised");
      if(callup.current_revision_number!==body.expectedRevision) throw new DomainError("CALLUP_VERSION_CONFLICT",409,"Callup revision conflict");
      const warnings=await evaluateSelections(db,callup.event_id,callup.team_season_id,body.playerIds);
      if(warnings.some(w=>!body.confirmWarnings.includes(w.key))) throw new DomainError("CALLUP_WARNINGS_UNCONFIRMED",422,"Warnings require confirmation");
      const next=callup.current_revision_number+1;
      const revision=(await db.query(`INSERT INTO callup_revisions(callup_id,revision_number,origin,actor_user_id) VALUES($1,$2,'MANUAL_UPDATE',$3) RETURNING *`,[callupId,next,userId])).rows[0];
      for(const playerId of body.playerIds) await db.query(`INSERT INTO callup_selections(revision_id,player_id) VALUES($1,$2)`,[revision.id,playerId]);
      await db.query(`UPDATE callups SET current_revision_number=$2,version=version+1,updated_at=now() WHERE id=$1`,[callupId,next]);
      await db.query(`INSERT INTO audit_events(actor_user_id,team_season_id,action,entity_type,entity_id,metadata) VALUES($1,$2,'CALLUP_REVISED','Callup',$3,$4)`,[userId,callup.team_season_id,callupId,JSON.stringify({revision:next,origin:"MANUAL_UPDATE"})]);
      await db.query(`INSERT INTO outbox_events(aggregate_type,aggregate_id,event_type,payload) VALUES('Callup',$1,'CallupRevised',$2)`,[callupId,JSON.stringify({revision:next,playerIds:body.playerIds})]);
      return {callupId,revisionNumber:next,playerIds:body.playerIds,warnings};
    });
  });

  app.get("/v1/callups/:callupId",async(request)=>{
    const {userId}=await actor(request); const {callupId}=z.object({callupId:uuid}).parse(request.params);
    const callup=(await pool.query(`SELECT * FROM callups WHERE id=$1`,[callupId])).rows[0];
    if(!callup) throw new DomainError("PLAYER_NOT_ACCESSIBLE",404,"Callup not found");
    await requireRole(pool,userId,callup.team_season_id,["COACH","STAFF"]);
    const revisions=await pool.query(`SELECT r.id,r.revision_number,r.origin,r.actor_user_id,r.created_at,array_agg(s.player_id ORDER BY s.player_id) player_ids FROM callup_revisions r JOIN callup_selections s ON s.revision_id=r.id WHERE r.callup_id=$1 GROUP BY r.id ORDER BY r.revision_number`,[callupId]);
    return {...callup,revisions:revisions.rows};
  });

  app.post("/v1/callups/:callupId/cancel",async(request)=>{
    const {userId}=await actor(request); const {callupId}=z.object({callupId:uuid}).parse(request.params);
    return inTransaction(async(db)=>{
      const callup=(await db.query(`SELECT c.*,e.status event_status FROM callups c JOIN events e ON e.id=c.event_id WHERE c.id=$1 FOR UPDATE`,[callupId])).rows[0];
      if(!callup) throw new DomainError("PLAYER_NOT_ACCESSIBLE",404,"Callup not found");
      await requireRole(db,userId,callup.team_season_id,["COACH","STAFF"]);
      if(callup.event_status!=="ACTIVE"||callup.status==="CANCELLED") throw new DomainError("EVENT_NOT_ACTIVE",409,"Callup cannot be cancelled");
      const updated=(await db.query(`UPDATE callups SET status='CANCELLED',version=version+1,updated_at=now() WHERE id=$1 RETURNING *`,[callupId])).rows[0];
      await db.query(`UPDATE action_items SET status='CANCELLED',resolved_at=now(),resolved_by_user_id=$2 WHERE event_id=$1 AND status='OPEN'`,[callup.event_id,userId]);
      await db.query(`INSERT INTO audit_events(actor_user_id,team_season_id,action,entity_type,entity_id) VALUES($1,$2,'CALLUP_CANCELLED','Callup',$3)`,[userId,callup.team_season_id,callupId]);
      await db.query(`INSERT INTO outbox_events(aggregate_type,aggregate_id,event_type,payload) VALUES('Callup',$1,'CallupCancelled',$2)`,[callupId,JSON.stringify({eventId:callup.event_id})]);
      return updated;
    });
  });

  app.get("/v1/events/:eventId/players/:playerId/callup-status",async(request)=>{
    const {userId}=await actor(request); const params=z.object({eventId:uuid,playerId:uuid}).parse(request.params);
    const event=await eventContext(params.eventId,params.playerId);
    await requireGuardianPlayerAccess(pool,userId,event.team_season_id,params.playerId);
    const result=await pool.query(`SELECT c.status,c.current_revision_number,EXISTS(SELECT 1 FROM callup_revisions r JOIN callup_selections s ON s.revision_id=r.id WHERE r.callup_id=c.id AND r.revision_number=c.current_revision_number AND s.player_id=$2) called FROM callups c WHERE c.event_id=$1 AND c.status='PUBLISHED'`,[params.eventId,params.playerId]);
    return {event:{id:event.id,title:event.title,startsAt:event.starts_at,arrivalAt:event.arrival_at,location:event.location},called:result.rowCount?result.rows[0].called:false,revision:result.rowCount?result.rows[0].current_revision_number:null};
  });

  app.get("/v1/team-seasons/:teamSeasonId/pending",async(request)=>{
    const {userId}=await actor(request); const {teamSeasonId}=z.object({teamSeasonId:uuid}).parse(request.params);
    await requireRole(pool,userId,teamSeasonId,["COACH","STAFF"]);
    const items=await pool.query(`SELECT ai.*,p.first_name,p.last_name,e.title event_title FROM action_items ai LEFT JOIN players p ON p.id=ai.player_id JOIN events e ON e.id=ai.event_id WHERE ai.team_season_id=$1 AND ai.status='OPEN' ORDER BY ai.created_at`,[teamSeasonId]);
    const indicators=await pool.query(`SELECT e.id event_id,e.title,count(re.player_id) FILTER(WHERE ar.id IS NULL) no_response FROM events e JOIN roster_entries re ON re.team_season_id=e.team_season_id AND re.status='ACTIVE' LEFT JOIN availability_responses ar ON ar.event_id=e.id AND ar.player_id=re.player_id WHERE e.team_season_id=$1 AND e.status='ACTIVE' AND e.availability_enabled=true GROUP BY e.id ORDER BY e.starts_at`,[teamSeasonId]);
    return {actionItems:items.rows,indicators:indicators.rows};
  });

  app.get("/v1/action-items/:actionItemId/replacement-candidates",async(request)=>{
    const {userId}=await actor(request); const {actionItemId}=z.object({actionItemId:uuid}).parse(request.params);
    const item=(await pool.query(`SELECT * FROM action_items WHERE id=$1`,[actionItemId])).rows[0];
    if(!item) throw new DomainError("PLAYER_NOT_ACCESSIBLE",404,"Action item not found");
    await requireRole(pool,userId,item.team_season_id,["COACH","STAFF"]);
    if(item.status!=="OPEN") throw new DomainError("ACTION_ITEM_NOT_OPEN",409,"Action item is not open");
    const result=await pool.query(
      `SELECT p.id,p.first_name,p.last_name,re.shirt_number FROM players p JOIN roster_entries re ON re.player_id=p.id AND re.team_season_id=$2 AND re.status='ACTIVE'
       JOIN availability_responses ar ON ar.player_id=p.id AND ar.event_id=$1 AND ar.status='CAN_ATTEND'
       WHERE p.active=true AND NOT EXISTS(
         SELECT 1 FROM callups c JOIN callup_revisions cr ON cr.callup_id=c.id AND cr.revision_number=c.current_revision_number JOIN callup_selections cs ON cs.revision_id=cr.id WHERE c.event_id=$1 AND cs.player_id=p.id
       ) ORDER BY p.first_name,p.last_name,p.id`,[item.event_id,item.team_season_id]
    );
    const callup=await pool.query(`SELECT id,current_revision_number FROM callups WHERE event_id=$1 AND status='PUBLISHED'`,[item.event_id]);
    return {actionItemId,callupId:callup.rows[0]?.id,currentRevision:callup.rows[0]?.current_revision_number,items:result.rows};
  });

  app.post("/v1/action-items/:actionItemId/replace",async(request)=>{
    const {userId}=await actor(request); const {actionItemId}=z.object({actionItemId:uuid}).parse(request.params);
    const body=z.object({substitutePlayerId:uuid,expectedCallupRevision:z.number().int().positive()}).parse(request.body);
    return inTransaction(async(db)=>{
      const item=(await db.query(`SELECT * FROM action_items WHERE id=$1 FOR UPDATE`,[actionItemId])).rows[0];
      if(!item) throw new DomainError("PLAYER_NOT_ACCESSIBLE",404,"Action item not found");
      await requireRole(db,userId,item.team_season_id,["COACH","STAFF"]);
      if(item.status!=="OPEN") throw new DomainError("ACTION_ITEM_NOT_OPEN",409,"Action item is not open");
      const callup=(await db.query(`SELECT c.*,e.status event_status FROM callups c JOIN events e ON e.id=c.event_id WHERE c.event_id=$1 FOR UPDATE`,[item.event_id])).rows[0];
      if(!callup||callup.status!=="PUBLISHED"||callup.event_status!=="ACTIVE") throw new DomainError("EVENT_NOT_ACTIVE",409,"Callup is not active");
      if(callup.current_revision_number!==body.expectedCallupRevision) throw new DomainError("CALLUP_VERSION_CONFLICT",409,"Callup revision conflict");
      const current=(await db.query(`SELECT s.player_id FROM callup_revisions r JOIN callup_selections s ON s.revision_id=r.id WHERE r.callup_id=$1 AND r.revision_number=$2`,[callup.id,callup.current_revision_number])).rows.map(r=>r.player_id as string);
      if(!current.includes(item.player_id)) throw new DomainError("ACTION_ITEM_NOT_OPEN",409,"Affected player is no longer selected");
      const eligible=await db.query(`SELECT 1 FROM players p JOIN roster_entries re ON re.player_id=p.id AND re.team_season_id=$2 AND re.status='ACTIVE' JOIN availability_responses ar ON ar.player_id=p.id AND ar.event_id=$3 AND ar.status='CAN_ATTEND' WHERE p.id=$1 AND p.active=true`,[body.substitutePlayerId,item.team_season_id,item.event_id]);
      if(!eligible.rowCount||current.includes(body.substitutePlayerId)) throw new DomainError("SUBSTITUTE_NO_LONGER_ELIGIBLE",409,"Substitute is no longer eligible");
      const next=callup.current_revision_number+1;
      const revision=(await db.query(`INSERT INTO callup_revisions(callup_id,revision_number,origin,actor_user_id) VALUES($1,$2,'REPLACEMENT',$3) RETURNING id`,[callup.id,next,userId])).rows[0];
      for(const playerId of current.filter(id=>id!==item.player_id).concat(body.substitutePlayerId)) await db.query(`INSERT INTO callup_selections(revision_id,player_id) VALUES($1,$2)`,[revision.id,playerId]);
      await db.query(`UPDATE callups SET current_revision_number=$2,version=version+1,updated_at=now() WHERE id=$1`,[callup.id,next]);
      await db.query(`UPDATE action_items SET status='RESOLVED',resolved_at=now(),resolved_by_user_id=$2 WHERE id=$1`,[actionItemId,userId]);
      await db.query(`INSERT INTO audit_events(actor_user_id,team_season_id,action,entity_type,entity_id,metadata) VALUES
        ($1,$2,'CALLUP_PLAYER_REPLACED','Callup',$3,$4),($1,$2,'ACTION_ITEM_RESOLVED','ActionItem',$5,$4)`,[userId,item.team_season_id,callup.id,JSON.stringify({revision:next,removedPlayerId:item.player_id,addedPlayerId:body.substitutePlayerId}),actionItemId]);
      await db.query(`INSERT INTO outbox_events(aggregate_type,aggregate_id,event_type,payload) VALUES
        ('Callup',$1,'CallupRevised',$2),('Callup',$1,'CallupPlayerReplaced',$2),('ActionItem',$3,'ActionItemResolved',$2)`,[callup.id,JSON.stringify({revision:next,removedPlayerId:item.player_id,addedPlayerId:body.substitutePlayerId}),actionItemId]);
      return {callupId:callup.id,revisionNumber:next,removedPlayerId:item.player_id,addedPlayerId:body.substitutePlayerId,actionItemId,status:"RESOLVED"};
    });
  });

  return app;
}
