import { setTimeout as delay } from "node:timers/promises";
import { createWorkerPool, runBatch, verifyWorkerIdentity } from "./worker.js";

const pollMs = Number(process.env.OUTBOX_POLL_MS ?? "1000");
if (!Number.isInteger(pollMs) || pollMs < 100 || pollMs > 60_000) throw new Error("OUTBOX_POLL_MS must be 100..60000");
const pool = createWorkerPool();
const stop = new AbortController();
process.once("SIGTERM",()=>stop.abort());
process.once("SIGINT",()=>stop.abort());
try {
  await verifyWorkerIdentity(pool);
  while (!stop.signal.aborted) {
    try {
      const result = await runBatch(pool);
      if (result.claimed) console.log(JSON.stringify({event:"outbox.batch",...result}));
      if (result.claimed === 20) continue;
    } catch {
      console.error(JSON.stringify({event:"outbox.batch_failed",error:"TRANSACTION_FAILED"}));
    }
    await delay(pollMs,undefined,{signal:stop.signal}).catch(error=>{if(!stop.signal.aborted) throw error;});
  }
} finally { await pool.end(); }
