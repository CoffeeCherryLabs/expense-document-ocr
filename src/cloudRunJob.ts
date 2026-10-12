import {syncDrive} from "./driveSync.js"
import {StorageBatchLock,metadataToken} from "./cloudLock.js"
import {runLockedBatch} from "./cloudBatch.js"
try{
  if(process.env.EXPENSE_SYNC_ENABLED!=="true" || process.env.DRIVE_ORGANIZE_ENABLED!=="false")throw new Error("Cloud batch flags invalid")
  const bucket=process.env.SYNC_LOCK_BUCKET,owner=process.env.CLOUD_RUN_EXECUTION
  if(!bucket || !owner)throw new Error("Cloud batch identity or lock missing")
  const result=await runLockedBatch(new StorageBatchLock(bucket,metadataToken),owner,()=>syncDrive({skipReviews:true}))
  console.log(JSON.stringify({severity:"INFO",event:"receipt_batch",...result}))
}catch{
  console.error(JSON.stringify({severity:"ERROR",event:"receipt_batch_failed",action:"inspect_execution_and_lock"}))
  process.exitCode=1
}
