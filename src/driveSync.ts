import {createHash} from "node:crypto"
import {parseOcrText} from "./parser.js"
import {extractTextFromImage} from "./googleVision.js"
import {reviewExpense, type ReviewInput} from "./review.js"
import type {Extraction} from "./types.js"
import {completionGuidance,draftBlocks,evidenceActions} from "./accountingPresentation.js"
import {reportingProperties} from "./reporting.js"
import {dailyGroups,summaryChanged,dashboardTotals,dashboardUpdates} from "./dailySummary.js"

export type Row = {id:string; properties:Record<string,any>}
export type DriveFile = {id:string;name:string;mimeType:string;modifiedTime:string;size?:string;description?:string;parents?:string[]}
const text = (s:string) => ({rich_text:Array.from({length:Math.ceil(s.length/1900)},(_,i)=>({type:"text",text:{content:s.slice(i*1900,(i+1)*1900)}}))})
const value = (p:Row,k:string):string => (p.properties[k]?.rich_text??[]).map((x:any)=>x.plain_text??x.text?.content??"").join("")
const required = (name:string) => {const v=process.env[name];if(!v)throw new Error(`Missing setting: ${name}`);return v}
const sleep = (ms:number) => new Promise(r=>setTimeout(r,ms))
async function jsonRequest(url:string, init:RequestInit={}) {
  // Only retry safe reads and query POSTs. Never blindly retry page creation after an unknown outcome.
  const retrySafe = !init.method || init.method === "GET" || url.endsWith("/query")
  for(let attempt=0;;attempt++) {
    const r=await fetch(url,{...init,signal:AbortSignal.timeout(60000)})
    if((r.status===429 || r.status>=500) && retrySafe && attempt<3){await sleep(Math.min(10000,1000*2**attempt));continue}
    if(!r.ok)throw new Error(`Remote API ${new URL(url).hostname}: HTTP ${r.status}`)
    return r.json() as Promise<any>
  }
}
export async function notion(path:string, method="GET", body?:unknown) {
  await sleep(350)
  return jsonRequest("https://api.notion.com/v1/"+path,{method,headers:{Authorization:`Bearer ${required("NOTION_API_TOKEN")}`,"Notion-Version":"2025-09-03","Content-Type":"application/json"},body:body===undefined?undefined:JSON.stringify(body)})
}
export async function rows(id:string):Promise<Row[]> {
  const result:Row[]=[];let cursor:string|undefined
  do {const r=await notion(`data_sources/${id}/query`,"POST",{page_size:100,start_cursor:cursor});result.push(...r.results);cursor=r.has_more?r.next_cursor:undefined}while(cursor)
  return result
}
export async function googleToken() {
  const data=await jsonRequest("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:required("GOOGLE_CLIENT_ID"),client_secret:required("GOOGLE_CLIENT_SECRET"),refresh_token:required("GOOGLE_REFRESH_TOKEN"),grant_type:"refresh_token"})})
  if(!data.access_token)throw new Error("Google OAuth returned no access token")
  return String(data.access_token)
}
export async function listFolder(token:string, folder:string, seen=new Set<string>()):Promise<DriveFile[]> {
  if(!/^[\w-]+$/.test(folder))throw new Error("Invalid Drive folder ID")
  if(seen.has(folder))return [];seen.add(folder)
  const result:DriveFile[]=[];let pageToken:string|undefined
  do {
    const params=new URLSearchParams({q:`'${folder}' in parents and trashed = false`,pageSize:"100",fields:"nextPageToken,files(id,name,mimeType,modifiedTime,size,description,parents)",supportsAllDrives:"true",includeItemsFromAllDrives:"true"})
    if(pageToken)params.set("pageToken",pageToken)
    const data=await jsonRequest("https://www.googleapis.com/drive/v3/files?"+params,{headers:{Authorization:`Bearer ${token}`}})
    for(const f of data.files as DriveFile[]) {
      if(f.mimeType==="application/vnd.google-apps.folder")result.push(...await listFolder(token,f.id,seen))
      else if(["image/jpeg","image/png","image/webp","application/pdf"].includes(f.mimeType))result.push(f)
    }
    pageToken=data.nextPageToken
  }while(pageToken)
  return result.sort((a,b)=>a.id.localeCompare(b.id))
}
export function transactionKey(x:Extraction):string|null {
  // Card digits are excluded: mobile-payment token digits can differ. Require all other matching facts.
  if(!x.approvalNumber || !x.transactionDate || !x.merchant || x.totalAmount==null || x.totalAmount<=0 || !x.currency)return null
  const merchant=x.merchant.normalize("NFKC").replace(/[^\p{L}\p{N}]/gu,"")
  return [x.transactionDate,x.approvalNumber,x.currency,x.totalAmount,merchant].join("|")
}
export function conflicts(a:Extraction,b:Extraction):boolean {
  return (["totalAmount","transactionDate","approvalNumber","currency"] as const).some(k=>a[k]!=null && b[k]!=null && a[k]!==b[k])
}
export function reviewInputFromRow(p:Row):ReviewInput {
  const check=(k:string)=>p.properties[k]?.checkbox===true
  const date=(k:string)=>p.properties[k]?.date?.start?.slice(0,10)
  const select=(k:string)=>p.properties[k]?.select?.name
  const funding:Record<string,ReviewInput["funding"]>={"TIPS R&D":"tips","국가연구개발":"national","민간수탁":"private","자체 R&D":"self"}
  const category:Record<string,ReviewInput["category"]>={"회의 식비":"meeting","개인 식대":"meal","출장비":"travel","사무용 기기":"office","소프트웨어":"software","연구재료":"material"}
  const meeting:Record<string,ReviewInput["meetingEligibility"]>={"요건 충족":"eligible","동일기관·동일과제 참여자만":"same-project-same-institution-only"}
  const meal:Record<string,ReviewInput["mealBasis"]>={"야근·특근":"overtime","평일 점심":"weekday-lunch","출장":"travel"}
  return {prohibitedReviewed:check("금지·중복·취소 확인"),alcohol:check("주류 포함"),cancelled:check("취소·환불 있음"),duplicateClaim:check("중복 청구 있음"),funding:funding[select("재원 구분")]??"unknown",projectId:value(p,"과제번호"),projectStart:date("과제 시작일"),projectEnd:date("과제 종료일"),policyReviewed:check("규정·협약 확인"),budgetConfirmed:check("승인 예산 확인"),purpose:value(p,"업무 목적·사유"),userConfirmed:check("사용자 확인"),evidenceChecked:check("원본 대조 완료"),payer:p.properties["지출자"]?.people?.[0]?.id,date:date("사용일"),amount:p.properties["총 금액"]?.number,vendorAmount:p.properties["판매처 증빙금액"]?.number,currency:select("통화"),category:category[select("연구비 검토 유형")]??"other",attendees:value(p,"참여자"),meetingDetails:value(p,"회의 내용"),meetingEligibility:meeting[select("회의 식비 요건")]??"unknown",mealBasis:meal[select("식대 근거")]??"unknown",travelReport:check("출장 증빙 확인"),travelPolicy:check("여비규정 확인"),overlappingMeal:check("식대 중복 있음"),labPlanApproved:check("연구실운영비 계획 확인"),inspectionConfirmed:check("검수 확인"),softwareContractDate:date("소프트웨어 계약일"),softwareTermChecked:check("구독기간 확인"),softwareExceptionApproved:check("소프트웨어 예외승인"),vatReviewed:check("부가세 검토 완료"),relatedPartyReviewed:check("내부·특수관계 검토"),paymentMethodReviewed:check("연구비카드 확인")}
}
async function reviewPending(ledger:Row[]) {
  let reviewed=0
  for(const p of ledger)if(p.properties["검토 실행 요청"]?.checkbox===true){
    const result=reviewExpense(reviewInputFromRow(p))
    await notion(`pages/${p.id}`,"PATCH",{properties:{"검토 결과":{select:{name:result.status}},"자동 검토 사유":text(result.issues.length?result.issues.map(i=>`${i.code}: ${i.message} (${i.basis})`).join("\n"):"설정된 사전검토 항목을 충족했습니다. 최종 결재·회계처리·RCMS 등록은 담당자가 진행하세요."),"보완 안내":text(result.issues.length?result.issues.slice(0,3).map(i=>i.message).join(" "):"담당자: 사전검토를 마쳤습니다. 결재와 회계 처리를 진행하세요."),"적용 규정 버전":text(result.version),"자동 검토일":{date:{start:new Date().toISOString()}},"검토 실행 요청":{checkbox:false}}})
    reviewed++
  }
  return reviewed
}
function guessCategory(file:DriveFile,x:Extraction) {
  const s=(file.name+" "+(x.merchant??"")).normalize("NFC")
  if(/ChatGPT|OpenAI|구독/i.test(s))return "구독·소프트웨어"
  if(/Magic.?Mouse|마우스/i.test(s))return "물품 구매"
  if(/주유/.test(s))return "출장 교통비"
  if(/카페|커피|식비|식사|춘담|포케|디벨로핑/.test(s))return "식비·회의비"
  return "기타"
}
/** Run as a single scheduled job. Evidence pages are the durable checkpoints; no local state required. */
export type SyncOptions = {fileId?:string; forceOcr?:boolean; cardClassification?:"non_corporate"; skipReviews?:boolean}
export async function syncDrive(options:SyncOptions={}) {
  if(options.cardClassification && !options.fileId)throw new Error("Card classification requires one explicit file")
  const ledgerId=required("EXPENSE_DATA_SOURCE_ID"), inboxId=required("EVIDENCE_DATA_SOURCE_ID")
  const token=await googleToken(), allFiles=await listFolder(token,required("GOOGLE_DRIVE_FOLDER_ID"))
  const files=options.fileId?allFiles.filter(f=>f.id===options.fileId):allFiles
  if(options.fileId && files.length!==1)throw new Error("Selected receipt is not in the configured Drive folder")
  const evidence=await rows(inboxId), ledger=await rows(ledgerId)
  // Keep chart groups current after a person changes a date or payment method.
  // These derived fields do not alter receipt values or approval state.
  if(!options.fileId)for(const page of ledger){
    const properties=reportingProperties(page.properties["사용일"]?.date?.start,page.properties["결제 방식"]?.select?.name)
    if(Object.entries(properties).some(([key,val])=>page.properties[key]?.select?.name!==val.select.name))
      await notion(`pages/${page.id}`,"PATCH",{properties})
  }
  const byFile=new Map(evidence.map(p=>[value(p,"Drive 파일 ID"),p]))
  const byKey=new Map<string,Row[]>();for(const p of ledger){const k=value(p,"거래 식별키");if(k)byKey.set(k,[...(byKey.get(k)??[]),p])}
  const hashes=new Map(evidence.filter(p=>value(p,"SHA256")).map(p=>[value(p,"SHA256"),p]))
  let processed=0, failed=0, drafts=0, cardMatches=0, ownerMatches=0
  for(const file of files) {
    let record=byFile.get(file.id)
    const link=`https://drive.google.com/file/d/${file.id}/view`
    if(!options.forceOcr && record && value(record,"Drive 수정시각")===file.modifiedTime && record.properties["OCR 상태"]?.select?.name!=="실패"){
      const links=record.properties["연결 지출"]?.relation??[]
      if(links.length===1 && ledger.some(p=>p.id===links[0].id))drafts++
      continue
    }
    if(processed>=Number(process.env.MAX_FILES_PER_RUN??"20"))break
    processed++
    let attemptedCreate=false
    let currentHash:string|undefined
    try {
      if(Number(file.size)>15*1024*1024)throw new Error("파일이 15MiB를 초과합니다. 수동 검토가 필요합니다.")
      const response=await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media&supportsAllDrives=true`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(60000)})
      if(!response.ok)throw new Error(`Drive download HTTP ${response.status}`)
      const bytes=new Uint8Array(await response.arrayBuffer());if(bytes.length>15*1024*1024)throw new Error("파일 크기 초과")
      const hash=createHash("sha256").update(bytes).digest("hex")
      currentHash=hash
      const identical=hashes.get(hash)
      // Adopt the initial local-import manifest by content hash once Drive is connected.
      if(!record && identical && !value(identical,"Drive 파일 ID"))record=identical
      if(!record){attemptedCreate=true;record=await notion("pages","POST",{parent:{data_source_id:inboxId},properties:{"파일명":{title:[{text:{content:file.name.slice(0,150)}}]},"Drive 파일 ID":text(file.id),"원본 링크":{url:link},"OCR 상태":{select:{name:"대기"}}}})}
      byFile.set(file.id,record!)
      const priorHash=value(record!,"SHA256")
      let extraction:Extraction
      if(!options.forceOcr && identical && value(identical,"판독 JSON"))extraction=JSON.parse(value(identical,"판독 JSON"))
      else extraction=parseOcrText(await extractTextFromImage(bytes))
      const payer=!options.cardClassification && extraction.cardLast4===process.env.KNOWN_CARD_LAST4?process.env.KNOWN_CARD_USER_ID:undefined
      // Raw OCR can include personal addresses or card PAN; retain only structured, limited fields.
      const ocrLines=extraction.rawText.split(/\r?\n/)
      const amountLayout=extraction.totalAmount==null?ocrLines.flatMap((l,i)=>/결제금액|공급가액|부가세/.test(l.replace(/\s/g,""))?ocrLines.slice(i,i+8):[])
        .filter(l=>!/(?:카드|계좌)/.test(l) && !/\d{4}[- ]\d{4}[- ]/.test(l)).slice(0,24).map(l=>l.slice(0,100)):undefined
      const cardLayout=extraction.cardLast4==null?ocrLines.flatMap((l,i)=>/카드번호/.test(l.replace(/\s/g,""))?ocrLines.slice(i,i+4):[]).slice(0,8).map(l=>l.replace(/\d/g,"#").slice(0,100)):undefined
      const structured={...extraction,rawText:"",...(amountLayout?.length?{amountLayout}: {}),...(cardLayout?.length?{cardLayout}: {})}
      const changed=Boolean(priorHash && priorHash!==hash)
      const key=transactionKey(extraction), matches=key?byKey.get(key)??[]:[]
      const manualLinks=record!.properties["연결 지출"]?.relation??[]
      const existingLink=manualLinks.length===1?ledger.find(p=>p.id===manualLinks[0].id):undefined
      let match=existingLink??(matches.length===1?matches[0]:undefined)
      const possible=ledger.filter(p=>value(p,"승인·이체 확인번호")===extraction.approvalNumber && p.properties["사용일"]?.date?.start?.slice(0,10)===extraction.transactionDate)
      const collision=!match && possible.length>0
      let note=changed?"원본 내용 변경: 이전 연결과 회계값을 사람이 다시 확인해야 합니다.":matches.length>1?"동일 거래키가 여러 건 있습니다. 중복을 검토하세요.":collision?"동일 날짜·승인번호의 지출이 있으나 다른 필드가 일치하지 않습니다. 새 지출을 만들지 않고 대조를 보류합니다.":""
      // Strict matching misses ambiguous invoices on purpose. They stay in the inbox, never double counted.
      if(!key)note ||= "날짜·승인번호·사용처·금액·통화 중 미확정 항목이 있습니다. 연결 지출을 직접 선택하세요."
      if(changed)match=undefined
      if(!match && key && !changed && !collision && matches.length===0) {
        const review=reviewExpense({funding:"unknown",date:extraction.transactionDate??undefined,amount:extraction.totalAmount,currency:extraction.currency??undefined,payer})
        const reason=review.issues.map(i=>`${i.code}: ${i.message}`).join("\n")
        const properties:Record<string,unknown>={"건명":{title:[{text:{content:`${extraction.transactionDate} ${extraction.merchant} ${extraction.totalAmount}원`.slice(0,150)}}]},"거래 식별키":text(key),"사용처":text(extraction.merchant!),"총 금액":{number:extraction.totalAmount},"카드 승인금액":{number:extraction.totalAmount},"사용일":{date:{start:extraction.transactionDate}},"승인·이체 확인번호":text(extraction.approvalNumber!),"통화":{select:{name:extraction.currency}},"Drive 원본 링크":text(link),"재원 구분":{select:{name:"연구과제 미지정"}},"검토 결과":{select:{name:review.status}},"자동 검토 사유":text(reason),"적용 규정 버전":text(review.version),"처리 상태":{status:{name:"작성 중"}},"OCR 상태":{select:{name:"확인 필요"}},"OCR 추출 결과":text(JSON.stringify(structured)),"OCR 모델 버전":text(extraction.parserVersion),"OCR 검증 결과":{select:{name:"미검증"}},"지출 유형":{select:{name:guessCategory(file,extraction)}},"업로드 메모":text(file.description??"")}
        if(payer){properties["지출자"]={people:[{id:payer}]};properties["카드 매칭 근거"]=text("사전 등록한 기명 카드 끝자리 일치. 사용자 확인 전 초안.")}
        if(extraction.cardLast4)properties["카드·계좌 끝 4자리"]=text(extraction.cardLast4)
        if(options.cardClassification==="non_corporate"){
          properties["결제 방식"]={select:{name:"기타"}}
          properties["카드 매칭 근거"]=text("사용자가 이 거래의 결제 카드를 비법인카드로 명시함. 카드 끝자리 추론 아님. 개인 선지급·정산 대상 여부는 미확정.")
        }
        const guidance=completionGuidance(guessCategory(file,extraction),Boolean(payer))
        properties["보완 안내"]=text(guidance)
        if(payer){properties["결제 방식"]={select:{name:"법인카드"}};properties["결제 수단 명칭"]=text("등록 기명 법인카드")}
        Object.assign(properties,reportingProperties(extraction.transactionDate,(properties["결제 방식"] as any)?.select?.name))
        match=await notion("pages","POST",{parent:{data_source_id:ledgerId},properties,children:draftBlocks(extraction,link,reason,guidance)})
        byKey.set(key,[match!]);ledger.push(match!)
      }
      if(existingLink && extraction.totalAmount!=null && existingLink.properties["총 금액"]?.number!==extraction.totalAmount)note="연결 지출과 새 문서 금액이 다릅니다. 판매처·카드 금액을 보존하고 담당자가 대조하세요."
      if(match && payer && !note && !conflicts(extraction,{transactionDate:match.properties["사용일"]?.date?.start?.slice(0,10),approvalNumber:value(match,"승인·이체 확인번호"),totalAmount:match.properties["총 금액"]?.number,currency:match.properties["통화"]?.select?.name} as Extraction)){
        cardMatches++
        if(match.properties["지출자"]?.people?.some((p:{id:string})=>p.id===payer))ownerMatches++
      }
      if(match)drafts++
      const action=evidenceActions(note,Boolean(match))
      const properties:Record<string,unknown>={"확인 유형":{select:{name:action.type}},"조치 상태":{select:{name:action.state}},"처리 안내":text(action.guidance),"Drive 파일 ID":text(file.id),"원본 링크":{url:link},"Drive 수정시각":text(file.modifiedTime),"SHA256":text(hash),"판독 JSON":text(JSON.stringify(structured)),"OCR 상태":{select:{name:note?"확인 필요":"판독 완료"}},"오류":text(note)}
      // Preserve manual links. A changed original never silently relinks an approved record.
      if(match && !record!.properties["연결 지출"]?.relation?.length)properties["연결 지출"]={relation:[{id:match.id}]}
      if(changed)for(const linked of record!.properties["연결 지출"]?.relation??[])await notion(`pages/${linked.id}`,"PATCH",{properties:{"검토 결과":{select:{name:"보완 필요"}},"보완 안내":text("담당자: 원본 증빙이 변경되었습니다. 기존 지출값과 변경된 원본을 다시 대조하세요."),"자동 검토 사유":text("연결된 Drive 원본 내용이 변경되었습니다. 기존 판독·승인 근거와 재대조가 필요합니다.")}})
      await notion(`pages/${record!.id}`,"PATCH",{properties})
      record!.properties={...record!.properties,...properties};hashes.set(hash,record!)
    } catch (error) {
      const message=error instanceof Error?error.message:""
      if(message==="No text detected in image" && record){
        const previousHash=value(record,"SHA256")
        if(previousHash && currentHash && previousHash!==currentHash)for(const linked of record.properties["연결 지출"]?.relation??[])await notion(`pages/${linked.id}`,"PATCH",{properties:{"검토 결과":{select:{name:"보완 필요"}},"보완 안내":text("담당자: 변경된 원본에서 글자가 검출되지 않았습니다. 선명한 증빙을 확인하고 기존 지출을 대조하세요."),"자동 검토 사유":text("연결 증빙 내용이 변경되었고 문자가 검출되지 않았습니다. 원본을 다시 대조하세요.")}})
        await notion(`pages/${record.id}`,"PATCH",{properties:{"확인 유형":{select:{name:"정보 보완"}},"조치 상태":{select:{name:"보완 대기"}},"처리 안내":text("글자가 검출되지 않았습니다. 참고 사진인지 확인하고 지출에 연결하거나 선명한 영수증을 추가하세요."),"OCR 상태":{select:{name:"확인 필요"}},"오류":text("문자 미검출: 현장·제품 참고 사진인지 확인하고 필요한 경우 지출에 수동 연결하세요. 같은 원본은 재판독하지 않습니다."),"Drive 수정시각":text(file.modifiedTime),...(currentHash?{"SHA256":text(currentHash)}:{})}})
        continue
      }
      failed++
      // Log only status codes and our fixed error categories, never upstream bodies or receipt text.
      const status=message.match(/(?:HTTP |request failed: )(\d{3})/)?.[1]
      console.error(status?`Receipt processing failed: HTTP ${status}`:"Receipt processing failed: verify OCR format and configuration")
      if(!record && !attemptedCreate)record=await notion("pages","POST",{parent:{data_source_id:inboxId},properties:{"파일명":{title:[{text:{content:file.name.slice(0,150)}}]},"Drive 파일 ID":text(file.id),"원본 링크":{url:link}}})
      if(record)await notion(`pages/${record.id}`,"PATCH",{properties:{"확인 유형":{select:{name:"OCR 보완"}},"조치 상태":{select:{name:"보완 대기"}},"처리 안내":text("자동 판독을 재시도합니다. 반복되면 운영 담당자에게 원본 파일과 연결 권한 확인을 요청하세요."),"OCR 상태":{select:{name:"실패"}},"오류":text("파일 처리 실패: 연결 권한, Vision 설정, 파일 형식·크기를 확인하세요. 다음 실행에서 재시도합니다.")}})
    }
  }
  // No receipt data, file IDs, or OAuth secrets in cloud logs.
  const organized=0 // File organization belongs exclusively to the separate weekly job.
  const freshLedger=options.fileId?ledger:await rows(ledgerId)
  const reviewed=options.skipReviews || options.fileId?0:await reviewPending(freshLedger)
  let summaryGroups=0,summaryUpdated=0
  const summaryId=process.env.DAILY_SUMMARY_DATA_SOURCE_ID
  if(!options.fileId && summaryId){
    const alias=process.env.KNOWN_CARD_DISPLAY_NAME,owner=process.env.KNOWN_CARD_USER_ID
    const existing=await rows(summaryId),groups=dailyGroups(freshLedger,alias && owner?{[owner]:alias}: {}),keys=new Set(groups.map(g=>g.key))
    for(const group of groups){
      const matches=existing.filter(p=>value(p,"집계키")===group.key)
      if(matches.length>1)throw new Error("Duplicate daily summary keys: review projection")
      if(!matches.length){await notion("pages","POST",{parent:{data_source_id:summaryId},properties:group.properties});summaryUpdated++}
      else if(summaryChanged(matches[0],group.properties)){await notion(`pages/${matches[0].id}`,"PATCH",{properties:group.properties});summaryUpdated++}
    }
    // Only remove stale automation-owned projections, never source ledger entries.
    for(const page of existing)if(value(page,"집계키").startsWith("daily-v1:") && !keys.has(value(page,"집계키"))){await notion(`pages/${page.id}`,"PATCH",{archived:true});summaryUpdated++}
    summaryGroups=groups.length
  }
  const dashboardBlockId=process.env.DASHBOARD_SUMMARY_BLOCK_ID
  let dashboardUpdated=0
  if(!options.fileId && dashboardBlockId){
    const parent=await notion(`blocks/${dashboardBlockId}`),blocks=await notion(`blocks/${dashboardBlockId}/children`)
    const totals=dashboardTotals(freshLedger),format=(n:number)=>n.toLocaleString("ko-KR")
    const labels=[`전체 사용액 ${format(totals.total)}원`,`회계 처리 완료 ${format(totals.completed)}원 · 미처리 ${format(totals.pending)}건`]
    for(const update of dashboardUpdates(parent,blocks.results,labels)){await notion(`blocks/${update.id}`,"PATCH",update.body);dashboardUpdated++}
  }
  return {scanned:files.length,processed,failed,reviewed,organized,...(!options.fileId && summaryId?{summaryGroups,summaryUpdated}: {}),...(!options.fileId && dashboardBlockId?{dashboardUpdated}: {}),...(options.fileId?{drafts,cardMatches,ownerMatches}: {})}
}
