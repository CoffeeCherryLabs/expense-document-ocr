import type { DocumentType, Extraction } from "./types.js"

export const PARSER_VERSION = "receipt-parser-v6"
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
  // Korean receipts sometimes print thousands separators as periods (32.000).
  // Keep real decimal amounts, especially on foreign-currency invoices.
  const parsed = digits(/[₩￦원]|부가세|사업자/.test(lines.join("\n")) && /\d[.,]\d{3}(?:\D|$)/.test(value)
    ? value.replace(/(?<=\d)\.(?=\d{3}(?:\D|$))/g, "") : value)
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
  const title=text.split(/\r?\n/).slice(0,12).join(" ").replace(/\s/g, "")
  if (/거래명세서|거래명세표/.test(title)) return "statement"
  if (text.split(/\r?\n/).slice(0,12).some(l=>/^(?:전자)?세금계산서$/.test(l.replace(/\s/g,"")))) return "tax_invoice"
  if (/신용카드|결제정보|^Receipt\b/i.test(text)) return "receipt"
  if (/invoice|청구서/i.test(text)) return "invoice"
  if (/영수증|매출전표|승인번호|현금영수증/.test(text)) return "receipt"
  return "unknown"
}

function fallbackMerchant(lines: string[]): string | null {
  const ignored = /^(?:---\s*)?(?:page\s+\d+|spatial lines)(?:\s*---)?$|영수증|매출전표|세금계산서|거래명세|승인|사업자|전화|대표|주소|합계|금액|부가세|공급가액|카드|일시|날짜|주문\(대기\)|^수량$|^Invoice$|^Receipt$/i
  return lines.find((line) => line.length >= 2 && line.length <= 50 && !ignored.test(line) && !/^[-\d\s.,/:()]+$/.test(line)) ?? null
}

