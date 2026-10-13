import type {Extraction} from "./types.js"

export type OrganizableFile={id:string;name:string;mimeType:string;parents?:string[];modifiedTime:string}
const folderMime="application/vnd.google-apps.folder"
export function organizedName(file:OrganizableFile,x:Extraction):string|null {
  const extensions:Record<string,string>={"image/jpeg":"jpg","image/png":"png","image/webp":"webp","application/pdf":"pdf"}
  const ext=extensions[file.mimeType],date=x.transactionDate
  if(!ext || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10)!==date || !x.merchant || x.currency!=="KRW" || !Number.isSafeInteger(x.totalAmount) || x.totalAmount!<=0 || !x.approvalNumber || !/^[\w-]+$/.test(file.id))return null
  const merchant=x.merchant.normalize("NFC").replace(/[\p{Cc}\\/:*?"<>|]/gu,"").replace(/\s+/g," ").trim().slice(0,45)
  if(!merchant)return null
  const type={receipt:"영수증",invoice:"청구서",tax_invoice:"세금계산서",statement:"거래내역",unknown:"증빙"}[x.documentType]
  // Full file ID makes names deterministic and collision-free, including duplicate uploads.
  return `${date}_${merchant}_${x.totalAmount}원_${type}_${file.id}.${ext}`
}

export async function organizeFile(options:{token:string;root:string;inbox:string;file:OrganizableFile;extraction:Extraction;corroborated:boolean;confirmed?:boolean;audit:(event:unknown)=>Promise<void>}) {
  const {token,root,inbox,file,extraction,audit}=options
  const name=organizedName(file,extraction)
  const source=options.confirmed && file.parents?.[0]===root?root:inbox
  if((!options.corroborated && !options.confirmed) || !name || root===inbox || !file.parents?.includes(source))return {moved:false}
  const request=async(path:string,method="GET",body?:unknown)=>{
    const r=await fetch("https://www.googleapis.com/drive/v3/files"+path,{method,headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(60000)})
    if(!r.ok)throw new Error(`Drive organization HTTP ${r.status}`)
    return r.json() as Promise<any>
  }
  for(const id of [root,inbox,file.id])if(!/^[\w-]+$/.test(id))throw new Error("Invalid organization ID")
  const inboxMeta=await request(`/${inbox}?fields=parents,mimeType&supportsAllDrives=true`)
  if(inboxMeta.mimeType!==folderMime || !inboxMeta.parents?.includes(root))throw new Error("Upload inbox must be a direct child of expense root")
  const current=await request(`/${file.id}?fields=id,name,parents,modifiedTime,permissions&supportsAllDrives=true`)
  if(current.modifiedTime!==file.modifiedTime || current.name!==file.name || current.parents?.length!==1 || current.parents[0]!==source)throw new Error("Source changed before organization")
  let parent=root
  for(const part of [extraction.transactionDate!.slice(0,4),extraction.transactionDate!.slice(0,7),extraction.transactionDate!]){
    const q=new URLSearchParams({q:`'${parent}' in parents and name = '${part}' and mimeType = '${folderMime}' and trashed = false`,fields:"files(id),nextPageToken",supportsAllDrives:"true",includeItemsFromAllDrives:"true"})
    const found=await request("?"+q)
    if(found.nextPageToken || found.files.length>1)throw new Error("Ambiguous destination folders")
    // Unknown create outcomes are resolved by looking up the folder on the next run; no blind retry.
    parent=found.files[0]?.id ?? (await request("?supportsAllDrives=true","POST",{name:part,mimeType:folderMime,parents:[parent]})).id
  }
  const destination=await request(`/${parent}?fields=permissions&supportsAllDrives=true`)
  const access=(permissions:any[])=>permissions.map(p=>JSON.stringify([p.type,p.emailAddress??p.domain??"",p.role,p.allowFileDiscovery??false])).sort().join("|")
  if(!Array.isArray(current.permissions) || !Array.isArray(destination.permissions) || !current.permissions.length || access(current.permissions)!==access(destination.permissions))throw new Error("Destination access differs; review sharing before organization")
  const event={fileId:file.id,before:{name:file.name,parents:current.parents},after:{name,parents:[parent]},at:new Date().toISOString()}
  // Durable intent must succeed BEFORE a file mutation. Recovery can inspect both states after timeouts.
  await audit({status:"planned",...event})
  const result=await request(`/${file.id}?`+new URLSearchParams({addParents:parent,removeParents:source,fields:"id,name,parents,modifiedTime",supportsAllDrives:"true"}),"PATCH",{name})
  const verified=await request(`/${file.id}?fields=id,name,parents,modifiedTime,permissions&supportsAllDrives=true`)
  if(verified.name!==name || verified.parents?.length!==1 || verified.parents[0]!==parent || !Array.isArray(verified.permissions) || access(verified.permissions)!==access(current.permissions))throw new Error("Move outcome or access requires reconciliation")
  await audit({status:"completed",...event})
  return {moved:true,file:verified}
}
