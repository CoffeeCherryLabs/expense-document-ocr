import {syncDrive} from "../src/driveSync.js"
try {const result=await syncDrive();console.log(JSON.stringify(result));if(result.failed)process.exitCode=1}
catch(error) {
  // Only fixed categories and HTTP status, never upstream bodies, IDs or receipt text.
  const message=error instanceof Error?error.message:""
  const status=message.match(/^Remote API ([a-z.]+): HTTP (\d{3})$/)
  console.error(status?`Drive sync failed: ${status[1]} HTTP ${status[2]}`:message==="Dashboard summary layout changed: review configured block"?"Drive sync failed: dashboard summary layout changed":"Drive sync failed. Check cloud credentials, folder/data-source access and settings. No source files were deleted.")
  process.exitCode=1
}
