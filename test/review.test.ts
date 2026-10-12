import assert from "node:assert/strict"
import test from "node:test"
import {reviewExpense, type ReviewInput} from "../src/review.js"
import {parseOcrText} from "../src/parser.js"
const valid: ReviewInput = {funding:"national",projectId:"TEST",projectStart:"2026-01-01",projectEnd:"2026-12-31",date:"2026-10-07",amount:10000,vendorAmount:10000,currency:"KRW",purpose:"연구실험",payer:"tester",policyReviewed:true,budgetConfirmed:true,userConfirmed:true,evidenceChecked:true,vatReviewed:true,prohibitedReviewed:true,relatedPartyReviewed:true,paymentMethodReviewed:true,category:"material",inspectionConfirmed:true}
test("unknown project never passes",()=>assert.equal(reviewExpense({amount:10000}).status,"과제 미지정"))
test("complete evidence passes preliminary checks but never accounting",()=>{const r=reviewExpense(valid);assert.equal(r.status,"사전검토 통과");assert.equal(r.accountingApproved,false)})
test("same-project same-institution meal restriction; not a generic external guest test",()=>{const x={...valid,category:"meeting" as const,attendees:"A/B",meetingDetails:"연구회의",meetingEligibility:"same-project-same-institution-only" as const};assert.equal(reviewExpense(x).status,"위반 위험 검토");assert.equal(reviewExpense({...x,meetingEligibility:"eligible"}).status,"사전검토 통과")})
test("small meeting amount does not bypass attendance",()=>assert.ok(reviewExpense({...valid,category:"meeting",amount:7000}).issues.some(i=>i.code==="MEETING_ELIGIBILITY")))
test("merchant-card mismatch requires reconciliation",()=>assert.ok(reviewExpense({...valid,amount:278636,vendorAmount:271818}).issues.some(i=>i.code==="AMOUNT_CONFLICT")))
test("private research doesn't inherit national automatic approval",()=>assert.equal(reviewExpense({...valid,funding:"private"}).status,"보완 필요"))
test("software boundary uses calendar months and inclusive cutoff",()=>{const x={...valid,category:"software" as const,projectEnd:"2026-04-30",date:"2026-02-28",softwareTermChecked:true,softwareContractDate:"2026-02-28"};assert.equal(reviewExpense(x).status,"사전검토 통과");assert.ok(reviewExpense({...x,softwareContractDate:"2026-03-01"}).issues.some(i=>i.code==="SOFTWARE_DEADLINE"))})
test("refund sign preserved; invalid calendar dates rejected; masked card prefix not last4",()=>{const p=parseOcrText("상호: 가게\n결제금액 -1000원\n2026-02-30\n카드번호 1234-5678-****-****");assert.equal(p.totalAmount,-1000);assert.equal(p.transactionDate,null);assert.equal(p.cardLast4,null)})
test("card app column OCR",()=>{const p=parseOcrText("하나카드\n테스트상점\n9,100 원\n카드번호\n거래유형\n거래일시\n승인번호\n1234-56**-****-4321\n국내일반\n2026.10.07 16:00:00\n12345678\n승인금액\n매입금액\n부가세\n봉사료\n9,100원\n0원\n827원\n0원");assert.equal(p.totalAmount,9100);assert.equal(p.approvalNumber,"12345678");assert.equal(p.cardLast4,"4321");assert.equal(p.merchant,"테스트상점")})
