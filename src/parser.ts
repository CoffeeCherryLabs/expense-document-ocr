import type { DocumentType, Extraction } from "./types.js"

export const PARSER_VERSION = "receipt-parser-v3"
const clean = (value: string) => value.replace(/\s+/g, " ").trim()
const digits = (value: string) => Number(value.replace(/[^0-9.-]/g, ""))

function labeledValue(lines: string[], labels: RegExp[]): string | null {
  for (const line of lines) for (const label of labels) {
    const match = line.match(label)
    if (match?.[1]) return clean(match[1])
  }
  return null
}

function parseAmount(lines: string[], labels: RegExp[]): number | null {
  const value = labeledValue(lines, labels)
  if (!value) return null
  const parsed = digits(value)
  return Number.isFinite(parsed) ? parsed : null
}

function parseDate(text: string): string | null {
  text=text.replace(/(20\d{2}[.\/-]\d{2}[.\/-]\d{2})(\d{2}:\d{2})/g,"$1 $2")
  const patterns = [
    /\b(20\d{2})[.\/-]\s*(\d{1,2})[.\/-]\s*(\d{1,2})\b/,
    /\b(\d{2})[.\/-]\s*(\d{1,2})[.\/-]\s*(\d{1,2})\b/,
    /(20\d{2})년\s*(\d{1,2})월\s*(\d{1,2})일/,
  ]
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (!match) continue
    let year = Number(match[1]); if (year < 100) year += 2000
    const month = Number(match[2]); const day = Number(match[3])
    const date = new Date(Date.UTC(year, month - 1, day))
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) continue
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
  }
  return null
}

function detectDocumentType(text: string): DocumentType {
  if (/전자세금계산서|세금계산서/.test(text)) return "tax_invoice"
  if (/거래명세서|거래명세표/.test(text)) return "statement"
  if (/invoice|청구서/i.test(text)) return "invoice"
  if (/영수증|매출전표|승인번호|현금영수증/.test(text)) return "receipt"
  return "unknown"
}

function fallbackMerchant(lines: string[]): string | null {
  const ignored = /^(?:---\s*)?page\s+\d+(?:\s*---)?$|영수증|매출전표|세금계산서|거래명세|승인|사업자|전화|대표|주소|합계|금액|부가세|공급가액|카드|일시|날짜/i
  return lines.find((line) => line.length >= 2 && line.length <= 50 && !ignored.test(line) && !/^[-\d\s.,/:()]+$/.test(line)) ?? null
}

export function parseOcrText(rawText: string): Extraction {
  const lines = rawText.split(/\r?\n/).map(clean).filter(Boolean)
  const isCardStatement = /하나카드/.test(rawText) && /거래유형/.test(rawText) && /승인금액/.test(rawText)
  const merchant = labeledValue(lines, [/^(?:상호|가맹점명|공급자|업체명)\s*[:：]\s*(.+)$/i, /\[매장명\]\s*(.+)/])
    ?? lines.find(l=>/^\[.+(?:점|소|카페)\]$/.test(l))?.replace(/^\[|\]$/g, "")
    ?? (isCardStatement ? lines.find((l,i)=>i>0 && /^[-\d,\s]+원$/.test(lines[i+1]??"")) ?? null : fallbackMerchant(lines))
  const amountTable = rawText.match(/승인금액\s*\n매입금액\s*\n부가세[\s\S]*?\n(-?[\d, ]+)\s*원\s*\n/)
  const receiptTable = rawText.match(/공급가\s*액\s*\n부가\s*세\s*\n결제금액\s*\n([\d, ]+)원\s*\n([\d, ]+)원\s*\n([\d, ]+)\s*원/)
  const saleTable=rawText.match(/판매금액\s*:\s*\n부가세\s*:\s*\n승인금액\s*:\s*\n([\d, ]+)\s*\n([\d, ]+)\s*\n([\d, ]+)/)
  const detailAmount=/상세내역/.test(rawText) ? rawText.match(/\n([\d, ]+)\s*원\s*\n\[사용자지정\]/) : null
  const labeledNext=rawText.match(/(?:승인\s*금액|결제\s*금액)\s*:\s*\n(-?[\d, ]+)\s*원/)
  const bracketAmount=rawText.match(/\[금액\]\s*([\d, ]+)\s*원/)
  const totalAmount = parseAmount(lines, [/(?:총\s*금액|합\s*계|결제\s*금액|승인\s*금액|공급대가|Amount paid|Total)\s*[:：]?\s*([₩￦\w\s,.-]*\d[\d,.-]*)/i])
    ?? (amountTable ? digits(amountTable[1]) : receiptTable ? digits(receiptTable[3]) : saleTable ? digits(saleTable[3]) : detailAmount ? digits(detailAmount[1]) : labeledNext ? digits(labeledNext[1]) : bracketAmount ? digits(bracketAmount[1]) : null)
  const supplyAmount = parseAmount(lines, [/(?:공급가액|공급\s*가액)\s*[:：]?\s*([₩￦\w\s,.-]*\d[\d,.-]*)/i])
  const vatAmount = parseAmount(lines, [/(?:부가세|부가가치세|VAT)\s*[:：]?\s*([₩￦\w\s,.-]*\d[\d,.-]*)/i])
  const approvalNumber = labeledValue(lines, [/(?:승인\s*번호|승인\s*No\.?|approval\s*(?:no|number))\s*[:：#]?\s*([0-9][0-9 ]{5,11})(?![0-9a-z])/i])?.replace(/\s/g,"")
    ?? (/승인번호/.test(rawText) && lines.filter(l=>/^\d{8}$/.test(l)).length === 1 ? lines.find(l=>/^\d{8}$/.test(l))! : null)
  const businessNumber = labeledValue(lines, [/(?:사업자등록번호|사업자번호)\s*[:：]?\s*(\d{3}[- ]?\d{2}[- ]?\d{5})/i])?.replace(/\s/g, "") ?? null
  const cardLast4 = lines.map(l=>l.match(/(?:[\d*Xx]{4}-){3}(\d{4})(?!\d)/)?.[1]).find(Boolean) ?? null
  const transactionDate = parseDate(rawText)
  const currency = /\bUSD\b/i.test(rawText) ? "USD" : /\bCNY\b|RMB/i.test(rawText) ? "CNY" : /\bJPY\b/i.test(rawText) ? "JPY" : /\bEUR\b|€/i.test(rawText) ? "EUR" : /\bKRW\b|원|₩|￦/i.test(rawText) || /사업자등록번호|부가세/.test(rawText) ? "KRW" : null
  const core = [merchant, transactionDate, totalAmount]
  const confidence = Number((core.filter((value) => value !== null).length / core.length).toFixed(2))
  return { documentType: detectDocumentType(rawText), merchant, transactionDate, totalAmount, supplyAmount, vatAmount, approvalNumber, cardLast4, businessNumber, currency, rawText, confidence, parserVersion: PARSER_VERSION }
}
