/** Preliminary controls, never an accounting approval or a legal verdict. */
export const RULE_VERSION = "KR-RND-2026-05-06/review-v1"
export const SOURCE = "https://www.law.go.kr/LSW/admRulInfoP.do?admRulSeq=2100000278740&chrClsCd=010201"
export type Issue = { code: string; level: "missing" | "risk"; message: string; basis: string }
export type ReviewInput = {
  funding?: "national" | "tips" | "private" | "self" | "unknown"
  projectId?: string; projectStart?: string; projectEnd?: string
  policyReviewed?: boolean; budgetConfirmed?: boolean; purpose?: string
  userConfirmed?: boolean; evidenceChecked?: boolean; payer?: string
  date?: string; amount?: number | null; vendorAmount?: number | null
  currency?: string; category?: "meeting" | "meal" | "travel" | "office" | "software" | "material" | "other"
  cancelled?: boolean; duplicateClaim?: boolean; alcohol?: boolean
  attendees?: string; meetingDetails?: string; meetingEligibility?: "eligible" | "same-project-same-institution-only" | "unknown"
  mealBasis?: "overtime" | "weekday-lunch" | "travel" | "unknown"
  travelReport?: boolean; travelPolicy?: boolean; overlappingMeal?: boolean
  labPlanApproved?: boolean; inspectionConfirmed?: boolean
  softwareContractDate?: string; softwareTermChecked?: boolean; softwareExceptionApproved?: boolean
  vatReviewed?: boolean; relatedPartyReviewed?: boolean; paymentMethodReviewed?: boolean; prohibitedReviewed?:boolean
}
export function reviewExpense(x: ReviewInput) {
  const issues: Issue[] = []
  const add = (code: string, message: string, basis: string, level: Issue["level"] = "missing") => issues.push({code, message, basis, level})
  if (!x.projectId || !x.funding || x.funding === "unknown") add("PROJECT", "과제·재원 미지정: 최종 협약서와 예산을 연결하세요.", "적용범위 확인 / 사용기준 제4조")
  if (!x.policyReviewed) add("POLICY", "사업별 지침·협약·내부 규정의 적용 버전을 담당자가 확인해야 합니다.", "제4조; 민간수탁은 계약별 확인")
  if (!x.budgetConfirmed) add("BUDGET", "해당 비목의 승인 예산·잔액·변경승인 여부를 확인하세요.", "제22조제1항, 제73조")
  if (!x.purpose?.trim()) add("PURPOSE", "수행 업무·과제와의 직접적인 관련성을 입력하세요.", "제21조제1항")
  if (!x.payer) add("PAYER", "기명 카드 또는 확인된 카드내역으로 지출자를 연결하세요.", "내부 증빙 통제")
  if (!x.userConfirmed) add("USER_CONFIRM", "사용자가 날짜·금액·목적·참가자를 확인해야 합니다.", "내부 확인 절차")
  if (!x.evidenceChecked) add("EVIDENCE", "영수증과 카드내역 원본 판독 결과를 확인하세요.", "제22조제2항")
  if (!x.date || !/^\d{4}-\d{2}-\d{2}/.test(x.date)) add("DATE", "결제일이 확인되지 않았습니다.", "증빙 확인")
  if (x.amount == null || !Number.isFinite(x.amount) || x.amount <= 0) add("AMOUNT", "유효한 결제금액을 확인하세요. 0원 매입표시는 취소와 다릅니다.", "증빙 확인")
  if (!x.currency) add("CURRENCY", "통화를 확인하세요.", "증빙 확인")
  if (x.vendorAmount != null && x.amount != null && x.vendorAmount !== x.amount) add("AMOUNT_CONFLICT", "카드 승인금액과 판매처 금액이 다릅니다. 최종 청구액·수수료를 확인하세요.", "제22조제2항")
  if (x.cancelled) add("CANCELLED", "취소·환불 거래입니다. 환불 반영 전 청구를 보류하세요.", "실지출 확인", "risk")
  if (x.duplicateClaim) add("DUPLICATE", "동일 비용의 중복 청구가 확인되었습니다. 중복 부분을 제외하세요.", "제21조제4항제3호", "risk")
  const national = x.funding === "national" || x.funding === "tips"
  if (national) {
    if(!x.prohibitedReviewed)add("PROHIBITED_CHECK", "주류·중복 청구·취소/환불 여부를 원본 및 다른 지출과 대조하세요.", "제21조·제22조")
    if (!x.projectStart || !x.projectEnd) add("PERIOD_UNKNOWN", "협약상 시작일·단계 종료일이 필요합니다.", "제22조제4항")
    else if (x.date && (x.date.slice(0,10) < x.projectStart || x.date.slice(0,10) > x.projectEnd)) add("PERIOD", "협약기간 밖의 지출입니다. 예외 적용 근거를 담당자가 검토해야 합니다.", "제22조제4항, 제71조", "risk")
    if (x.alcohol) add("ALCOHOL", "주류 등 유흥성 비용은 연구개발비에서 제외합니다.", "제21조제4항제2호", "risk")
    if (!x.vatReviewed) add("VAT", "환급 가능한 부가세·관세를 연구비 청구에서 제외했는지 확인하세요.", "제21조제4항제1호")
    if (!x.relatedPartyReviewed) add("RELATED_PARTY", "내부·계열사 거래 여부와 예외 승인 근거를 확인하세요.", "제21조제4항")
    if (!x.paymentMethodReviewed) add("CARD", "이 법인카드의 연구비카드 등록 여부 또는 발급 전 법인카드 사용 근거를 확인하세요.", "제22조제5항")
    if (x.category === "meeting") {
      if (!x.attendees?.trim() || !x.meetingDetails?.trim()) add("MEETING_RECORD", "회의 목적·일시·장소·내용·참석자(소속·과제참여 여부)를 입력하세요.", "제25조제4·5항")
      if (!x.meetingEligibility || x.meetingEligibility === "unknown") add("MEETING_ELIGIBILITY", "참석자의 소속기관과 해당 과제 참여 여부를 확인하세요.", "제25조제4항; 2026.7 매뉴얼 p226·237")
      if (x.meetingEligibility === "same-project-same-institution-only") add("MEETING_FOOD", "동일 기관·해당 과제 참여연구자만의 회의 식비는 계상할 수 없습니다.", "제25조제4항", "risk")
    } else if (x.category === "meal") {
      if (!x.mealBasis || x.mealBasis === "unknown") add("MEAL_BASIS", "일상 식사·회의·출장·야근 식대를 구분하세요. 영수증 시각만으로 야근을 판단하지 않습니다.", "제25조제14항")
      if (x.mealBasis === "weekday-lunch") add("LUNCH", "연구인력 지원비로 평일 점심 식대를 계상할 수 없습니다.", "제25조제14항제6호", "risk")
      if (x.mealBasis === "overtime" && !x.meetingDetails?.trim()) add("OVERTIME", "야근 수행 업무·근무기록·내부 지급기준이 필요합니다.", "제10조·제25조, 내부규정")
    }
    if (x.category === "travel" || x.mealBasis === "travel") {
      if (!x.travelReport || !x.travelPolicy) add("TRAVEL", "출장 목적·일정·경로·차량·운행내역 및 적용 여비규정을 확인하세요.", "제25조제6·7항")
    }
    if (x.overlappingMeal) add("DOUBLE_MEAL", "출장 식비·제공 식사와 중복한 식대를 조정하세요.", "제25조제7항·제14항제6호", "risk")
    if (x.category === "office") {
      if (!x.labPlanApproved) add("LAB_PLAN", "영리기관 연구실운영비 활용·관리계획 및 필요한 변경승인을 확인하세요.", "제68조제4·5항, 제73조")
      if (!x.inspectionConfirmed) add("INSPECTION", "물품 수령·검수·사용 장소를 확인하세요. 사진만으로 검수가 완료되지는 않습니다.", "제22조제3항")
    }
    if (x.category === "material" && !x.inspectionConfirmed) add("MATERIAL", "연구재료 사용계획·수량·수령 및 검수를 확인하세요.", "제9조, 제22조")
    if (x.category === "software") {
      if (!x.softwareContractDate || !x.softwareTermChecked) add("SOFTWARE", "구독 계정·계약일·사용기간·과제 활용 및 사무용/연구용 분류를 확인하세요.", "제25조제9~12항, 제68조")
      if (x.softwareContractDate && x.projectEnd && !x.softwareExceptionApproved) {
        const end = new Date(x.projectEnd+"T00:00:00Z")
        const day = end.getUTCDate(); end.setUTCDate(1); end.setUTCMonth(end.getUTCMonth()-2)
        const last = new Date(Date.UTC(end.getUTCFullYear(),end.getUTCMonth()+1,0)).getUTCDate()
        end.setUTCDate(Math.min(day,last))
        if (x.softwareContractDate > end.toISOString().slice(0,10)) add("SOFTWARE_DEADLINE", "원칙적인 단계 종료 2개월 전 계약 기한을 넘습니다. 적용 예외를 확인하세요.", "제25조제9항", "risk")
      }
    }
    if (!x.category || x.category === "other") add("CATEGORY", "연구비 사용용도와 비목을 담당자가 분류해야 합니다.", "제5~17조")
  } else if (x.funding === "private" || x.funding === "self") {
    add("CONTRACT_REVIEW", "민간수탁·자체 R&D는 계약·내부규정·세무 기준의 별도 심사가 필요합니다. 국가과제 규정을 자동 적용하지 않습니다.", "적용범위 분리")
  }
  const status = issues.some(i=>i.level === "risk") ? "위반 위험 검토" : issues.some(i=>i.code === "PROJECT") ? "과제 미지정" : issues.length ? "보완 필요" : "사전검토 통과"
  return {version:RULE_VERSION, status, issues, accountingApproved:false, source:SOURCE}
}
