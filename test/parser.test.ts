import assert from "node:assert/strict"
import test from "node:test"
import { parseOcrText, PARSER_VERSION } from "../src/parser.js"
import { evaluateExtraction } from "../src/evaluation.js"
import { combineOcrPageTexts, extractMultipleImages, MAX_EVIDENCE_FILES } from "../src/multiImage.js"

const receiptPage1 = `신한카드 매출전표\n상호: 커피체리 테스트상점\n사업자등록번호: 123-45-67890\n거래일시 2026-09-17 14:30`
const receiptPage2 = `공급가액 30,000\n부가세 3,000\n합계 33,000\n승인번호 12345678\n카드번호 ****-****-****-1234`

test("parses a Korean card receipt", () => {
  const actual = parseOcrText(`${receiptPage1}\n${receiptPage2}`)
  assert.equal(actual.documentType, "receipt")
  assert.equal(actual.merchant, "커피체리 테스트상점")
  assert.equal(actual.transactionDate, "2026-09-17")
  assert.equal(actual.totalAmount, 33000)
  assert.equal(actual.supplyAmount, 30000)
  assert.equal(actual.vatAmount, 3000)
  assert.equal(actual.approvalNumber, "12345678")
  assert.equal(actual.cardLast4, "1234")
  assert.equal(actual.businessNumber, "123-45-67890")
  assert.equal(actual.parserVersion, PARSER_VERSION)
})

test("letter-spaced payment labels and column totals preserve masked card uncertainty",()=>{
  const x=parseOcrText("상호: 가상카페\n2026-10-01\n공 급 가 액\n부 가 세\n결 제 금 액\n10,000원\n1,000원\n11,000원\n카드번호 1234-5678-****-****\n승인번호 12345678")
  assert.equal(x.totalAmount,11000)
  assert.equal(x.supplyAmount,10000)
  assert.equal(x.vatAmount,1000)
  assert.equal(x.cardLast4,null)
  assert.equal(parseOcrText("결 제 금 액\n11,000원").totalAmount,11000)
  assert.equal(parseOcrText("결 제 금 액\n승인번호 12345678").totalAmount,null)
})

test("combines multiple pages in attachment order and parses fields across pages", () => {
  const combined = combineOcrPageTexts([receiptPage1, receiptPage2])
  assert.match(combined, /^--- page 1 ---/)
  assert.match(combined, /--- page 2 ---/)
  const actual = parseOcrText(combined)
  assert.equal(actual.merchant, "커피체리 테스트상점")
  assert.equal(actual.totalAmount, 33000)
  assert.equal(actual.cardLast4, "1234")
})

test("keeps successful pages and reports a partial failure", async () => {
  const result = await extractMultipleImages(
    ["ok-1", "bad", "ok-2"],
    async (url) => {
      if (url === "bad") throw new Error("download failed")
      return new TextEncoder().encode(url)
    },
    async (bytes) => new TextDecoder().decode(bytes),
  )
  assert.equal(result.processedFiles, 2)
  assert.deepEqual(result.failures, ["파일 2: download failed"])
  assert.match(result.rawText, /ok-1/)
  assert.match(result.rawText, /ok-2/)
})

test("fails only when every file fails", async () => {
  await assert.rejects(
    extractMultipleImages(["bad"], async () => { throw new Error("download failed") }, async () => "unused"),
    /모든 증빙 파일의 OCR 처리에 실패/,
  )
})

test("limits one expense record to ten evidence files", () => {
  assert.equal(MAX_EVIDENCE_FILES, 10)
})

test("evaluates exact expected fields", () => {
  const result = evaluateExtraction({ merchant: "커피체리", totalAmount: 33000 }, { merchant: " 커피체리 ", totalAmount: 33000 })
  assert.equal(result.score, 1)
  assert.equal(result.errors.length, 0)
})
