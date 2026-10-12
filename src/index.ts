import { Worker } from "@notionhq/workers"
import { j } from "@notionhq/workers/schema-builder"
import { parseOcrText } from "./parser.js"
import { evaluateExtraction } from "./evaluation.js"
import { applyExtraction, downloadFile, getPageEvidenceUrls, normalizePageId, updateOcrStatus } from "./notion.js"
import { extractTextFromImage } from "./googleVision.js"
import { extractMultipleImages, MAX_EVIDENCE_FILES } from "./multiImage.js"
import type { Extraction, OcrProcessingMetadata } from "./types.js"
import { conflicts, syncDrive } from "./driveSync.js"
import { reviewExpense, type ReviewInput } from "./review.js"
import { timingSafeEqual } from "node:crypto"

const worker = new Worker()
export default worker

function pageReference(body: Record<string, unknown>): string {
  const nested = body.properties as Record<string, unknown> | undefined
  return String(body.page_id ?? body.pageId ?? body.page_url ?? body.url ?? body["페이지 ID"] ?? nested?.["페이지 ID"] ?? "")
}

worker.webhook("processExpenseDocument", {
  title: "Process expense document",
  description: "OCRs up to ten evidence images attached to one Notion expense record and fills empty accounting fields.",
  verify: (request) => {
    const expected=process.env.OCR_WEBHOOK_SECRET, supplied=request.headers["x-expense-secret"]
    const ok=expected && supplied && Buffer.byteLength(expected)===Buffer.byteLength(supplied) && timingSafeEqual(Buffer.from(expected),Buffer.from(supplied))
    return {status:ok?202:401,body:ok?"accepted":"unauthorized"}
  },
  execute: async (events, { notion }) => {
    for (const event of events) {
      const pageId = normalizePageId(pageReference(event.body))
      const overwriteExisting = false
      const allowed=process.env.EXPENSE_DATA_SOURCE_ID
      if(!allowed)throw new Error("EXPENSE_DATA_SOURCE_ID is not configured")
      const page = await notion.pages.retrieve({ page_id: pageId })
      const parent=(page as {parent?:{data_source_id?:string}}).parent
      if(parent?.data_source_id?.replace(/-/g,"")!==allowed.replace(/-/g,""))throw new Error("Expense is outside configured data source")
      try {
        await updateOcrStatus(notion, pageId, "처리 중")
        const attachedUrls = await getPageEvidenceUrls(notion,pageId,page as never)
        const allUrls = attachedUrls
        if (allUrls.length === 0) throw new Error("증빙 자료에 OCR 처리할 이미지가 없습니다")

        const urls = allUrls.slice(0, MAX_EVIDENCE_FILES)
        const truncatedFiles = Math.max(0, allUrls.length - MAX_EVIDENCE_FILES)
        const result = await extractMultipleImages(urls, downloadFile, extractTextFromImage)
        const warnings = [...result.failures]
        if (truncatedFiles > 0) warnings.push(`최대 ${MAX_EVIDENCE_FILES}장만 처리하여 ${truncatedFiles}장을 제외했습니다`)
        const processing: OcrProcessingMetadata = {
          requestedFiles: allUrls.length,
          processedFiles: result.processedFiles,
          failedFiles: result.failures.length,
          truncatedFiles,
          warnings,
        }
        const documents=result.rawText.split(/--- page \d+ ---/).filter(s=>s.trim()).map(parseOcrText)
        if(documents.some((a,i)=>documents.slice(i+1).some(b=>conflicts(a,b))))throw new Error("증빙 간 날짜·금액·승인번호·통화가 다릅니다. 문서별 대조가 필요합니다.")
        const combined=parseOcrText(result.rawText)
        await applyExtraction(notion, pageId, combined, overwriteExisting, processing)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await updateOcrStatus(notion, pageId, "실패", message.slice(0, 1800))
        await notion.pages.update({page_id:pageId,properties:{"OCR 실행 요청":{checkbox:false}}})
      }
    }
  },
})

worker.tool("reviewExpenseDraft", {
  title:"연구비 지출 사전검토",
  description:"Confirmed structured facts only. Returns missing evidence and rule references; never approves accounting.",
  schema:j.object({factsJson:j.string()}),
  execute:({factsJson})=>reviewExpense(JSON.parse(factsJson) as ReviewInput),
})

worker.tool("syncExpenseDrive", {
  title:"Drive 증빙 수신",
  description:"Scans the configured expense folder, records evidence and creates conservative expense drafts. Requires configured cloud OAuth credentials.",
  schema:j.object({}),
  execute:()=>syncDrive(),
})

worker.tool("parseExpenseOcrText", {
  title: "Parse expense OCR text",
  description: "Deterministically parses Korean receipt, invoice, tax invoice, or statement OCR text without using AI credits.",
  schema: j.object({ rawText: j.string().describe("Raw OCR text") }),
  execute: ({ rawText }) => parseOcrText(rawText),
})

worker.tool("evaluateExpenseExtraction", {
  title: "Evaluate expense extraction",
  description: "Compares expected and actual OCR extraction JSON and returns deterministic field accuracy and errors.",
  schema: j.object({ expectedJson: j.string(), actualJson: j.string() }),
  execute: ({ expectedJson, actualJson }) => JSON.stringify(evaluateExtraction(JSON.parse(expectedJson) as Partial<Extraction>, JSON.parse(actualJson) as Partial<Extraction>)),
})
