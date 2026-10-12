import test from "node:test"
import assert from "node:assert/strict"
import {organizeFile,organizedName} from "../src/organizeDrive.js"
import {parseOcrText} from "../src/parser.js"
const x=parseOcrText("상호: 테스트매장\n거래일시 2026-10-07\n합계 11000원\n승인번호 12345678")
const file={id:"file1",name:"original.jpg",mimeType:"image/jpeg",parents:["inbox"],modifiedTime:"v1"}
test("organization requires supported exact facts and unique stable file name",()=>{
 assert.ok(organizedName(file,x)?.includes("2026-10-07_테스트매장_11000원"))
 assert.notEqual(organizedName(file,x),organizedName({...file,id:"file2"},x))
 for(const override of [{transactionDate:"2026-02-30"},{currency:"USD"},{totalAmount:-1},{approvalNumber:null}])assert.equal(organizedName(file,{...x,...override}),null)
})
test("unconfirmed evidence and files outside inbox never make a request",async()=>{
 const base={token:"test",root:"root",inbox:"inbox",file,extraction:x,audit:async()=>{throw Error("must not audit")}}
 assert.deepEqual(await organizeFile({...base,corroborated:false}),{moved:false})
 assert.deepEqual(await organizeFile({...base,file:{...file,parents:["existing"]},corroborated:true}),{moved:false})
})
test("durable audit precedes move; audit failure prevents file mutation",async()=>{
 const old=globalThis.fetch;const actions:string[]=[]
 globalThis.fetch=async(input,init)=>{const u=String(input);actions.push(init?.method??"GET");return new Response(JSON.stringify(u.includes('/inbox?')?{parents:["root"],mimeType:"application/vnd.google-apps.folder"}:u.includes('/file1?')?file:{files:[{id:"destination"}]}),{status:200})}
 try{await assert.rejects(organizeFile({token:"test",root:"root",inbox:"inbox",file,extraction:x,corroborated:true,audit:async()=>{throw Error("audit unavailable")}}));assert.equal(actions.includes("PATCH"),false)}finally{globalThis.fetch=old}
})
