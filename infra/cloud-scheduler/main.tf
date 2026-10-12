# Review draft only. Creating paused resources can still incur charges.
terraform {
  required_version = ">= 1.6.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 6.0, < 8.0"
    }
  }
}
variable "project_id" { type = string }
variable "region" {
  type    = string
  default = "asia-northeast3"
}
variable "image_digest" {
  type = string
  validation {
    condition     = can(regex("@sha256:[a-f0-9]{64}$", var.image_digest))
    error_message = "Use a verified immutable container digest."
  }
}
variable "lock_bucket_name" { type = string }
variable "application_env" {
  type      = map(string)
  sensitive = true
  validation {
    condition = alltrue([for name in keys(var.application_env) : contains([
      "GOOGLE_DRIVE_FOLDER_ID", "EXPENSE_DATA_SOURCE_ID", "EVIDENCE_DATA_SOURCE_ID",
      "DAILY_SUMMARY_DATA_SOURCE_ID", "DASHBOARD_SUMMARY_BLOCK_ID", "KNOWN_CARD_DISPLAY_NAME"
    ], name)])
    error_message = "Only approved application IDs and display alias belong here; flags and secrets have separate inputs."
  }
}
variable "secret_refs" {
  type = map(object({ name = string, version = string }))
  validation {
    condition     = alltrue([for ref in values(var.secret_refs) : can(regex("^[1-9][0-9]*$", ref.version))])
    error_message = "Pin numeric secret versions; do not use latest."
  }
  validation {
    condition = length(var.secret_refs) == 7 && length(setsubtract(toset(keys(var.secret_refs)), toset([
      "NOTION_API_TOKEN", "GOOGLE_CLOUD_API_KEY", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET",
      "GOOGLE_REFRESH_TOKEN", "KNOWN_CARD_LAST4", "KNOWN_CARD_USER_ID"
    ]))) == 0
    error_message = "Supply references for the seven existing credentials/profile settings."
  }
}
variable "allow_application_writes" {
  type    = bool
  default = false
}
variable "scheduler_paused" {
  type    = bool
  default = true
}
provider "google" {
  project = var.project_id
  region  = var.region
}
resource "google_project_service" "api" {
  for_each           = toset(["run.googleapis.com", "cloudscheduler.googleapis.com", "secretmanager.googleapis.com", "storage.googleapis.com"])
  service            = each.key
  disable_on_destroy = false
}
resource "google_service_account" "runtime" {
  account_id   = "receipt-batch-runtime"
  display_name = "Receipt batch runtime"
}
resource "google_service_account" "scheduler" {
  account_id   = "receipt-batch-scheduler"
  display_name = "Receipt batch invocation only"
}
resource "google_storage_bucket" "lock" {
  name                        = var.lock_bucket_name
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false
  depends_on                  = [google_project_service.api]
  lifecycle { prevent_destroy = true }
}
resource "google_project_iam_custom_role" "lock" {
  role_id     = "receiptBatchLock"
  title       = "Receipt batch lock objects"
  permissions = ["storage.objects.create", "storage.objects.get", "storage.objects.delete"]
}
resource "google_storage_bucket_iam_member" "runtime_lock" {
  bucket = google_storage_bucket.lock.name
  role   = google_project_iam_custom_role.lock.name
  member = "serviceAccount:${google_service_account.runtime.email}"
}
resource "google_secret_manager_secret_iam_member" "runtime_secret" {
  for_each   = toset([for ref in values(var.secret_refs) : ref.name])
  secret_id  = each.key
  role       = "roles/secretmanager.secretAccessor"
  member     = "serviceAccount:${google_service_account.runtime.email}"
  depends_on = [google_project_service.api]
}
resource "google_cloud_run_v2_job" "receipt" {
  name                = "receipt-intake"
  location            = var.region
  deletion_protection = true
  template {
    task_count  = 1
    parallelism = 1
    template {
      service_account = google_service_account.runtime.email
      timeout         = "1200s"
      max_retries     = 0
      containers {
        image = var.image_digest
        resources { limits = { cpu = "1", memory = "512Mi" } }
        dynamic "env" {
          for_each = nonsensitive(var.application_env)
          content {
            name  = env.key
            value = env.value
          }
        }
        dynamic "env" {
          for_each = var.secret_refs
          content {
            name = env.key
            value_source {
              secret_key_ref {
                secret  = env.value.name
                version = env.value.version
              }
            }
          }
        }
        env {
          name  = "EXPENSE_SYNC_ENABLED"
          value = var.allow_application_writes ? "true" : "false"
        }
        env {
          name  = "DRIVE_ORGANIZE_ENABLED"
          value = "false"
        }
        env {
          name  = "MAX_FILES_PER_RUN"
          value = "20"
        }
        env {
          name  = "SYNC_LOCK_BUCKET"
          value = google_storage_bucket.lock.name
        }
      }
    }
  }
  depends_on = [google_project_service.api, google_storage_bucket_iam_member.runtime_lock, google_secret_manager_secret_iam_member.runtime_secret]
}
resource "google_cloud_run_v2_job_iam_member" "invoke" {
  location = var.region
  name     = google_cloud_run_v2_job.receipt.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.scheduler.email}"
}
resource "google_cloud_scheduler_job" "receipt" {
  name             = "receipt-intake-half-hour"
  region           = var.region
  schedule         = "13,43 * * * *"
  time_zone        = "Asia/Seoul"
  paused           = var.scheduler_paused
  attempt_deadline = "60s"
  retry_config {
    retry_count        = 0
    max_retry_duration = "0s"
  }
  http_target {
    http_method = "POST"
    uri         = "https://run.googleapis.com/v2/projects/${var.project_id}/locations/${var.region}/jobs/${google_cloud_run_v2_job.receipt.name}:run"
    body        = base64encode("{}")
    headers     = { "Content-Type" = "application/json" }
    oauth_token {
      service_account_email = google_service_account.scheduler.email
      scope                 = "https://www.googleapis.com/auth/cloud-platform"
    }
  }
  depends_on = [google_project_service.api, google_cloud_run_v2_job_iam_member.invoke]
}
