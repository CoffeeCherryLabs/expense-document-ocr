import {organizedName} from "./organizeDrive.js"
import type {DriveFile,Row} from "./driveSync.js"
import type {Extraction} from "./types.js"
export const rowText=(r:Row,k:string)=>(r.properties[k]?.rich_text??r.properties[k]?.title??[]).map((v:any)=>v.plain_text??v.text?.content??"").join("")
const select=(r:Row,k:string)=>r.properties[k]?.select?.name??r.properties[k]?.status?.name
export type OrganizationItem={file:DriveFile;evidence?:Row;expense?:Row;status:"eligible"|"reference"|"needs_correction"|"needs_review"|"already_filed"|"untracked";reason:string;extraction?:Extraction;destination?:string;newName?:string}
export function organizationPlan(files:DriveFile[],evidence:Row[],ledger:Row[],root:string,inbox:string):OrganizationItem[]{
 return files.map(file=>{
  const records=evidence.filter(r=>rowText(r,"Drive 파일 ID")===file.id),record=records.length===1?records[0]:undefined
  const base={file,evidence:record}
  if(!record)return {...base,status:"untracked",reason:"접수 기록이 없거나 중복입니다. 운영 담당자가 연결을 확인하세요."} as OrganizationItem
  if(select(record,"확인 유형")==="참고 사진")return {...base,status:"reference",reason:"참고 사진은 현재 위치에 보존합니다."}
  if(select(record,"OCR 상태")!=="판독 완료" || select(record,"확인 유형")!=="접수 완료" || rowText(record,"오류"))return {...base,status:"needs_correction",reason:rowText(record,"처리 안내")||"판독·정보 보완을 마친 뒤 다시 확인하세요."}
  const links=record.properties["연결 지출"]?.relation??[],expense=links.length===1?ledger.find(r=>r.id===links[0].id):undefined
  if(!expense || record.properties["연결 지출"]?.has_more || expense.properties["취소·환불 있음"]?.checkbox || expense.properties["중복 청구 있음"]?.checkbox || select(expense,"처리 상태")==="취소·반려")return {...base,expense,status:"needs_correction",reason:"단일 지출 연결·취소·중복 상태를 확인하세요."}
  if(expense.properties["원본 대조 완료"]?.checkbox!==true || expense.properties["사용자 확인"]?.checkbox!==true)return {...base,expense,status:"needs_review",reason:"지출의 원본 대조 완료·사용자 확인 체크가 필요합니다. 회계 승인과는 별개입니다."}
  let extraction:Extraction
  try{extraction=JSON.parse(rowText(record,"판독 JSON"))}catch{return {...base,expense,status:"needs_correction",reason:"판독 자료 형식을 운영 담당자가 확인하세요."}}
  const newName=organizedName(file,extraction),date=expense.properties["사용일"]?.date?.start?.slice(0,10)
  const merchant=(s:string)=>s.normalize("NFKC").replace(/[^\p{L}\p{N}]/gu,"")
  if(!newName || extraction.documentType==="unknown" || merchant(extraction.merchant??"")!==merchant(rowText(expense,"사용처")) || extraction.totalAmount!==expense.properties["총 금액"]?.number || extraction.transactionDate!==date || extraction.currency!==select(expense,"통화") || extraction.approvalNumber!==rowText(expense,"승인·이체 확인번호"))return {...base,expense,status:"needs_correction",reason:"확인한 거래와 판독 사용처·날짜·금액·승인번호·통화를 대조하세요."}
  if(rowText(record,"Drive 수정시각")!==file.modifiedTime || !rowText(record,"SHA256"))return {...base,expense,status:"needs_correction",reason:"원본이 변경됐거나 판독 근거가 없습니다. OCR 접수 후 다시 확인하세요."}
  if(file.parents?.length!==1)return {...base,expense,status:"needs_correction",reason:"원본 폴더 위치를 확인하세요."}
  if(![root,inbox].includes(file.parents[0]))return {...base,expense,status:"already_filed",reason:"기존 하위 폴더에 보존합니다. 주간 작업은 다시 이동하지 않습니다."}
  return {...base,expense,status:"eligible",reason:"원본·사용자 확인 및 거래 대조 완료",extraction,newName,destination:`${extraction.transactionDate!.slice(0,4)}/${extraction.transactionDate!.slice(0,7)}/${extraction.transactionDate}`}
 })
}
export function organizationCounts(plan:OrganizationItem[]){
 return {scanned:plan.length,eligible:plan.filter(p=>p.status==="eligible").length,reference:plan.filter(p=>p.status==="reference").length,
  needsCorrection:plan.filter(p=>p.status==="needs_correction").length,needsReview:plan.filter(p=>p.status==="needs_review").length,
  alreadyFiled:plan.filter(p=>p.status==="already_filed").length,untracked:plan.filter(p=>p.status==="untracked").length}
}
