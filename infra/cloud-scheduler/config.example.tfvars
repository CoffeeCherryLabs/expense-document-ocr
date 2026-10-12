# Copy outside the repository. These are placeholders, never real secret values.
project_id       = "REPLACE_COMPANY_PROJECT"
lock_bucket_name = "REPLACE_UNIQUE_PRIVATE_LOCK_BUCKET"
image_digest     = "asia-northeast3-docker.pkg.dev/PROJECT/REPOSITORY/receipt@sha256:REPLACE_VERIFIED_DIGEST"
application_env = {
  GOOGLE_DRIVE_FOLDER_ID       = "REPLACE"
  EXPENSE_DATA_SOURCE_ID       = "REPLACE"
  EVIDENCE_DATA_SOURCE_ID      = "REPLACE"
  DAILY_SUMMARY_DATA_SOURCE_ID = "REPLACE"
  DASHBOARD_SUMMARY_BLOCK_ID   = "REPLACE"
  KNOWN_CARD_DISPLAY_NAME      = "REPLACE_PRIVATE_ALIAS"
}
secret_refs = {
  NOTION_API_TOKEN     = { name = "receipt-notion-token", version = "1" }
  GOOGLE_CLOUD_API_KEY = { name = "receipt-vision-key", version = "1" }
  GOOGLE_CLIENT_ID     = { name = "receipt-google-client-id", version = "1" }
  GOOGLE_CLIENT_SECRET = { name = "receipt-google-client-secret", version = "1" }
  GOOGLE_REFRESH_TOKEN = { name = "receipt-google-refresh-token", version = "1" }
  KNOWN_CARD_LAST4     = { name = "receipt-card-last4", version = "1" }
  KNOWN_CARD_USER_ID   = { name = "receipt-card-owner", version = "1" }
}
allow_application_writes = false
scheduler_paused         = true
