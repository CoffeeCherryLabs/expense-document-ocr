import assert from "node:assert/strict"
import test from "node:test"
import {syncDrive,transactionKey,conflicts} from "../src/driveSync.js"
import {parseOcrText} from "../src/parser.js"
const raw="상호: 테스트매장\n사업자등록번호: 123-45-67890\n거래일시 2026-10-07\n합계 11000원\n승인번호 12345678\n카드번호 1234-56**-****-4321"
test("mobile card digits do not change transaction identity; amount conflicts do",()=>{const a=parseOcrText(raw);assert.equal(transactionKey(a),transactionKey({...a,cardLast4:"9999"}));assert.equal(conflicts(a,{...a,cardLast4:"9999"}),false);assert.equal(conflicts(a,{...a,totalAmount:12000}),true)})
test("cloud intake is idempotent and changed evidence invalidates preliminary review",async()=>{
 const oldFetch=globalThis.fetch,oldEnv={...process.env}
 Object.assign(process.env,{NOTION_API_TOKEN:"test",GOOGLE_CLIENT_ID:"test",GOOGLE_CLIENT_SECRET:"test",GOOGLE_REFRESH_TOKEN:"test",GOOGLE_CLOUD_API_KEY:"test",GOOGLE_DRIVE_FOLDER_ID:"folder",EXPENSE_DATA_SOURCE_ID:"ledger",EVIDENCE_DATA_SOURCE_ID:"inbox",KNOWN_CARD_LAST4:"4321",KNOWN_CARD_USER_ID:"user"})
 const pages:any[]=[];let modified="v1",bytes="image-v1",seq=0
 const json=(x:unknown)=>new Response(JSON.stringify(x),{status:200,headers:{"Content-Type":"application/json"}})
 globalThis.fetch=async(input,init)=>{
  const url=String(input),body=init?.body?JSON.parse(typeof init.body==="string"?init.body:"{}"):{}
  if(url.includes("oauth2.googleapis.com"))return json({access_token:"fake"})
  if(url.includes("www.googleapis.com/drive/v3/files?"))return json({files:[{id:"file",name:"receipt.png",mimeType:"image/png",modifiedTime:modified,size:"8"}]})
  if(url.includes("www.googleapis.com/drive/v3/files/file"))return new Response(bytes)
  if(url.includes("vision.googleapis.com"))return json({responses:[{fullTextAnnotation:{text:raw}}]})
  if(url.endsWith("/query")){const id=url.includes("/inbox/")?"inbox":"ledger";return json({results:pages.filter(p=>p.parent.data_source_id===id),has_more:false})}
  if(url.endsWith("/pages") && init?.method==="POST"){const p={...body,id:"p"+(++seq)};pages.push(p);return json(p)}
  if(url.includes("/pages/") && init?.method==="PATCH"){const id=url.split("/").pop(),p=pages.find(p=>p.id===id);assert.ok(p);p.properties={...p.properties,...body.properties};return json(p)}
  throw new Error("Unexpected mock request")
 }
 try {
  assert.equal((await syncDrive()).failed,0)
  assert.equal(pages.filter(p=>p.parent.data_source_id==="ledger").length,1)
  assert.equal((await syncDrive()).processed,0)
  modified="v2";bytes="image-v2"
  assert.equal((await syncDrive()).failed,0)
  const expenses=pages.filter(p=>p.parent.data_source_id==="ledger")
  assert.equal(expenses.length,1)
  assert.equal(expenses[0].properties["검토 결과"].select.name,"보완 필요")
  assert.equal(expenses[0].properties["회계 검토 완료"],undefined)
 } finally {globalThis.fetch=oldFetch;for(const key of Object.keys(process.env))if(!(key in oldEnv))delete process.env[key];Object.assign(process.env,oldEnv)}
})
