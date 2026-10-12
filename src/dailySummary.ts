import {createHash} from "node:crypto"

export type SummaryRow={id:string;properties:Record<string,any>}
export function businessDate(start:string|null|undefined):string|null {
  if(!start)return null
  const date=new Date(start)
  if(!Number.isFinite(date.getTime()))return null
  if(/^\d{4}-\d{2}-\d{2}$/.test(start))return start
  const p=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(date)
  return ["year","month","day"].map(k=>p.find(v=>v.type===k)!.value).join("-")
}
export function dailyGroups(rows:SummaryRow[]) {
  const groups=new Map<string,{key:string;date:string;people:string[];name:string;amount:number;ids:string[];payments:Map<string,number>}>()
  for(const row of rows){
    const p=row.properties,date=businessDate(p["사용일"]?.date?.start),amount=p["총 금액"]?.number
    if(!date || !Number.isFinite(amount) || p["통화"]?.select?.name!=="KRW" || p["처리 상태"]?.status?.name==="취소·반려")continue
    const persons=p["지출자"]?.people??[],people=persons.map((v:any)=>String(v.id)).sort()
    const key="daily-v1:"+createHash("sha256").update(JSON.stringify([date,people,"KRW"])).digest("hex")
    const name=persons.length?(persons.map((v:any)=>v.name).filter(Boolean).join(", ") || p["지출자 표시"]?.formula?.string || "지출자 확인 필요"):"지출자 확인 필요"
    const group:NonNullable<ReturnType<typeof groups.get>>=groups.get(key)??{key,date,people,name,amount:0,ids:[],payments:new Map<string,number>()}
    group.amount+=amount;group.ids.push(row.id)
    const method=p["결제 방식"]?.select?.name??"확인 필요"
    group.payments.set(method,(group.payments.get(method)??0)+amount)
    groups.set(key,group)
  }
  return [...groups.values()].sort((a,b)=>a.key.localeCompare(b.key)).map(g=>({key:g.key,properties:{
    "하루 사용":{title:[{text:{content:`${g.name} · ${g.amount.toLocaleString("ko-KR")}원`}}]},
    "사용일":{date:{start:g.date}},"지출자":{people:g.people.map(id=>({id}))},
    "하루 합계":{number:g.amount},"지출 건수":{number:g.ids.length},
    "연결 지출":{relation:g.ids.sort().map(id=>({id}))},
    "집계키":{rich_text:[{text:{content:g.key}}]},
    "결제 요약":{rich_text:[{text:{content:[...g.payments].sort(([a],[b])=>a.localeCompare(b)).map(([m,n])=>`${m} ${n.toLocaleString("ko-KR")}원`).join(" · ")}}]}
  }}))
}
// Compare only writable projection values, ignoring Notion response metadata.
export function summaryChanged(row:SummaryRow,properties:Record<string,any>):boolean {
  return Object.entries(properties).some(([key,next])=>{
    const old=row.properties[key]
    if(next.title||next.rich_text){const type=next.title?"title":"rich_text";return (old?.[type]??[]).map((x:any)=>x.plain_text??x.text?.content??"").join("")!==next[type].map((x:any)=>x.text.content).join("")}
    if(next.number!==undefined)return old?.number!==next.number
    if(next.date)return old?.date?.start!==next.date.start
    const type=next.people?"people":"relation"
    return JSON.stringify((old?.[type]??[]).map((x:any)=>x.id).sort())!==JSON.stringify(next[type].map((x:any)=>x.id).sort())
  })
}
