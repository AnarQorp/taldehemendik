import { execFileSync } from "node:child_process";
import { randomUUID, createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ProductionAuthAdapter, type OtpDelivery } from "../../src/auth/production.js";
import { authPool, rawPool } from "../../src/db/pool.js";

const secret = "tests-only-random-secret-726cb8d9718291dfdf15";
const delivered = new Map<string,string>();
const delivery: OtpDelivery = { async sendMail(message) { delivered.set(message.to, message.text.match(/\b\d{6}\b/)![0]); return {}; } };
const options = { pool: authPool, delivery, secret, from: "auth@example.test" };
const adapter = new ProductionAuthAdapter(options);
const mailbox = () => `otp-${randomUUID()}@example.test`;

beforeAll(async () => { await rawPool.query("SELECT 1 FROM auth_challenges LIMIT 1"); });
afterAll(async () => { await authPool.end(); await rawPool.end(); });

describe("Persistent production email OTP", () => {
  it("delivers real transport message, persists only hash and survives restart", async () => {
    const email = mailbox();
    const challenge = await adapter.requestOtp(email);
    expect(challenge).not.toHaveProperty("developmentOtp");
    const row = (await rawPool.query("SELECT * FROM auth_challenges WHERE id=$1", [challenge.challengeId])).rows[0];
    const code = delivered.get(email)!;
    expect(row.otp_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(row)).not.toContain(`"${code}"`);
    expect(await new ProductionAuthAdapter(options).verifyOtp(email, challenge.challengeId, code)).toEqual({ subject: `email:${email}`, email });
    await expect(adapter.verifyOtp(email, challenge.challengeId, code)).rejects.toMatchObject({ statusCode: 401 });
  });
  it("permits exactly one success across concurrent verification", async () => {
    const email=mailbox(); const {challengeId}=await adapter.requestOtp(email); const code=delivered.get(email)!;
    const results=await Promise.allSettled(Array.from({length:8},()=>new ProductionAuthAdapter(options).verifyOtp(email,challengeId,code)));
    expect(results.filter(result=>result.status==="fulfilled")).toHaveLength(1);
  });
  it("commits failed attempts and locks out after five, including malformed lengths", async () => {
    const email=mailbox(); const {challengeId}=await adapter.requestOtp(email); const code=delivered.get(email)!;
    for(let i=0;i<5;i++) await expect(adapter.verifyOtp(email,challengeId,"123456789")).rejects.toMatchObject({statusCode:401});
    await expect(adapter.verifyOtp(email,challengeId,code)).rejects.toMatchObject({statusCode:401});
    expect((await rawPool.query("SELECT attempts FROM auth_challenges WHERE id=$1",[challengeId])).rows[0].attempts).toBe(5);
  });
  it("rejects expired and wrong-mailbox challenges", async () => {
    const email=mailbox(); const {challengeId}=await adapter.requestOtp(email); const code=delivered.get(email)!;
    await expect(adapter.verifyOtp(mailbox(),challengeId,code)).rejects.toMatchObject({statusCode:401});
    await rawPool.query("UPDATE auth_challenges SET expires_at=now()-interval '1 second' WHERE id=$1",[challengeId]);
    await expect(adapter.verifyOtp(email,challengeId,code)).rejects.toMatchObject({statusCode:401});
  });
  it("serializes issuance and throttles concurrent requests per mailbox", async () => {
    const email=mailbox();
    const results=await Promise.allSettled(Array.from({length:4},()=>adapter.requestOtp(email)));
    expect(results.filter(result=>result.status==="fulfilled")).toHaveLength(1);
    expect((await rawPool.query("SELECT count(*)::int n FROM auth_challenges WHERE email=$1",[email])).rows[0].n).toBe(1);
  });
  it("revokes challenges on SMTP failure without exposing transport errors", async () => {
    const email=mailbox();
    const failed=new ProductionAuthAdapter({...options,delivery:{ async sendMail(){throw new Error("SMTP SECRET OTP BODY");} }});
    await expect(failed.requestOtp(email)).rejects.toMatchObject({statusCode:503,message:"Authentication email delivery is unavailable"});
    const row=(await rawPool.query("SELECT * FROM auth_challenges WHERE email=$1",[email])).rows[0];
    expect(row.consumed_at).not.toBeNull();
  });
  it("denies runtime roles direct access to OTP hashes and identity mapping", async () => {
    const db=await rawPool.connect();
    try {
      for(const role of ["talde_api","talde_worker"]){
        await db.query("BEGIN");await db.query(`SET LOCAL ROLE ${role}`);
        await expect(db.query("SELECT * FROM auth_challenges")).rejects.toMatchObject({code:"42501"});await db.query("ROLLBACK");
        await db.query("BEGIN");await db.query(`SET LOCAL ROLE ${role}`);
        await expect(db.query("SELECT * FROM resolve_auth_user($1,$2,$3)",["email:test@example.test","test@example.test","Test"])).rejects.toMatchObject({code:"42501"});await db.query("ROLLBACK");
      }
    }finally{db.release();}
  });
});

