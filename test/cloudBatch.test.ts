import assert from "node:assert/strict"
import test from "node:test"
import {runLockedBatch} from "../src/cloudBatch.js"
import {StorageBatchLock} from "../src/cloudLock.js"
import {jsonRequest,AmbiguousMutationError} from "../src/remoteJson.js"
const metrics={scanned:39,processed:0,failed:0,reviewed:0,organized:0,summaryGroups:6,summaryUpdated:0,dashboardUpdated:1}
test("competing executions permit exactly one writer and release only its generation",async()=>{
  const oldFetch=globalThis.fetch;let held=false,writers=0,releases=0
  globalThis.fetch=async(input,init)=>{
    const url=new URL(String(input))
    assert.equal(init?.headers && (init.headers as Record<string,string>).Authorization,"Bearer test")
    if(init?.method==="POST"){
      assert.equal(url.searchParams.get("ifGenerationMatch"),"0")
      if(held)return new Response(null,{status:412})
      held=true;return new Response(JSON.stringify({generation:"123"}),{status:200})
    }
    assert.equal(init?.method,"DELETE");assert.equal(url.searchParams.get("ifGenerationMatch"),"123")
    held=false;releases++;return new Response(null,{status:204})
  }
  try{
    let finish!:()=>void;const pending=new Promise<void>(r=>{finish=r})
    const sync=async()=>{writers++;await pending;return {...metrics,receiptText:"must not log"}}
    const lock=new StorageBatchLock("test-lock-bucket",async()=>"test")
    const first=runLockedBatch(lock,"execution-1",sync)
    await new Promise(r=>setImmediate(r))
    assert.deepEqual(await runLockedBatch(lock,"execution-2",sync),{status:"busy"})
    finish();const result=await first
    assert.equal(writers,1);assert.equal(releases,1);assert.equal("receiptText" in result,false)
    assert.equal(result.status,"completed");assert.equal((result as any).processed,0)
  }finally{globalThis.fetch=oldFetch}
})
test("failed or indeterminate work retains lock and never retries sync",async()=>{
  let releases=0,calls=0
  const lock={acquire:async()=>"1",release:async()=>{releases++}}
  await assert.rejects(runLockedBatch(lock,"owner",async()=>{calls++;throw new AmbiguousMutationError()}),AmbiguousMutationError)
  await assert.rejects(runLockedBatch(lock,"owner",async()=>{calls++;return {...metrics,failed:1}}),/reconciliation/)
  assert.equal(releases,0);assert.equal(calls,2)
})
test("unknown lock acquisition stops before any financial API call",async()=>{
  let calls=0
  await assert.rejects(runLockedBatch({acquire:async()=>{throw new Error("response lost")},release:async()=>assert.fail()},"owner",async()=>{calls++;return metrics}))
  assert.equal(calls,0)
})
test("stale release cannot delete another generation",async()=>{
  const oldFetch=globalThis.fetch
  globalThis.fetch=async(input)=>{assert.equal(new URL(String(input)).searchParams.get("ifGenerationMatch"),"123");return new Response(null,{status:412})}
  try{await assert.rejects(new StorageBatchLock("test-lock-bucket",async()=>"test").release("123"),/reconcile lock/)}finally{globalThis.fetch=oldFetch}
})
test("lost, 5xx and malformed Notion mutation responses stop without retry",async()=>{
  const oldFetch=globalThis.fetch;let calls=0
  try{
    for(const failure of [()=>{throw new Error("private upstream body")},()=>new Response("private upstream body",{status:503}),()=>new Response("not JSON",{status:200})]){
      globalThis.fetch=async()=>{calls++;return failure()}
      const before=calls
      await assert.rejects(jsonRequest("https://api.notion.com/v1/pages",{method:"POST",body:"{}"}),AmbiguousMutationError)
      assert.equal(calls,before+1)
    }
  }finally{globalThis.fetch=oldFetch}
})
test("rejected Notion write is a fixed HTTP error and a query remains a read",async()=>{
  const oldFetch=globalThis.fetch
  try{
    globalThis.fetch=async()=>new Response("sensitive body",{status:400})
    await assert.rejects(jsonRequest("https://api.notion.com/v1/pages",{method:"PATCH"}),/^Error: Remote API api.notion.com: HTTP 400$/)
    globalThis.fetch=async()=>new Response("{}",{status:200})
    assert.deepEqual(await jsonRequest("https://api.notion.com/v1/data_sources/test/query",{method:"POST"}),{})
  }finally{globalThis.fetch=oldFetch}
})
