import type { Client } from "@notionhq/client"
import type { Extraction, OcrProcessingMetadata } from "./types.js"

type NotionProperty = Record<string, unknown> & { type?: string }
type PageWithProperties = { properties?: Record<string, NotionProperty> }

export function normalizePageId(value: string): string {
  const match = value.match(/[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
  if (!match) throw new Error("A valid Notion page ID or URL is required")
  const raw = match[0].replace(/-/g, "")
  return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`
}

function propertyIsEmpty(property?: NotionProperty): boolean {
  if (!property) return true
  const value = property.type ? property[property.type] : undefined
  return value == null || (Array.isArray(value) && value.length === 0)
}

const richText = (content: string) => ({
  rich_text: Array.from({ length: Math.min(50, Math.ceil(content.length / 1900)) }, (_, index) => ({
    type: "text" as const,
    text: { content: content.slice(index * 1900, (index + 1) * 1900) },
  })),
})

export function getEvidenceFileUrls(page: PageWithProperties): string[] {
  const property = page.properties?.["증빙 자료"]
  if (!property || property.type !== "files") return []
  const files = property.files as Array<{ file?: { url?: string }; external?: { url?: string } }>
  return files.map((file) => file.file?.url ?? file.external?.url).filter((url): url is string => Boolean(url))
}

export async function getPageEvidenceUrls(notion:Client,pageId:string,page:PageWithProperties):Promise<string[]> {
  const urls=getEvidenceFileUrls(page)
  if(urls.length)return urls
  let cursor:string|undefined
  do {
    const result=await notion.blocks.children.list({block_id:pageId,page_size:100,start_cursor:cursor})
    for(const block of result.results){
      const b=block as unknown as Record<string,any>
      if(["image","pdf","file"].includes(b.type)){
        const url=b[b.type]?.file?.url??b[b.type]?.external?.url
        if(url)urls.push(url)
      }
    }
    cursor=result.has_more?result.next_cursor??undefined:undefined
  }while(cursor)
  return urls
}

export async function downloadFile(url: string): Promise<Uint8Array> {
  const parsed=new URL(url)
  if(parsed.protocol!=="https:" || ![".amazonaws.com",".notion.so",".notionusercontent.com",".notion-static.com"].some(h=>parsed.hostname.endsWith(h)))throw new Error("Only attached Notion evidence URLs are allowed")
  const response = await fetch(url,{redirect:"error",signal:AbortSignal.timeout(60000)})
  if (!response.ok) throw new Error(`Evidence download failed: ${response.status}`)
  if(Number(response.headers.get("content-length"))>15*1024*1024)throw new Error("Evidence exceeds 15MiB")
  const bytes=new Uint8Array(await response.arrayBuffer())
  if(bytes.length>15*1024*1024)throw new Error("Evidence exceeds 15MiB")
  return bytes
}

export async function updateOcrStatus(notion: Client, pageId: string, status: string, error?: string) {
  const properties: Record<string, unknown> = { "OCR 상태": { select: { name: status } } }
  properties["OCR 오류"] = error ? richText(error) : { rich_text: [] }
  await notion.pages.update({ page_id: pageId, properties: properties as never })
}

export async function applyExtraction(
  notion: Client,
  pageId: string,
  extraction: Extraction,
  overwriteExisting = false,
  processing?: OcrProcessingMetadata,
) {
  const page = await notion.pages.retrieve({ page_id: pageId }) as PageWithProperties
  const candidate: Record<string, unknown> = {
    "사용일": extraction.transactionDate ? { date: { start: extraction.transactionDate } } : undefined,
    "사용처": extraction.merchant ? richText(extraction.merchant) : undefined,
    "총 금액": extraction.totalAmount !== null ? { number: extraction.totalAmount } : undefined,
    "공급가액": extraction.supplyAmount !== null ? { number: extraction.supplyAmount } : undefined,
    "부가세": extraction.vatAmount !== null ? { number: extraction.vatAmount } : undefined,
    "승인·이체 확인번호": extraction.approvalNumber ? richText(extraction.approvalNumber) : undefined,
    "카드·계좌 끝 4자리": extraction.cardLast4 ? richText(extraction.cardLast4) : undefined,
    "통화": extraction.currency ? { select: { name: extraction.currency } } : undefined,
  }
  const properties: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(candidate)) if (value !== undefined && (overwriteExisting || propertyIsEmpty(page.properties?.[name]))) properties[name] = value
  const hasWarnings = Boolean(processing?.warnings.length)
  properties["OCR 상태"] = { select: { name: "확인 필요" } }
  properties["OCR 신뢰도"] = { number: extraction.confidence }
  // Do not persist full OCR: receipts can contain PANs and private delivery addresses.
  properties["OCR 원문"] = richText("구조화된 판독값만 저장합니다. 전체 내용은 접근권한이 유지된 원본에서 확인하세요.")
  properties["OCR 추출 결과"] = richText(JSON.stringify({ ...extraction, rawText: undefined, processing }))
  properties["OCR 문서 유형"] = { select: { name: extraction.documentType } }
  properties["OCR 모델 버전"] = richText(extraction.parserVersion)
  properties["OCR 처리일"] = { date: { start: new Date().toISOString() } }
  properties["OCR 오류"] = hasWarnings ? richText(processing!.warnings.join(" | ")) : { rich_text: [] }
  properties["OCR 실행 요청"] = { checkbox:false }
  await notion.pages.update({ page_id: pageId, properties: properties as never })
}