describe("Strict production access tokens",()=>{
  const userId=randomUUID();
  const sign=(claims:object)=>{const payload=Buffer.from(JSON.stringify(claims)).toString("base64url");return `${payload}.${createHmac("sha256",secret).update(payload).digest("base64url")}`;};
  it("accepts a valid token and rejects malformed/tampered inputs without exceptions",()=>{
    const token=adapter.issueAccessToken(userId);expect(adapter.verifyAccessToken(token)).toEqual({userId});
    for(const input of ["", ".",token+".extra",token+"x",token.slice(0,-1),"a.b", "a".repeat(3000)]) expect(()=>adapter.verifyAccessToken(input)).toThrowError("Invalid or expired authentication credential");
  });
  it("rejects wrong issuer/audience, expiry, future issue, invalid UUID and oversize lifetime",()=>{
    const iat=Math.floor(Date.now()/1000); const claims={sub:userId,iss:"talde-hemendik",aud:"talde-private-api",iat,exp:iat+3600};
    for(const bad of [{iss:"other"},{aud:"other"},{exp:iat-1},{iat:iat+100},{sub:"not-a-user"},{exp:iat+7200}]) expect(()=>adapter.verifyAccessToken(sign({...claims,...bad}))).toThrow();
  });
  it("expires issued tokens after one hour",()=>{
    const past=new ProductionAuthAdapter({...options,now:()=>Date.now()-3601000});
    expect(()=>adapter.verifyAccessToken(past.issueAccessToken(userId))).toThrow();
  });
});


describe("Production startup guards",()=>{
  const run=(code:string,overrides:Record<string,string>={})=>execFileSync(process.execPath,["--import","tsx","--input-type=module","-e",code],{
    cwd:process.cwd(),encoding:"utf8",timeout:15000,
    env:{...process.env,NODE_ENV:"production",DATABASE_URL:"",AUTH_DATABASE_URL:"",WORKER_DATABASE_URL:"",OUTBOX_DATABASE_URL:"",AUTH_TOKEN_SECRET:"",SMTP_HOST:"",SMTP_FROM:"",DEV_AUTH_EXPOSE_OTP:"false",DEV_RESET_ENABLED:"false",...overrides},stdio:"pipe"
  });
  it("forbids constructing development authentication even with explicit injection",()=>{
    expect(()=>run('import {DevelopmentAuthAdapter} from "./src/auth/development-adapter.ts";new DevelopmentAuthAdapter(true);')).toThrow();
  });
  it("fails closed instead of defaulting to demo credentials or SMTP",()=>{
    expect(()=>run('import {createAuthAdapter} from "./src/auth/production.ts";createAuthAdapter();')).toThrow();
  });
  it("forbids development flags even with otherwise valid production config",()=>{
    expect(()=>run('import {assertProductionConfiguration} from "./src/config.ts";assertProductionConfiguration();',{
      DATABASE_URL:"postgres://api@localhost/db",AUTH_DATABASE_URL:"postgres://auth@localhost/db",WORKER_DATABASE_URL:"postgres://worker@localhost/db",
      AUTH_TOKEN_SECRET:secret,SMTP_HOST:"smtp.example.test",SMTP_FROM:"auth@example.test",DEV_AUTH_EXPOSE_OTP:"true"
    })).toThrow();
  });
});
