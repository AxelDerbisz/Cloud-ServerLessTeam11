# Reusable Cloud Function module

# Cloud Function (Gen 2)
resource "google_cloudfunctions2_function" "function" {
  name     = var.function_name
  location = var.region
  project  = var.project_id

  build_config {
    runtime     = var.runtime
    entry_point = var.entry_point

    source {
      storage_source {
        bucket = var.source_bucket
        object = var.source_object
      }
    }
  }

  service_config {
    max_instance_count    = var.max_instances
    min_instance_count    = var.min_instances
    available_memory      = var.memory
    timeout_seconds       = var.timeout
    service_account_email = var.service_account_email

    environment_variables = var.environment_variables

    dynamic "secret_environment_variables" {
      for_each = var.secret_environment_variables
      content {
        key        = secret_environment_variables.value.key
        project_id = var.project_id
        secret     = secret_environment_variables.value.secret
        version    = secret_environment_variables.value.version
      }
    }
  }

  # Event trigger for Pub/Sub functions
  dynamic "event_trigger" {
    for_each = var.trigger_topic != null ? [1] : []
    content {
      trigger_region        = var.region
      event_type            = "google.cloud.pubsub.topic.v1.messagePublished"
      pubsub_topic          = var.trigger_topic
      retry_policy          = var.retry_on_failure ? "RETRY_POLICY_RETRY" : "RETRY_POLICY_DO_NOT_RETRY"
      service_account_email = var.service_account_email
    }
  }

  labels = var.labels
}

# Allow unauthenticated invocations for HTTP functions (will be controlled by API Gateway)
resource "google_cloud_run_service_iam_member" "invoker" {
  count = var.allow_unauthenticated && var.trigger_topic == null ? 1 : 0

  project  = google_cloudfunctions2_function.function.project
  location = google_cloudfunctions2_function.function.location
  service  = google_cloudfunctions2_function.function.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}