export function parseOcrText(rawText: string): Extraction {
  // Printed receipt labels often contain letter spacing. Normalize labels only,
  // preserving line boundaries and unrelated values (card numbers included).
  const normalized=rawText.replace(/공[ \t]*급[ \t]*가[ \t]*액/g,"공급가액")
    .replace(/합[ \t]*계[ \t]*금[ \t]*액/g,"합계금액")
    .replace(/부[ \t]*가[ \t]*세/g,"부가세")
    .replace(/결[ \t]*제[ \t]*금[ \t]*액/g,"결제금액")
    .replace(/승[ \t]*인[ \t]*금[ \t]*액/g,"승인금액")
  const lines = normalized.split(/\r?\n/).map(clean).filter(Boolean)
  const isCardStatement = /하나카드/.test(rawText) && /거래유형/.test(rawText) && /승인금액/.test(rawText)
  const merchant = labeledValue(lines, [/^(?:상호|가맹점명|공급자|업체명)\s*[:：]\s*(.+)$/i, /\[매장명\]\s*(.+)/])
    ?? lines.find(l=>/^\[.+(?:점|소|카페)\]$/.test(l))?.replace(/^\[|\]$/g, "")
    ?? (isCardStatement ? lines.find((l,i)=>i>0 && /^[-\d,\s]+원$/.test(lines[i+1]??"")) ?? null : fallbackMerchant(lines))
  const amountTable = rawText.match(/승인금액\s*\n매입금액\s*\n부가세[\s\S]*?\n(-?[\d, ]+)\s*원\s*\n/)
  const receiptTable = normalized.match(/공급가액\s*\n부가세\s*\n결제금액\s*\n([\d, ]+)\s*원\s*\n([\d, ]+)\s*원\s*\n([\d, ]+)\s*원/)
  const saleTable=rawText.match(/판매금액\s*:\s*\n부가세\s*:\s*\n승인금액\s*:\s*\n([\d, ]+)\s*\n([\d, ]+)\s*\n([\d, ]+)/)
  const detailAmount=/상세내역/.test(rawText) ? rawText.match(/\n([\d, ]+)\s*원\s*\n\[사용자지정\]/) : null
  const labeledNext=rawText.match(/(?:승인\s*금액|결제\s*금액)\s*:\s*\n(-?[\d, ]+)\s*원/)
  const bracketAmount=rawText.match(/\[금액\]\s*([\d, ]+)\s*원/)
  const pairedAmount=(label:string):number|null=>{
    const index=lines.findIndex(l=>l.replace(/\s/g,"").replace(/[:：]$/,"")===label)
    const next=lines[index+1]
    return index>=0 && next && /^-?[\d, ]+\s*원?$/.test(next)?digits(next):null
  }
  const totalAmount = parseAmount(lines, [/(?:실제\s*총\s*결제\s*금액|합\s*계\s*금액|총\s*금액|합\s*계|결제\s*금액|승인\s*금액|공급대가|Amount paid|Total)\s*[:：]?\s*([₩￦\w\s,.-]*\d[\d,.-]*)/i])
    ?? (amountTable ? digits(amountTable[1]) : receiptTable ? digits(receiptTable[3]) : saleTable ? digits(saleTable[3]) : detailAmount ? digits(detailAmount[1]) : labeledNext ? digits(labeledNext[1]) : bracketAmount ? digits(bracketAmount[1]) : null)
    ?? pairedAmount("결제금액") ?? pairedAmount("승인금액")
  const supplyAmount = parseAmount(lines, [/(?:공급가액|공급\s*가액)\s*[:：]?\s*([₩￦\w\s,.-]*\d[\d,.-]*)/i]) ?? (receiptTable?digits(receiptTable[1]):pairedAmount("공급가액"))
  const vatAmount = parseAmount(lines, [/(?:부가세|부가가치세|VAT)\s*[:：]?\s*([₩￦\w\s,.-]*\d[\d,.-]*)/i]) ?? (receiptTable?digits(receiptTable[2]):pairedAmount("부가세"))
  const approvalNumber = labeledValue(lines, [/(?:승인\s*번호|승인\s*No\.?|approval\s*(?:no|number))\s*[:：#]?\s*([0-9][0-9 ]{5,11})(?![0-9a-z])/i])?.replace(/\s/g,"")
    ?? (/승인번호/.test(rawText) && lines.filter(l=>/^\d{8}$/.test(l)).length === 1 ? lines.find(l=>/^\d{8}$/.test(l))! : null)
  const businessNumber = labeledValue(lines, [/(?:사업자등록번호|사업자번호)\s*[:：]?\s*(\d{3}[- ]?\d{2}[- ]?\d{5})/i])?.replace(/\s/g, "") ?? null
  // Loyalty cards are often printed before the payment card. Only payment
  // context can supply an owner match; never infer digits hidden by a mask.
  let loyalty=false
  const paymentLines=lines.filter(l=>{
    if(/포인트|적립|보너스카드/.test(l))loyalty=true
    if(/신용카드|신용\s*카드|신용\s*승인|결제정보|Payment method/.test(l))loyalty=false
    return !loyalty
  })
  const candidates=paymentLines.filter(l=>isCardStatement || /카드\s*번호|Mastercard|Visa|American Express/i.test(l)).map(l=>{
    const compact=l.replace(/\s/g,"").replace(/[‐‑–—_]/g,"-")
    return compact.match(/(?:[\d*Xx]{4}-){3}(\d{4})(?!\d)/)?.[1]
      ?? compact.match(/카드번호[:：]?[\d*Xx]{8,12}(\d{4})(?![\d*Xx])/)?.[1]
      ?? compact.match(/(?:Mastercard|Visa|AmericanExpress)-(\d{4})(?!\d)/i)?.[1]
  }).filter((v):v is string=>Boolean(v))
  const cardLast4 = new Set(candidates).size===1 ? candidates[0] : null
  const transactionDate = parseDate(rawText)
  const currency = /\bUSD\b/i.test(rawText) ? "USD" : /\bCNY\b|RMB/i.test(rawText) ? "CNY" : /\bJPY\b/i.test(rawText) ? "JPY" : /\bEUR\b|€/i.test(rawText) ? "EUR" : /\bKRW\b|원|₩|￦/i.test(rawText) || /사업자등록번호|부가세/.test(rawText) ? "KRW" : null
  const core = [merchant, transactionDate, totalAmount]
  const confidence = Number((core.filter((value) => value !== null).length / core.length).toFixed(2))
  return { documentType: detectDocumentType(rawText), merchant, transactionDate, totalAmount, supplyAmount, vatAmount, approvalNumber, cardLast4, businessNumber, currency, rawText, confidence, parserVersion: PARSER_VERSION }
}
