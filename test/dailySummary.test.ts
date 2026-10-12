import test from "node:test"
import assert from "node:assert/strict"
import {businessDate,dailyGroups,summaryChanged,dashboardTotals} from "../src/dailySummary.js"
const row=(id:string,amount:number,date="2026-10-05T15:10:00Z",people=[{id:"person-a",name:"Employee A"}],currency="KRW",status="작성 중")=>({id,properties:{"총 금액":{number:amount},"사용일":{date:{start:date}},"통화":{select:{name:currency}},"처리 상태":{status:{name:status}},"지출자":{people},"결제 방식":{select:{name:"법인카드"}}}})
test("Korean business dates preserve midnight boundaries",()=>{assert.equal(businessDate("2026-10-05T15:10:00Z"),"2026-10-06");assert.equal(businessDate("2026-10-05"),"2026-10-05");assert.equal(businessDate("invalid"),null)})
test("Dashboard separates entered spend from completed accounting",()=>{
 assert.deepEqual(dashboardTotals([row("a",100),row("b",200,undefined,undefined,undefined,"처리 완료"),row("c",50,undefined,undefined,undefined,"취소·반려"),row("d",999,undefined,undefined,"USD")]),{total:300,completed:200,pending:1})
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
