resource "google_service_account" "proxy_functions" {
  account_id   = "proxy-functions-sa"
  display_name = "Proxy Functions Service Account"
  description  = "Service account for HTTP proxy functions (discord-proxy, auth-handler)"
}

# Service account for worker functions (Pub/Sub-triggered)
resource "google_service_account" "worker_functions" {
  account_id   = "worker-functions-sa"
  display_name = "Worker Functions Service Account"
  description  = "Service account for worker functions (pixel-worker, snapshot-worker, session-worker)"
}

# Proxy functions permissions

# Allow proxy functions to publish to Pub/Sub
resource "google_project_iam_member" "proxy_pubsub_publisher" {
  project = var.project_id
  role    = "roles/pubsub.publisher"
  member  = "serviceAccount:${google_service_account.proxy_functions.email}"
}

# Allow proxy functions to read secrets
resource "google_project_iam_member" "proxy_secret_accessor" {
  project = var.project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${google_service_account.proxy_functions.email}"
}

# Allow proxy functions to read Firestore (for auth validation)
resource "google_project_iam_member" "proxy_firestore_user" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.proxy_functions.email}"
}

# Worker functions permissions

# Allow worker functions to read/write Firestore
resource "google_project_iam_member" "worker_firestore_user" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.worker_functions.email}"
}

# Allow worker functions to write to Cloud Storage
resource "google_project_iam_member" "worker_storage_admin" {
  project = var.project_id
  role    = "roles/storage.objectAdmin"
  member  = "serviceAccount:${google_service_account.worker_functions.email}"
}

# Allow worker functions to read secrets
resource "google_project_iam_member" "worker_secret_accessor" {
  project = var.project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${google_service_account.worker_functions.email}"
}

# Allow worker functions to publish to Pub/Sub (for snapshot events)
resource "google_project_iam_member" "worker_pubsub_publisher" {
  project = var.project_id
  role    = "roles/pubsub.publisher"
  member  = "serviceAccount:${google_service_account.worker_functions.email}"
}

# Allow worker functions to subscribe to Pub/Sub
resource "google_project_iam_member" "worker_pubsub_subscriber" {
  project = var.project_id
  role    = "roles/pubsub.subscriber"
  member  = "serviceAccount:${google_service_account.worker_functions.email}"
}

resource "google_project_iam_member" "worker_log_writer" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.worker_functions.email}"
}

resource "google_project_iam_member" "proxy_log_writer" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.proxy_functions.email}"
}

# Allow worker functions to write traces to Cloud Trace
resource "google_project_iam_member" "worker_trace_agent" {
  project = var.project_id
  role    = "roles/cloudtrace.agent"
  member  = "serviceAccount:${google_service_account.worker_functions.email}"
}

# Allow worker functions to write traces via OTLP/Telemetry API
resource "google_project_iam_member" "worker_telemetry_writer" {
  project = var.project_id
  role    = "roles/telemetry.tracesWriter"
  member  = "serviceAccount:${google_service_account.worker_functions.email}"
}

# Allow proxy functions to write traces to Cloud Trace
resource "google_project_iam_member" "proxy_trace_agent" {
  project = var.project_id
  role    = "roles/cloudtrace.agent"
  member  = "serviceAccount:${google_service_account.proxy_functions.email}"
}

# Allow proxy functions to write traces via OTLP/Telemetry API
resource "google_project_iam_member" "proxy_telemetry_writer" {
  project = var.project_id
  role    = "roles/telemetry.tracesWriter"
  member  = "serviceAccount:${google_service_account.proxy_functions.email}"
}
