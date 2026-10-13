import test from "node:test"
import assert from "node:assert/strict"
import {organizationPlan,organizationCounts} from "../src/weeklyOrganization.js"
import {organizationReportBlocks} from "../src/organizationReport.js"
import {weeklyOrganize} from "../scripts/weekly-organize.js"
const text=(s:string)=>({rich_text:[{text:{content:s}}]})
const extraction={documentType:"receipt",transactionDate:"2026-10-01",merchant:"테스트",totalAmount:1000,currency:"KRW",approvalNumber:"1234"}
const file={id:"file1",name:"receipt.png",mimeType:"image/png",parents:["root"],modifiedTime:"v1"}
const evidence={id:"evidence1",properties:{"Drive 파일 ID":text("file1"),"Drive 수정시각":text("v1"),"판독 JSON":text(JSON.stringify(extraction)),"SHA256":text("hash"),"OCR 상태":{select:{name:"판독 완료"}},"확인 유형":{select:{name:"접수 완료"}},"조치 상태":{select:{name:"정리 완료"}},"연결 지출":{relation:[{id:"expense1"}]}}}
const expense={id:"expense1",properties:{"원본 대조 완료":{checkbox:true},"사용자 확인":{checkbox:true},"사용처":text("테스트"),"사용일":{date:{start:"2026-10-01"}},"총 금액":{number:1000},"통화":{select:{name:"KRW"}},"승인·이체 확인번호":text("1234")}}
const copy=<T>(x:T):T=>JSON.parse(JSON.stringify(x))
test("weekly organization requires human confirmation, never auto-complete status alone",()=>{
 const checked=organizationPlan([file],[evidence],[expense],"root","inbox")[0];assert.equal(checked.status,"eligible")
 for(const key of ["원본 대조 완료","사용자 확인"]){const e=copy(expense);e.properties[key as "사용자 확인"].checkbox=false;assert.equal(organizationPlan([file],[evidence],[e],"root","inbox")[0].status,"needs_review")}
 assert.equal(organizationPlan([{...file,parents:["dated-folder"]}],[evidence],[expense],"root","inbox")[0].status,"already_filed")
})
test("reference photos, unresolved OCR, changed sources and conflicts are withheld",()=>{
 const reference=copy(evidence);reference.properties["확인 유형"].select.name="참고 사진"
 assert.equal(organizationPlan([file],[reference],[expense],"root","inbox")[0].status,"reference")
 const pending=copy(evidence);pending.properties["OCR 상태"].select.name="확인 필요"
 assert.equal(organizationPlan([file],[pending],[expense],"root","inbox")[0].status,"needs_correction")
 assert.equal(organizationPlan([{...file,modifiedTime:"v2"}],[evidence],[expense],"root","inbox")[0].status,"needs_correction")
 const conflict=copy(expense);conflict.properties["총 금액"].number=2000
 assert.equal(organizationPlan([file],[evidence],[conflict],"root","inbox")[0].status,"needs_correction")
 assert.equal(organizationPlan([file],[evidence,evidence],[expense],"root","inbox")[0].status,"untracked")
})
test("report separates file counts from transactions and explains zero eligibility",()=>{
 const items=organizationPlan([file],[evidence],[expense],"root","inbox")
 assert.deepEqual(organizationCounts(items),{scanned:1,eligible:1,reference:0,needsCorrection:0,needsReview:0,alreadyFiled:0,untracked:0})
 const report=JSON.stringify(organizationReportBlocks([],0,"preview"));assert.match(report,/현재 이동 대상이 없습니다/);assert.match(report,/지출 건수/)
 const applying=JSON.stringify(organizationReportBlocks(items,0,"apply_pending"));assert.match(applying,/실행 전 대상 목록/);assert.match(applying,/실제 이동 결과는 아래/);assert.doesNotMatch(applying,/이동 전 미리보기|실제 이동 0개/)
})
test("weekly preview never downloads, OCRs, moves files or changes source rows",async()=>{
 const oldFetch=globalThis.fetch,oldEnv={...process.env};let journals=0
 Object.assign(process.env,{GOOGLE_DRIVE_FOLDER_ID:"root",GOOGLE_DRIVE_UPLOAD_FOLDER_ID:"inbox",WEEKLY_ORGANIZATION_REPORT_PAGE_ID:"report",EVIDENCE_DATA_SOURCE_ID:"evidence",EXPENSE_DATA_SOURCE_ID:"ledger",NOTION_API_TOKEN:"test",GOOGLE_CLIENT_ID:"test",GOOGLE_CLIENT_SECRET:"test",GOOGLE_REFRESH_TOKEN:"test",GITHUB_RUN_ID:"123",WEEKLY_DRIVE_APPLY_ENABLED:"false"})
 const json=(x:unknown)=>new Response(JSON.stringify(x),{status:200})
 globalThis.fetch=async(input,init)=>{
  const url=String(input),body=typeof init?.body==="string"?JSON.parse(init.body):{}
  if(url.includes("oauth2.googleapis.com"))return json({access_token:"test"})
  if(url.includes("www.googleapis.com/drive")){assert.equal(init?.method,undefined);assert.equal(url.includes("alt=media"),false);return json({files:[file]})}
  if(url.includes("/data_sources/"))return json({results:url.includes("/evidence/")?[evidence]:[expense],has_more:false})
  if(url.includes("/blocks/report/children"))return json({results:[{id:"marker",type:"paragraph",paragraph:{rich_text:[{plain_text:"최근 주간 점검: 준비"}]}}],has_more:false})
  if(url.endsWith("/pages") && init?.method==="POST"){assert.equal(body.parent.page_id,"report");journals++;return json({id:"journal"})}
  if(url.includes("/blocks/journal/children") || url.endsWith("/blocks/marker"))return json({})
  throw new Error("Forbidden preview request")
 }
 try{await weeklyOrganize();assert.equal(journals,1)}finally{globalThis.fetch=oldFetch;for(const k of Object.keys(process.env))if(!(k in oldEnv))delete process.env[k];Object.assign(process.env,oldEnv)}
})
