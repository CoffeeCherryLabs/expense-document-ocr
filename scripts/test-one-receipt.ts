import {syncDrive} from "../src/driveSync.js"

// Settings and transaction-specific labels stay in the private runtime, not Git.
const fileId=process.env.TEST_DRIVE_FILE_ID
if(!fileId || !/^[\w-]+$/.test(fileId))throw new Error("Set TEST_DRIVE_FILE_ID to one verified receipt in the configured folder")
const label=process.env.TEST_CARD_CLASSIFICATION
if(label && label!=="non_corporate")throw new Error("Unsupported transaction label")
try {
  const result=await syncDrive({fileId,forceOcr:process.env.TEST_FORCE_OCR==="true",cardClassification:label as "non_corporate"|undefined,skipReviews:true})
  console.log(JSON.stringify(result))
  if(result.failed)process.exitCode=1
} catch {
  console.error("Single receipt test failed. Verify runtime credentials, folder access, data sources and Vision billing. No receipt content or credentials are logged.")
  process.exitCode=1
}
