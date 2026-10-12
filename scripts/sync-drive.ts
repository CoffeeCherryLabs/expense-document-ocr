import {syncDrive} from "../src/driveSync.js"
try {const result=await syncDrive();console.log(JSON.stringify(result));if(result.failed)process.exitCode=1}
catch {console.error("Drive sync failed. Check cloud credentials, folder/data-source access and settings. No source files were deleted.");process.exitCode=1}
