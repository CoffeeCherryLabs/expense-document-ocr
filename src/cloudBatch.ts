import type {BatchLock} from "./cloudLock.js"
type Metrics={scanned:number;processed:number;failed:number;reviewed:number;organized:number;summaryGroups?:number;summaryUpdated?:number;dashboardUpdated?:number}
export async function runLockedBatch(lock:BatchLock,owner:string,sync:()=>Promise<Metrics>){
  const generation=await lock.acquire(owner)
  if(generation===null)return {status:"busy" as const}
  // Deliberately no finally: errors, failures, timeout or termination must retain the lock.
  const result=await sync()
  if(result.failed!==0 || result.organized!==0)throw new Error("Batch requires reconciliation; lock retained")
  await lock.release(generation)
  // Explicit allowlist prevents future receipt fields from leaking into Cloud Logging.
  return {status:"completed" as const,scanned:result.scanned,processed:result.processed,failed:result.failed,
    reviewed:result.reviewed,organized:result.organized,summaryGroups:result.summaryGroups,
    summaryUpdated:result.summaryUpdated,dashboardUpdated:result.dashboardUpdated}
}
