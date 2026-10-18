import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import tls, { type TLSSocket } from "node:tls";
import type { AddressInfo } from "node:net";
import nodemailer, { type Transporter } from "nodemailer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ProductionAuthAdapter } from "../../src/auth/production.js";
import { buildApp } from "../../src/app.js";
import { authPool, pool, rawPool } from "../../src/db/pool.js";

// Test-only SMTPS sink: nothing leaves loopback, no SMTP service subscription.
// A generated CA is trusted ONLY by the injected test transport, never production.
let temporaryDirectory: string;
let server: tls.Server;
let transport: Transporter;
let port: number;
const sockets = new Set<TLSSocket>();
const messages: { recipient: string; body: string; encrypted: boolean }[] = [];

beforeAll(async()=>{
  temporaryDirectory=await mkdtemp(join(tmpdir(),"talde-smtps-test-"));
  execFileSync("openssl",["req","-x509","-newkey","rsa:2048","-nodes","-days","1","-subj","/CN=localhost","-addext","subjectAltName=DNS:localhost,IP:127.0.0.1","-keyout",join(temporaryDirectory,"key.pem"),"-out",join(temporaryDirectory,"cert.pem")],{stdio:"ignore",timeout:15000});
  const key=await readFile(join(temporaryDirectory,"key.pem"));
  const cert=await readFile(join(temporaryDirectory,"cert.pem"));
  server=tls.createServer({key,cert,minVersion:"TLSv1.2"},socket=>{
    sockets.add(socket);socket.setTimeout(10000,()=>socket.destroy());
    socket.on("close",()=>sockets.delete(socket));socket.on("error",()=>{});
    let pending="";let inData=false;let recipient="";let body:string[]=[];
    socket.setEncoding("utf8");socket.write("220 localhost Talde test SMTP ready\r\n");
    socket.on("data",chunk=>{
      pending+=chunk;
      let end:number;
      while((end=pending.indexOf("\r\n"))>=0){
        const line=pending.slice(0,end);pending=pending.slice(end+2);
        if(inData){
          if(line==="."){
            messages.push({recipient,body:body.join("\r\n"),encrypted:socket.encrypted});body=[];inData=false;
            socket.write("250 2.0.0 Message stored locally\r\n");
          }else body.push(line.startsWith("..")?line.slice(1):line);
        }else if(/^EHLO\b|^HELO\b/i.test(line))socket.write("250-localhost\r\n250 SIZE 1000000\r\n");
        else if(/^MAIL FROM:/i.test(line))socket.write("250 2.1.0 Sender accepted\r\n");
        else if(/^RCPT TO:/i.test(line)){recipient=line.slice(8).trim().replace(/^<|>$/g,"");socket.write("250 2.1.5 Recipient accepted\r\n");}
        else if(/^DATA$/i.test(line)){inData=true;socket.write("354 End with a dot\r\n");}
        else if(/^QUIT$/i.test(line)){socket.end("221 2.0.0 Bye\r\n");}
        else if(/^RSET$|^NOOP$/i.test(line))socket.write("250 OK\r\n");
        else socket.write("502 Command not implemented\r\n");
      }
    });
  });
  server.on("tlsClientError",()=>{});
  await new Promise<void>((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",()=>{server.off("error",reject);resolve();});});
  port=(server.address() as AddressInfo).port;
  transport=nodemailer.createTransport({host:"127.0.0.1",port,secure:true,requireTLS:true,
    tls:{ca:cert,servername:"localhost",rejectUnauthorized:true,minVersion:"TLSv1.2"},
    connectionTimeout:3000,greetingTimeout:3000,socketTimeout:3000});
},20000);

afterAll(async()=>{
  transport?.close();
  for(const socket of sockets)socket.destroy();
  if(server?.listening)await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  await Promise.allSettled([authPool.end(),pool.end(),rawPool.end()]);
  if(temporaryDirectory)await rm(temporaryDirectory,{recursive:true,force:true});
});

describe("Real local SMTPS production authentication transport",()=>{
  it("delivers over verified TLS and completes HTTP OTP login without exposing the code",async()=>{
    const secret="smtp-test-only-signing-key-79cb6834ff71907dd0b8";
    const adapter=new ProductionAuthAdapter({delivery:transport,secret,from:"auth@example.test"});
    const app=await buildApp({authAdapter:adapter});
    try{
      const email=`smtp-${randomUUID()}@example.test`;
      const response=await app.inject({method:"POST",url:"/v1/auth/otp/request",payload:{email}});
      expect(response.statusCode).toBe(200);
      const request=response.json();
      expect(Object.keys(request)).toEqual(["challengeId"]);
      const delivered=messages.find(message=>message.recipient===email);
      expect(delivered).toBeDefined();expect(delivered!.encrypted).toBe(true);
      const code=delivered!.body.match(/\b\d{6}\b/)?.[0];
      expect(code).toMatch(/^\d{6}$/);
      const verified=await app.inject({method:"POST",url:"/v1/auth/otp/verify",payload:{email,challengeId:request.challengeId,otp:code,displayName:"SMTP delivery test"}});
      expect(verified.statusCode).toBe(200);
      const result=verified.json();
      expect(result.user.email).toBe(email);expect(result.user.display_name).toBe("SMTP delivery test");
      expect(adapter.verifyAccessToken(result.accessToken)).toEqual({userId:result.user.id});
      const replay=await app.inject({method:"POST",url:"/v1/auth/otp/verify",payload:{email,challengeId:request.challengeId,otp:code}});
      expect(replay.statusCode).toBe(401);
    }finally{await app.close();}
  },15000);
  it("rejects the test server certificate without an explicitly trusted test CA",async()=>{
    const untrusted=nodemailer.createTransport({host:"127.0.0.1",port,secure:true,
      tls:{rejectUnauthorized:true,servername:"localhost"},connectionTimeout:3000,greetingTimeout:3000,socketTimeout:3000});
    try{await expect(untrusted.verify()).rejects.toBeDefined();}finally{untrusted.close();}
  },10000);
});
