import {googleToken,listFolder,rows,notion} from "../src/driveSync.js"
import {organizationPlan,organizationCounts} from "../src/weeklyOrganization.js"
import {organizationReportBlocks} from "../src/organizationReport.js"
import {organizeFile} from "../src/organizeDrive.js"
const required=(name:string)=>{const v=process.env[name];if(!v)throw new Error("Weekly organization configuration missing");return v}
const rt=(s:string)=>[{type:"text",text:{content:s.slice(0,1900)}}]
async function children(id:string){const found:any[]=[];let cursor:string|undefined;do{const d=await notion(`blocks/${id}/children?page_size=100${cursor?`&start_cursor=${cursor}`:""}`);found.push(...d.results);cursor=d.has_more?d.next_cursor:undefined}while(cursor);return found}
export async function weeklyOrganize(){
 const root=required("GOOGLE_DRIVE_FOLDER_ID"),inbox=required("GOOGLE_DRIVE_UPLOAD_FOLDER_ID"),report=required("WEEKLY_ORGANIZATION_REPORT_PAGE_ID")
 const apply=process.env.WEEKLY_DRIVE_APPLY_ENABLED==="true"
 const runId=process.env.GITHUB_RUN_ID
 if(!runId)throw new Error("Weekly reports require an auditable workflow execution")
 const runKey=`주간 증빙 점검 · ${runId}`
 // A rerun after any unknown write does not repeat file mutations or create duplicate reports.
 const prior=await children(report)
 if(prior.some(b=>b.type==="child_page" && b.child_page.title===runKey))throw new Error("Existing execution report; reconcile before rerun")
 const token=await googleToken(),files=await listFolder(token,root)
 const evidence=await rows(required("EVIDENCE_DATA_SOURCE_ID")),ledger=await rows(required("EXPENSE_DATA_SOURCE_ID"))
 const plan=organizationPlan(files,evidence,ledger,root,inbox)
 const journal=await notion("pages","POST",{parent:{page_id:report},properties:{title:{type:"title",title:rt(runKey)}},children:organizationReportBlocks(plan,0,"preview")})
 let moved=0,failed=0
 if(apply)for(const item of plan.filter(p=>p.status==="eligible")){
  // Re-read confirmation and checkpoint immediately before each move. Do not overwrite human fields.
  const freshEvidence=await notion(`pages/${item.evidence!.id}`),freshExpense=await notion(`pages/${item.expense!.id}`)
  const fresh=organizationPlan([item.file],[freshEvidence],[freshExpense],root,inbox)[0]
  if(fresh.status!=="eligible")continue
  const history=await children(freshEvidence.id)
  const events=history.filter(b=>b.type==="paragraph").map(b=>(b.paragraph.rich_text??[]).map((t:any)=>t.plain_text??t.text?.content??"").join("")).filter(t=>t.startsWith("Drive 정리 이력: "))
  const latest=events.at(-1)
  if(latest && JSON.parse(latest.slice("Drive 정리 이력: ".length)).status!=="completed")throw new Error("Unresolved organization intent; manual reconciliation required")
  try{
   const result=await organizeFile({token,root,inbox,file:item.file,extraction:fresh.extraction!,corroborated:false,confirmed:true,audit:async event=>{
    await notion(`blocks/${freshEvidence.id}/children`,"PATCH",{children:[{object:"block",type:"paragraph",paragraph:{rich_text:rt("Drive 정리 이력: "+JSON.stringify(event))}}]})
   }})
   if(result.moved){moved++
    await notion(`pages/${freshEvidence.id}`,"PATCH",{properties:{"파일명":{title:rt(result.file.name)},"Drive 수정시각":{rich_text:rt(result.file.modifiedTime)}}})
    await notion(`blocks/${journal.id}/children`,"PATCH",{children:[{object:"block",type:"paragraph",paragraph:{rich_text:rt(`이동 완료: ${item.file.name} → ${fresh.destination}/${fresh.newName}`)}}]})
   }
  }catch{failed++;break} // Never blindly retry an ambiguous remote move/write.
 }
 const counts={...organizationCounts(plan),moved,failed,mode:apply?"apply":"preview"}
 await notion(`blocks/${journal.id}/children`,"PATCH",{children:[{object:"block",type:"paragraph",paragraph:{rich_text:rt(`실행 결과: 실제 이동 ${moved}개 · 실패 ${failed}개 · ${apply?"이동 모드":"미리보기 모드"}`)}}]})
 const markers=prior.filter(b=>b.type==="paragraph" && (b.paragraph.rich_text??[]).map((t:any)=>t.plain_text??t.text?.content??"").join("").startsWith("최근 주간 점검:"))
 if(markers.length!==1)throw new Error("Weekly summary marker missing or duplicated")
 await notion(`blocks/${markers[0].id}`,"PATCH",{paragraph:{rich_text:rt(`최근 주간 점검: ${new Date().toLocaleString("ko-KR",{timeZone:"Asia/Seoul"})} · 전체 ${counts.scanned}개 / 이동 대상 ${counts.eligible}개 / 실제 이동 ${moved}개 / 보완 ${counts.needsCorrection}개 / 담당자 확인 ${counts.needsReview}개 / 참고 사진 ${counts.reference}개 / 실패 ${failed}개`)}})
 console.log(JSON.stringify(counts)) // Only aggregate counts in public Actions logs.
 if(process.env.GITHUB_STEP_SUMMARY){const {appendFile}=await import("node:fs/promises");await appendFile(process.env.GITHUB_STEP_SUMMARY,`주간 증빙 점검 (${apply?"이동":"미리보기"})\n\n조회 ${counts.scanned}개 · 이동 대상 ${counts.eligible}개 · 실제 이동 ${moved}개 · 확인/보완 ${counts.needsReview+counts.needsCorrection}개 · 참고 사진 ${counts.reference}개 · 실패 ${failed}개\n\n상세 목록과 이력은 회사 Notion의 증빙 정리·보완 보고에서 확인하세요.\n`)}
 if(failed)process.exitCode=1
}
if(process.argv[1]?.endsWith("weekly-organize.ts"))weeklyOrganize().catch(()=>{console.error("Weekly organization failed; inspect private report and reconcile remote state before retry.");process.exitCode=1})
