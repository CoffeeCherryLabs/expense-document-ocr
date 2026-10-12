import assert from "node:assert/strict"
import test from "node:test"
import {reportingMonth,reportingProperties} from "../src/reporting.js"

test("reporting months use Korean business dates at UTC month boundaries",()=>{
  assert.equal(reportingMonth("2026-09-30T15:00:00Z"),"2026-10")
  assert.equal(reportingMonth("2026-09-30T14:59:59Z"),"2026-09")
  assert.equal(reportingMonth("2026-10-01"),"2026-10")
  assert.equal(reportingMonth("invalid"),null)
  assert.equal(reportingMonth(null),null)
})

test("unknown payment remains an explicit reporting bucket without approval fields",()=>{
  assert.deepEqual(reportingProperties("2026-10-01",null),{"집계 월":{select:{name:"2026-10"}},"집계 결제방식":{select:{name:"확인 필요"}}})
  assert.equal(reportingProperties(null,"개인카드")["집계 결제방식"].select.name,"개인카드")
})
