/** Reporting metadata is derived from entered values, never financial approval. */
export function reportingMonth(start:string|null|undefined):string|null {
  if(!start)return null
  if(/^\d{4}-\d{2}-\d{2}$/.test(start))return start.slice(0,7)
  const date=new Date(start)
  if(!Number.isFinite(date.getTime()))return null
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Seoul",year:"numeric",month:"2-digit"}).formatToParts(date)
  return `${parts.find(p=>p.type==="year")!.value}-${parts.find(p=>p.type==="month")!.value}`
}

export function reportingProperties(date:string|null|undefined, payment:string|null|undefined) {
  return {"집계 월":{select:{name:reportingMonth(date)??"미지정"}},"집계 결제방식":{select:{name:payment??"확인 필요"}}}
}
