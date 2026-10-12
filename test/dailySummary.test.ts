import test from "node:test"
import assert from "node:assert/strict"
import {businessDate,dailyGroups,summaryChanged,dashboardTotals,dashboardUpdates} from "../src/dailySummary.js"
const row=(id:string,amount:number,date="2026-10-05T15:10:00Z",people=[{id:"person-a",name:"Employee A"}],currency="KRW",status="작성 중")=>({id,properties:{"총 금액":{number:amount},"사용일":{date:{start:date}},"통화":{select:{name:currency}},"처리 상태":{status:{name:status}},"지출자":{people},"결제 방식":{select:{name:"법인카드"}}}})
test("Korean business dates preserve midnight boundaries",()=>{assert.equal(businessDate("2026-10-05T15:10:00Z"),"2026-10-06");assert.equal(businessDate("2026-10-05"),"2026-10-05");assert.equal(businessDate("invalid"),null)})
test("Dashboard separates entered spend from completed accounting",()=>{
 assert.deepEqual(dashboardTotals([row("a",100),row("b",200,undefined,undefined,undefined,"처리 완료"),row("c",50,undefined,undefined,undefined,"취소·반려"),row("d",999,undefined,undefined,"USD")]),{total:300,completed:200,pending:1})
})
test("Dashboard handles native callout headers without editing unrelated children",()=>{
 const b=(id:string,type:string,text:string)=>({id,type,[type]:{rich_text:[{plain_text:text}]}})
 const labels=["전체 사용액 100원","회계 처리 완료 0원 · 미처리 1건"]
 const updates=dashboardUpdates(b("parent","callout","전체 사용액 0원"),[b("counts","paragraph",labels[1]),b("scope","paragraph","원화 기준")],labels)
 assert.equal(updates.length,1);assert.equal(updates[0].id,"parent");assert.ok(updates[0].body.callout)
 assert.equal(dashboardUpdates(b("parent","callout",""),[b("total","paragraph",labels[0]),b("counts","paragraph",labels[1])],labels).length,0)
 assert.throws(()=>dashboardUpdates(b("parent","callout","사용자 작성 내용"),[],labels),/layout changed/)
})
test("Daily projection aggregates transactions without splitting or guessing owners",()=>{
 const result=dailyGroups([row("a",100),row("b",200),row("c",50,undefined,[]),row("d",999,undefined,undefined,"USD"),row("e",999,undefined,undefined,undefined,"취소·반려")])
 assert.equal(result.length,2)
 const known=result.find(g=>g.properties["지출자"].people.length)!
 assert.equal(known.properties["하루 합계"].number,300);assert.equal(known.properties["지출 건수"].number,2)
 assert.deepEqual(known.properties["연결 지출"].relation,[{id:"a"},{id:"b"}])
 assert.equal(dailyGroups([row("b",200),row("a",100)])[0].key,known.key)
 assert.equal(dailyGroups([row("a",100)],{"person-a":"담당자"})[0].properties["표시 이름"].rich_text[0].text.content,"담당자")
 assert.match(result.find(g=>!g.properties["지출자"].people.length)!.properties["표시 이름"].rich_text[0].text.content,/미지정/)
})
test("Projection comparison skips unchanged totals and refreshes corrected source values",()=>{
 const g=dailyGroups([row("a",100)])[0]
 assert.equal(summaryChanged({id:"projection",properties:g.properties},g.properties),false)
 assert.equal(summaryChanged({id:"projection",properties:g.properties},dailyGroups([row("a",200)])[0].properties),true)
})
