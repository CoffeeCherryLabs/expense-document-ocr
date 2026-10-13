import {organizationCounts,type OrganizationItem} from "./weeklyOrganization.js"
const text=(s:string)=>[{type:"text",text:{content:s.slice(0,1900)}}]
const paragraph=(s:string)=>({object:"block",type:"paragraph",paragraph:{rich_text:text(s)}})
export function organizationReportBlocks(plan:OrganizationItem[],moved:number,mode:string){
 const n=organizationCounts(plan),labels:Record<OrganizationItem["status"],string>={eligible:"이동 대상",reference:"참고 사진",needs_correction:"정보·OCR 보완",needs_review:"담당자 확인",already_filed:"기존 위치 유지",untracked:"접수 확인"}
 const table=(items:OrganizationItem[])=>({object:"block",type:"table",table:{table_width:3,has_column_header:true,has_row_header:false,children:[
  {object:"block",type:"table_row",table_row:{cells:[text("파일"),text("구분 / 다음 작업"),text("증빙 확인")]}},
  ...items.slice(0,90).map(p=>({object:"block",type:"table_row",table_row:{cells:[text(p.file.name),text(p.status==="eligible"?`${p.destination}/${p.newName}`:`${labels[p.status]} · ${p.reason}`),p.evidence?[{type:"text",text:{content:"증빙 열기",link:{url:`https://www.notion.so/${p.evidence.id.replace(/-/g,"")}`}}}]:text("미접수")]}}))]}})
 return [
  {object:"block",type:"callout",callout:{icon:{type:"emoji",emoji:"📋"},rich_text:text(`${mode==="apply"?"주간 정리":"이동 전 미리보기"} · 전체 ${n.scanned}개 / 이동 대상 ${n.eligible}개 / 실제 이동 ${moved}개`)}},
  paragraph(`담당자 확인 ${n.needsReview}개 · 정보/OCR 보완 ${n.needsCorrection}개 · 참고 사진 ${n.reference}개 · 기존 위치 유지 ${n.alreadyFiled}개 · 접수 확인 ${n.untracked}개`),
  paragraph("회계 승인·지출 금액·소유자·원본 내용은 변경하지 않습니다. 담당자의 원본 대조 완료·사용자 확인을 모두 체크한 증빙만 이동 대상입니다."),
  paragraph("이동 대상 목록"),...(n.eligible?[table(plan.filter(p=>p.status==="eligible"))]:[paragraph("현재 이동 대상이 없습니다.")]),
  {object:"block",type:"toggle",toggle:{rich_text:text("보류 목록 · 필요한 작업과 원본 확인"),children:plan.filter(p=>p.status!=="eligible").length?[table(plan.filter(p=>p.status!=="eligible")),...(plan.length>90?[paragraph("목록은 첫 90개 표시입니다. 전체 항목은 증빙 수신함에서 확인하세요.")]:[])]:[paragraph("보류 항목 없음")]}},
  paragraph("통계 단위는 증빙 파일입니다. 지출 건수·금액과 합산하지 않습니다. 정보 보완이나 참고 사진은 삭제하지 않습니다.")
 ]
}
