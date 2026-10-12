import type { Extraction } from "./types.js"

export function completionGuidance(category:string, registeredCard:boolean) {
  const actions=["업무 목적과 재원(운영비/과제)을 입력하세요."]
  if(category==="식비·회의비")actions.push("회의·식사는 참석자를 입력하세요.")
  if(!registeredCard)actions.push("결제 수단과 지출자를 확인하세요.")
  actions.push("원본 대조 후 사용자 확인을 체크하세요.")
  return actions.join(" ")
}

export function draftBlocks(x:Extraction,link:string,reason:string,guidance:string) {
  const paragraph=(s:string)=>({object:"block",type:"paragraph",paragraph:{rich_text:[{type:"text",text:{content:s.slice(0,1900)}}]}})
  return [paragraph("접수 초안 · 다음 할 일은 ‘보완 안내’에서 확인하세요."),
    {object:"block",type:"bookmark",bookmark:{url:link}},
    {object:"block",type:"toggle",toggle:{rich_text:[{type:"text",text:{content:"자동 판독·사전검토 기록"}}],children:[
      paragraph(`${x.transactionDate??"날짜 미확정"} / ${x.merchant??"사용처 미확정"} / ${x.totalAmount??"금액 미확정"} ${x.currency??""}`),paragraph(reason),paragraph(guidance),
      paragraph("자동 판독은 결재·회계 처리 완료를 의미하지 않습니다.")
    ]}}
  ]
}

export function evidenceActions(note:string,linked:boolean) {
  if(!note)return {type:"접수 완료",state:"정리 완료",guidance:"지출 초안에 연결했습니다. 지출의 보완 안내를 확인하세요."}
  return {type:"OCR 보완",state:"보완 대기",guidance:linked
    ? "기존 지출에 연결된 증빙입니다. 원본과 날짜·사용처·금액을 대조하고 차이가 있으면 담당자에게 확인을 요청하세요."
    : "원본의 날짜·사용처·금액·결제내역을 확인하고 기존 지출에 연결하세요. 중복 거래를 새로 만들지 마세요."}
}
