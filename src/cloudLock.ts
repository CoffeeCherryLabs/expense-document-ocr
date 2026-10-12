export interface BatchLock {acquire(owner:string):Promise<string|null>;release(generation:string):Promise<void>}
type Token=()=>Promise<string>
/** Private GCS object, created atomically. No expiry or automatic lock stealing. */
export class StorageBatchLock implements BatchLock {
  constructor(private bucket:string,private token:Token){if(!/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/.test(bucket))throw new Error("Invalid lock bucket")}
  async acquire(owner:string):Promise<string|null>{
    const query=new URLSearchParams({uploadType:"media",name:"receipt-sync.lock",ifGenerationMatch:"0"})
    const response=await fetch(`https://storage.googleapis.com/upload/storage/v1/b/${this.bucket}/o?${query}`,{
      method:"POST",headers:{Authorization:`Bearer ${await this.token()}`,"Content-Type":"application/json"},
      body:JSON.stringify({owner,createdAt:new Date().toISOString()}),signal:AbortSignal.timeout(30000)
    })
    if(response.status===412)return null
    if(!response.ok)throw new Error("Lock acquisition failed")
    const data=await response.json() as {generation?:string}
    if(!data.generation || !/^\d+$/.test(data.generation))throw new Error("Lock generation unavailable")
    return data.generation
  }
  async release(generation:string):Promise<void>{
    if(!/^\d+$/.test(generation))throw new Error("Invalid lock generation")
    const response=await fetch(`https://storage.googleapis.com/storage/v1/b/${this.bucket}/o/receipt-sync.lock?ifGenerationMatch=${generation}`,{
      method:"DELETE",headers:{Authorization:`Bearer ${await this.token()}`},signal:AbortSignal.timeout(30000)
    })
    if(!response.ok)throw new Error("Lock release failed; reconcile lock")
  }
}
export async function metadataToken():Promise<string>{
  const response=await fetch("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",{
    headers:{"Metadata-Flavor":"Google"},signal:AbortSignal.timeout(10000)
  })
  if(!response.ok)throw new Error("Runtime identity unavailable")
  const data=await response.json() as {access_token?:string}
  if(!data.access_token)throw new Error("Runtime token unavailable")
  return data.access_token
}
