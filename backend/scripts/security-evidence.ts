import { rawPool } from "../src/db/pool.js";
const tables=(await rawPool.query(`SELECT c.relname AS table_name,c.relrowsecurity AS enabled,c.relforcerowsecurity AS forced,
  pg_get_userbyid(c.relowner) owner FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind='r' ORDER BY c.relname`)).rows;
const roles=(await rawPool.query(`SELECT rolname,rolcanlogin,rolsuper,rolbypassrls,rolcreaterole,rolcreatedb FROM pg_roles
 WHERE rolname IN ('talde_api','talde_auth','talde_worker','talde_policy_owner','talde_auth_owner','proof_api','proof_auth','proof_worker') ORDER BY rolname`)).rows;
const policies=(await rawPool.query(`SELECT tablename,policyname,roles,cmd FROM pg_policies WHERE schemaname='public' ORDER BY tablename,policyname`)).rows;
const migrations=(await rawPool.query('SELECT name FROM schema_migrations ORDER BY name')).rows.map(row=>row.name);
console.log(JSON.stringify({tables,roles,policies,migrations},null,2));
await rawPool.end();
