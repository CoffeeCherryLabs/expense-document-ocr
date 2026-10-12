import assert from "node:assert/strict"
import test from "node:test"
import {syncDrive,transactionKey,conflicts} from "../src/driveSync.js"
import {parseOcrText} from "../src/parser.js"
const raw="상호: 테스트매장\n사업자등록번호: 123-45-67890\n거래일시 2026-10-07\n합계 11000원\n승인번호 12345678\n카드번호 1234-56**-****-4321"
test("mobile card digits do not change transaction identity; amount conflicts do",()=>{const a=parseOcrText(raw);assert.equal(transactionKey(a),transactionKey({...a,cardLast4:"9999"}));assert.equal(conflicts(a,{...a,cardLast4:"9999"}),false);assert.equal(conflicts(a,{...a,totalAmount:12000}),true)})
test("cloud intake is idempotent and changed evidence invalidates preliminary review",async()=>{
 const oldFetch=globalThis.fetch,oldEnv={...process.env}
 Object.assign(process.env,{NOTION_API_TOKEN:"test",GOOGLE_CLIENT_ID:"test",GOOGLE_CLIENT_SECRET:"test",GOOGLE_REFRESH_TOKEN:"test",GOOGLE_CLOUD_API_KEY:"test",GOOGLE_DRIVE_FOLDER_ID:"folder",EXPENSE_DATA_SOURCE_ID:"ledger",EVIDENCE_DATA_SOURCE_ID:"inbox",KNOWN_CARD_LAST4:"4321",KNOWN_CARD_USER_ID:"user"})
 const pages:any[]=[];let modified="v1",bytes="image-v1",visionText=raw,seq=0
 const json=(x:unknown)=>new Response(JSON.stringify(x),{status:200,headers:{"Content-Type":"application/json"}})
 globalThis.fetch=async(input,init)=>{
  const url=String(input),body=init?.body?JSON.parse(typeof init.body==="string"?init.body:"{}"):{}
  if(url.includes("oauth2.googleapis.com"))return json({access_token:"fake"})
  if(url.includes("www.googleapis.com/drive/v3/files?"))return json({files:[{id:"file",name:"receipt.png",mimeType:"image/png",modifiedTime:modified,size:"8"},{id:"untouched",name:"other.png",mimeType:"image/png",modifiedTime:modified,size:"8"}]})
  if(url.includes("www.googleapis.com/drive/v3/files/file"))return new Response(bytes)
  if(url.includes("vision.googleapis.com"))return json({responses:[{fullTextAnnotation:{text:visionText}}]})
  if(url.endsWith("/query")){const id=url.includes("/inbox/")?"inbox":"ledger";return json({results:pages.filter(p=>p.parent.data_source_id===id),has_more:false})}
  if(url.endsWith("/pages") && init?.method==="POST"){const p={...body,id:"p"+(++seq)};pages.push(p);return json(p)}
  if(url.includes("/pages/") && init?.method==="PATCH"){const id=url.split("/").pop(),p=pages.find(p=>p.id===id);assert.ok(p);p.properties={...p.properties,...body.properties};return json(p)}
  throw new Error("Unexpected mock request")
 }
 try {
  await assert.rejects(syncDrive({cardClassification:"non_corporate"}),/requires one explicit file/)
  await assert.rejects(syncDrive({fileId:"outside"}),/not in the configured Drive folder/)
  assert.equal(pages.length,0)
  process.env.DRIVE_ORGANIZE_ENABLED="true"
  const first=await syncDrive({fileId:"file",cardClassification:"non_corporate"})
  assert.deepEqual(first,{scanned:1,processed:1,failed:0,reviewed:0,organized:0,drafts:1,cardMatches:0,ownerMatches:0})
  assert.equal(pages.filter(p=>p.parent.data_source_id==="ledger").length,1)
  const draft=pages.find(p=>p.parent.data_source_id==="ledger")
  assert.equal(draft.properties["결제 방식"].select.name,"기타")
  assert.equal(draft.properties["지출자"],undefined)
  assert.match(draft.properties["카드 매칭 근거"].rich_text[0].text.content,/비법인카드/)
  assert.match(draft.properties["보완 안내"].rich_text[0].text.content,/결제 수단/)
  assert.equal(draft.children.some((b:any)=>b.type==="toggle"),true)
  assert.equal(pages.find(p=>p.parent.data_source_id==="inbox").properties["조치 상태"].select.name,"정리 완료")
  assert.equal((await syncDrive({fileId:"file"})).processed,0)
  const matched=await syncDrive({fileId:"file",forceOcr:true})
  assert.equal(matched.processed,1)
  assert.equal(matched.cardMatches,1)
  assert.equal(matched.ownerMatches,0)
  draft.properties["지출자"]={people:[{id:"user"}]}
  assert.equal((await syncDrive({fileId:"file",forceOcr:true})).ownerMatches,1)
  draft.properties["지출자"]={people:[{id:"another-user"}]}
  assert.equal((await syncDrive({fileId:"file",forceOcr:true})).ownerMatches,0)
  assert.equal(draft.properties["지출자"].people[0].id,"another-user")
  assert.equal(pages.filter(p=>p.parent.data_source_id==="ledger").length,1)
  modified="v2";bytes="image-v2"
  assert.equal((await syncDrive({fileId:"file"})).failed,0)
  const expenses=pages.filter(p=>p.parent.data_source_id==="ledger")
  assert.equal(expenses.length,1)
  assert.equal(expenses[0].properties["검토 결과"].select.name,"보완 필요")
  assert.match(expenses[0].properties["보완 안내"].rich_text[0].text.content,/원본 증빙이 변경/)
  assert.equal(expenses[0].properties["회계 검토 완료"],undefined)
  modified="v3";bytes="reference-photo";visionText=""
  const reference=await syncDrive({fileId:"file",forceOcr:true})
  assert.equal(reference.failed,0)
  assert.equal(pages.find(p=>p.parent.data_source_id==="inbox").properties["OCR 상태"].select.name,"확인 필요")
  assert.equal((await syncDrive({fileId:"file"})).processed,0)
  assert.equal(pages.filter(p=>p.parent.data_source_id==="ledger").length,1)
 } finally {globalThis.fetch=oldFetch;for(const key of Object.keys(process.env))if(!(key in oldEnv))delete process.env[key];Object.assign(process.env,oldEnv)}
})
test("empty Drive still refreshes daily projections and unchanged runs create nothing",async()=>{
 const oldFetch=globalThis.fetch,oldEnv={...process.env}
 Object.assign(process.env,{NOTION_API_TOKEN:"test",GOOGLE_CLIENT_ID:"test",GOOGLE_CLIENT_SECRET:"test",GOOGLE_REFRESH_TOKEN:"test",GOOGLE_DRIVE_FOLDER_ID:"folder",EXPENSE_DATA_SOURCE_ID:"ledger",EVIDENCE_DATA_SOURCE_ID:"inbox",DAILY_SUMMARY_DATA_SOURCE_ID:"summary",DRIVE_ORGANIZE_ENABLED:"false"})
 const ledger:any[]=[{id:"expense",properties:{"사용일":{date:{start:"2026-10-06"}},"통화":{select:{name:"KRW"}},"총 금액":{number:100},"지출자":{people:[{id:"person",name:"Employee"}]},"결제 방식":{select:{name:"법인카드"}},"처리 상태":{status:{name:"작성 중"}}}}]
 const summaries:any[]=[];let creates=0,updates=0
 const json=(x:unknown)=>new Response(JSON.stringify(x),{status:200})
 globalThis.fetch=async(input,init)=>{
  const url=String(input),body=init?.body?JSON.parse(typeof init.body==="string"?init.body:"{}"):{}
  if(url.includes("oauth2.googleapis.com"))return json({access_token:"fake"})
  if(url.includes("www.googleapis.com/drive/v3/files?"))return json({files:[]})
  if(url.endsWith("/query"))return json({results:url.includes("/ledger/")?ledger:url.includes("/summary/")?summaries.filter(p=>!p.archived):[],has_more:false})
  if(url.endsWith("/pages") && init?.method==="POST"){assert.equal(body.parent.data_source_id,"summary");creates++;const p={...body,id:"summary"+creates};summaries.push(p);return json(p)}
  if(url.includes("/pages/") && init?.method==="PATCH"){
   const p=[...ledger,...summaries].find(p=>p.id===url.split("/").pop());assert.ok(p)
   if(p!==ledger[0])updates++
   p.properties={...p.properties,...body.properties};if(body.archived)p.archived=true
   return json(p)
  }
  throw new Error("Unexpected call: empty Drive must never download or OCR")
 }
 try{
  const first=await syncDrive();assert.equal(first.scanned,0);assert.equal(first.processed,0);assert.equal(first.summaryGroups,1);assert.equal(creates,1)
  assert.equal((await syncDrive()).summaryUpdated,0);assert.equal(creates,1)
  ledger[0].properties["총 금액"].number=200
  assert.equal((await syncDrive()).summaryUpdated,1);assert.equal(summaries[0].properties["하루 합계"].number,200);assert.equal(creates,1)
  ledger[0].properties["처리 상태"].status.name="취소·반려"
  assert.equal((await syncDrive()).summaryGroups,0);assert.equal(summaries[0].archived,true);assert.equal(ledger[0].archived,undefined);assert.equal(updates,2)
 }finally{globalThis.fetch=oldFetch;for(const key of Object.keys(process.env))if(!(key in oldEnv))delete process.env[key];Object.assign(process.env,oldEnv)}
})
