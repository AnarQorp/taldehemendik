import { buildApp } from "./app.js";
import { verifyRuntimeDatabase, verifyAuthDatabase, pool, authPool, rawPool } from "./db/pool.js";
import { config } from "./config.js";
try {
  const app = await buildApp();
  await verifyRuntimeDatabase();
  await verifyAuthDatabase();
  await app.listen({ host: process.env.HOST ?? "127.0.0.1", port: config.port });
  for (const signal of ["SIGTERM","SIGINT"] as const) process.once(signal,async()=>{
    await app.close(); await Promise.all([pool.end(),authPool.end(),rawPool.end()]);
  });
  console.log(JSON.stringify({event:"server.listening",port:config.port}));
} catch {
  console.error(JSON.stringify({event:"server.startup_failed",reason:"Check production configuration, database identities and migrations"}));
  await Promise.allSettled([pool.end(),authPool.end(),rawPool.end()]);
  process.exitCode=1;
}
