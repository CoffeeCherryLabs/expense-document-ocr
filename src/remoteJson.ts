/** A Notion write may have committed even though its response was lost. */
export class AmbiguousMutationError extends Error {
  constructor(){super("Notion mutation outcome unknown; reconcile before retry");this.name="AmbiguousMutationError"}
}
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms))
export async function jsonRequest(url:string,init:RequestInit={}) {
  const retrySafe=!init.method || init.method==="GET" || url.endsWith("/query")
  const mutation=new URL(url).hostname==="api.notion.com" && !retrySafe
  for(let attempt=0;;attempt++){
    let response:Response
    try{response=await fetch(url,{...init,signal:AbortSignal.timeout(60000)})}
    catch(error){if(mutation)throw new AmbiguousMutationError();throw error}
    if((response.status===429 || response.status>=500) && retrySafe && attempt<3){await sleep(Math.min(10000,1000*2**attempt));continue}
    if(mutation && response.status>=500)throw new AmbiguousMutationError()
    if(!response.ok)throw new Error(`Remote API ${new URL(url).hostname}: HTTP ${response.status}`)
    try{return await response.json() as any}
    catch(error){if(mutation)throw new AmbiguousMutationError();throw error}
  }
}
