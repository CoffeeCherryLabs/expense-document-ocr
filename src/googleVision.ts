type VisionResponse = { responses?: Array<{ fullTextAnnotation?: { text?: string }; textAnnotations?: Array<{ description?: string }>; error?: { message?: string } }> }

export async function extractTextFromImage(imageBytes: Uint8Array): Promise<string> {
  const apiKey = process.env.GOOGLE_CLOUD_API_KEY
  if (!apiKey) throw new Error("GOOGLE_CLOUD_API_KEY is not configured")
  const pdf = Buffer.from(imageBytes.slice(0,5)).toString() === "%PDF-"
  const endpoint = `https://vision.googleapis.com/v1/${pdf ? "files" : "images"}:annotate`
  const content = Buffer.from(imageBytes).toString("base64")
  const request = pdf ? {inputConfig:{content,mimeType:"application/pdf"},features:[{type:"DOCUMENT_TEXT_DETECTION"}]} : {image:{content},features:[{type:"DOCUMENT_TEXT_DETECTION"}],imageContext:{languageHints:["ko","en"]}}
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({ requests: [request] }),
    signal: AbortSignal.timeout(60000),
  })
  if (!response.ok) throw new Error(`Google Vision request failed: ${response.status}`)
  if(pdf){
    const data=await response.json() as {responses?:Array<{totalPages?:number;error?:unknown;responses?:Array<{fullTextAnnotation?:{text?:string};error?:unknown}>}>}
    const file=data.responses?.[0], pages=file?.responses??[]
    if(file?.error || pages.some(p=>p.error) || !file?.totalPages || file.totalPages!==pages.length)throw new Error("PDF partial OCR or more than five pages: manual review required")
    const text=pages.map(p=>p.fullTextAnnotation?.text??"").join("\n")
    if(!text.trim())throw new Error("No text detected in PDF")
    return text
  }
  const data = await response.json() as VisionResponse
  const first = data.responses?.[0]
  if (first?.error?.message) throw new Error(`Google Vision error: ${first.error.message}`)
  const text = first?.fullTextAnnotation?.text ?? first?.textAnnotations?.[0]?.description ?? ""
  if (!text.trim()) throw new Error("No text detected in image")
  return text
}
