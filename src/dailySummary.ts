import {createHash} from "node:crypto"

export type SummaryRow={id:string;properties:Record<string,any>}
export function dashboardUpdates(parent:any,children:any[],labels:string[]) {
  const blocks=[parent,...children].filter(b=>["paragraph","callout"].includes(b.type))
  const plain=(b:any)=>(b[b.type].rich_text??[]).map((v:any)=>v.plain_text??v.text?.content??"").join("")
  const prefixes=["전체 사용액","회계 처리 완료"]
  const matched=prefixes.map(p=>blocks.filter(b=>plain(b).startsWith(p)))
  if(matched.some(m=>m.length!==1))throw new Error("Dashboard summary layout changed: review configured block")
  return matched.flatMap(([block],i)=>plain(block)===labels[i]?[]:[{id:block.id,body:{[block.type]:{rich_text:[{type:"text",text:{content:labels[i]},annotations:{bold:i===0}}]}}}])
}
export function dashboardTotals(rows:SummaryRow[]) {
  let total=0,completed=0,pending=0
  for(const {properties:p} of rows){
    if(p["통화"]?.select?.name!=="KRW" || p["처리 상태"]?.status?.name==="취소·반려")continue
    const amount=p["총 금액"]?.number,valid=Number.isFinite(amount)?amount:0
    total+=valid
    if(p["처리 상태"]?.status?.name==="처리 완료")completed+=valid
    else pending++
  }
  return {total,completed,pending}
}
export function businessDate(start:string|null|undefined):string|null {
  if(!start)return null
  const date=new Date(start)
  if(!Number.isFinite(date.getTime()))return null
  if(/^\d{4}-\d{2}-\d{2}$/.test(start))return start
  const p=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(date)
  return ["year","month","day"].map(k=>p.find(v=>v.type===k)!.value).join("-")
}
export function dailyGroups(rows:SummaryRow[],aliases:Record<string,string>={}) {
  const groups=new Map<string,{key:string;date:string;people:string[];name:string;amount:number;ids:string[];payments:Map<string,number>}>()
  for(const row of rows){
    const p=row.properties,date=businessDate(p["사용일"]?.date?.start),amount=p["총 금액"]?.number
    if(!date || !Number.isFinite(amount) || p["통화"]?.select?.name!=="KRW" || p["처리 상태"]?.status?.name==="취소·반려")continue
    const persons=p["지출자"]?.people??[],people=persons.map((v:any)=>String(v.id)).sort()
    const key="daily-v1:"+createHash("sha256").update(JSON.stringify([date,people,"KRW"])).digest("hex")
    const name=persons.length?(persons.map((v:any)=>aliases[v.id]??v.name).filter(Boolean).join(", ") || p["지출자 표시"]?.formula?.string || "미지정"):"미지정"
    const group:NonNullable<ReturnType<typeof groups.get>>=groups.get(key)??{key,date,people,name,amount:0,ids:[],payments:new Map<string,number>()}
    group.amount+=amount;group.ids.push(row.id)
    const method=p["결제 방식"]?.select?.name??"확인 필요"
    group.payments.set(method,(group.payments.get(method)??0)+amount)
    groups.set(key,group)
  }
  return [...groups.values()].sort((a,b)=>a.key.localeCompare(b.key)).map(g=>({key:g.key,properties:{
    "하루 사용":{title:[{text:{content:g.amount.toLocaleString("ko-KR")}}]},
    "표시 이름":{rich_text:[{text:{content:g.name}}]},
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
