import { createHash } from "node:crypto";
import type pg from "pg";

const demo={
  coach:"70000000-0000-4000-8000-000000000001",guardian:"70000000-0000-4000-8000-000000000002",
  team:"71000000-0000-4000-8000-000000000001",season:"72000000-0000-4000-8000-000000000001",
  ibai:"73000000-0000-4000-8000-000000000001",event:"74000000-0000-4000-8000-000000000001"
};
const roster=[
  [demo.ibai,"Ibai","Aranguren",9],["73000000-0000-4000-8000-000000000002","Ane","Agirre",4],["73000000-0000-4000-8000-000000000003","Nahia","Etxeberria",6],["73000000-0000-4000-8000-000000000004","Irati","López",8],
  ...Array.from({length:14},(_,i)=>[`73000000-0000-4000-8000-${String(i+5).padStart(12,"0")}`,`Demo${i+5}`,"Indautxu",i+1] as const)
] as const;

export async function resetDemoDatabase(db:pg.PoolClient){
  await db.query(`TRUNCATE audit_events,outbox_events,action_items,callup_selections,callup_revisions,callup_draft_selections,callups,availability_history,availability_responses,events,guardian_links,guardian_link_requests,invitations,roster_entries,players,memberships,team_seasons,teams,users CASCADE`);
  await db.query(`INSERT INTO users(id,auth_subject,email,display_name) VALUES($1,'dev-email:mikel.demo@example.test','mikel.demo@example.test','Mikel Zubeldia'),($2,'dev-email:elena.demo@example.test','elena.demo@example.test','Elena Gómez')`,[demo.coach,demo.guardian]);
  await db.query(`INSERT INTO teams(id,name,sport) VALUES($1,'C.D. Indautxu','FOOTBALL')`,[demo.team]);
  await db.query(`INSERT INTO team_seasons(id,team_id,season_label,category,display_label,status,created_by_user_id,join_code) VALUES($1,$2,'2026/27','Infantil','Infantil A','ACTIVE',$3,'INDA16')`,[demo.season,demo.team,demo.coach]);
  await db.query(`INSERT INTO memberships(user_id,team_season_id,role,status) VALUES($1,$3,'COACH','ACTIVE'),($2,$3,'GUARDIAN','ACTIVE')`,[demo.coach,demo.guardian,demo.season]);
  for(const [id,first,last,number] of roster){await db.query(`INSERT INTO players(id,team_id,first_name,last_name) VALUES($1,$2,$3,$4)`,[id,demo.team,first,last]);await db.query(`INSERT INTO roster_entries(player_id,team_season_id,shirt_number,status) VALUES($1,$2,$3,'ACTIVE')`,[id,demo.season,number]);}
  await db.query(`INSERT INTO guardian_links(guardian_user_id,player_id,status) VALUES($1,$2,'ACTIVE')`,[demo.guardian,demo.ibai]);
  await db.query(`INSERT INTO invitations(team_season_id,player_id,purpose,token_hash,expires_at,created_by_user_id) VALUES($1,NULL,'GUARDIAN_LINK',$2,now()+interval '1 year',$3)`,[demo.season,createHash("sha256").update("INDA16").digest("hex"),demo.coach]);
  await db.query(`INSERT INTO events(id,team_season_id,title,type,starts_at,arrival_at,location,availability_enabled,availability_deadline,callup_enabled,status,created_by_user_id) VALUES($1,$2,'Torneo Oyón','TOURNAMENT','2026-10-10T08:00:00Z','2026-10-10T07:30:00Z','Oyón',true,'2026-10-08T20:00:00Z',true,'ACTIVE',$3)`,[demo.event,demo.season,demo.coach]);
  return {mode:"DEMO",team:{id:demo.team,name:"C.D. Indautxu"},teamSeason:{id:demo.season,displayLabel:"Infantil A",seasonLabel:"2026/27"},players:roster.length,joinCode:"INDA16"};
}
