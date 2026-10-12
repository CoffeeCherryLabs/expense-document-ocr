type SpatialWord={description?:string;boundingPoly?:{vertices?:Array<{x?:number;y?:number}>}}
type VisionResponse = { responses?: Array<{ fullTextAnnotation?: { text?: string }; textAnnotations?: SpatialWord[]; error?: { message?: string } }> }

// Document OCR can emit the entire left column before the right column. Use
// word positions to recover horizontal lines without guessing numeric values.
export function spatialLines(annotations:SpatialWord[]):string {
  const words=annotations.slice(1).flatMap(w=>{
    const v=w.boundingPoly?.vertices
    if(!w.description || !v || v.length<4)return []
    const top=Math.min(...v.map(p=>p.y??0)),bottom=Math.max(...v.map(p=>p.y??0))
    if(bottom<=top)return []
    return [{text:w.description,x:Math.min(...v.map(p=>p.x??0)),top,bottom,center:(top+bottom)/2}]
  }).sort((a,b)=>a.center-b.center)
  const rows:Array<typeof words>=[]
  for(const word of words){
    const row=rows.find(r=>{
      const anchor=r[0]
      return Math.abs(anchor.center-word.center)<=Math.min(anchor.bottom-anchor.top,word.bottom-word.top)*0.45
    })
    if(row)row.push(word);else rows.push([word])
  }
  return rows.map(r=>r.sort((a,b)=>a.x-b.x).map(w=>w.text).join(" ")).join("\n")
}

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
  const spatial=spatialLines(first?.textAnnotations??[])
  return spatial?`${text}\n--- spatial lines ---\n${spatial}`:text
}
