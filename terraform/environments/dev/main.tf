terraform {
  required_version = ">= 1.0"

  backend "gcs" {}

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 5.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

provider "google-beta" {
  project = var.project_id
  region  = var.region
}

# Enable required APIs
resource "google_project_service" "required_apis" {
  for_each = toset([
    "cloudfunctions.googleapis.com",
    "cloudbuild.googleapis.com",
    "apigateway.googleapis.com",
    "servicecontrol.googleapis.com",
    "servicemanagement.googleapis.com",
    "pubsub.googleapis.com",
    "firestore.googleapis.com",
    "storage.googleapis.com",
    "secretmanager.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "iam.googleapis.com",
    "logging.googleapis.com",
    "monitoring.googleapis.com",
    "cloudtrace.googleapis.com",
    "telemetry.googleapis.com",
  ])

  service            = each.value
  disable_on_destroy = false
}

# Get project number
data "google_project" "project" {
  project_id = var.project_id
}

# IAM module
module "iam" {
  source = "../../modules/iam"

  project_id = var.project_id

  depends_on = [google_project_service.required_apis]
}

# Storage module
module "storage" {
  source = "../../modules/storage"

  project_id = var.project_id
  region     = var.region

  depends_on = [google_project_service.required_apis]
}

# Pub/Sub module
module "pubsub" {
  source = "../../modules/pubsub"

  project_number = data.google_project.project.number

  depends_on = [google_project_service.required_apis]
}

# Firestore module
module "firestore" {
  source = "../../modules/firestore"

  project_id = var.project_id
  region     = var.firestore_location

  depends_on = [google_project_service.required_apis]
}

# Placeholder source code for functions
locals {
  function_source_paths = {
    "discord-proxy"   = "../../../functions/proxy/discord-proxy"
    "auth-handler"    = "../../../functions/proxy/auth-handler"
    "pixel-worker"    = "../../../functions/worker/pixel-worker-go"
    "snapshot-worker" = "../../../functions/worker/snapshot-worker-go"
    "session-worker"  = "../../../functions/worker/session-worker"
  }
}

data "archive_file" "function_source" {
  for_each = local.function_source_paths

  type        = "zip"
  source_dir  = each.value
  output_path = "${path.module}/.terraform/tmp/${each.key}.zip"
}

resource "google_storage_bucket_object" "function_source_placeholder" {
  for_each = local.function_source_paths

  name   = "${each.key}/source.zip"
  bucket = module.storage.functions_source_bucket
  source = data.archive_file.function_source[each.key].output_path

  depends_on = [module.storage]
}

# Discord proxy function
module "discord_proxy" {
  source = "../../modules/cloud-function"

  project_id              = var.project_id
  region                  = var.region
  function_name           = "discord-proxy"
  runtime                 = "go122"
  entry_point             = "handler"
  source_bucket           = module.storage.functions_source_bucket
  source_object           = google_storage_bucket_object.function_source_placeholder["discord-proxy"].name
  service_account_email   = module.iam.proxy_functions_sa_email
  allow_unauthenticated   = false
  gateway_service_account = module.iam.proxy_functions_sa_email
  memory                  = "256M"
  timeout                 = 60

  environment_variables = {
    PROJECT_ID                   = var.project_id
    PIXEL_EVENTS_TOPIC           = module.pubsub.pixel_events_topic
    SNAPSHOT_EVENTS_TOPIC        = module.pubsub.snapshot_events_topic
    SESSION_EVENTS_TOPIC         = module.pubsub.session_events_topic
    ADMIN_ROLE_IDS               = var.admin_role_ids
    OTEL_SERVICE_NAME            = "discord-proxy"
    OTEL_EXPORTER_OTLP_ENDPOINT  = "https://telemetry.googleapis.com"
  }

  secret_environment_variables = [
    {
      key     = "DISCORD_PUBLIC_KEY"
      secret  = "discord-public-key"
      version = "latest"
    },
    {
      key     = "DISCORD_BOT_TOKEN"
      secret  = "discord-bot-token"
      version = "latest"
    }
  ]

  labels = {
    function_type = "proxy"
    service       = "discord"
  }

  depends_on = [module.iam, module.storage, module.pubsub]
}

# Auth handler function
module "auth_handler" {
  source = "../../modules/cloud-function"

  project_id              = var.project_id
  region                  = var.region
  function_name           = "auth-handler"
  entry_point             = "handler"
  source_bucket           = module.storage.functions_source_bucket
  source_object           = google_storage_bucket_object.function_source_placeholder["auth-handler"].name
  service_account_email   = module.iam.proxy_functions_sa_email
  allow_unauthenticated   = false
  gateway_service_account = module.iam.proxy_functions_sa_email
  enable_gateway_invoker  = true
  memory                  = "256M"
  timeout                 = 60

  environment_variables = {
    PROJECT_ID                   = var.project_id
    DISCORD_CLIENT_ID            = var.discord_client_id
    REDIRECT_URI                 = "https://pixel-canvas-gateway-86fcxr1p.ew.gateway.dev/auth/callback"
    OTEL_SERVICE_NAME            = "auth-handler"
    OTEL_EXPORTER_OTLP_ENDPOINT  = "https://telemetry.googleapis.com"
  }

  secret_environment_variables = [
    {
      key     = "DISCORD_CLIENT_SECRET"
      secret  = "discord-client-secret"
      version = "latest"
    },
    {
      key     = "JWT_SECRET"
      secret  = "jwt-secret"
      version = "latest"
    }
  ]

  labels = {
    function_type = "proxy"
    service       = "auth"
  }

  depends_on = [module.iam, module.storage]
}

# Pixel worker function
module "pixel_worker" {
  source = "../../modules/cloud-function"

  project_id            = var.project_id
  region                = var.region
  function_name         = "pixel-worker"
  runtime               = "go122"
  entry_point           = "handler"
  source_bucket         = module.storage.functions_source_bucket
  source_object         = google_storage_bucket_object.function_source_placeholder["pixel-worker"].name
  service_account_email = module.iam.worker_functions_sa_email
  trigger_topic         = "projects/${var.project_id}/topics/${module.pubsub.pixel_events_topic}"
  retry_on_failure      = true
  memory                = "512M"
  timeout               = 120

  environment_variables = {
    PROJECT_ID                   = var.project_id
    PUBLIC_PIXEL_TOPIC           = module.pubsub.public_pixel_topic
    OTEL_SERVICE_NAME            = "pixel-worker"
    OTEL_EXPORTER_OTLP_ENDPOINT  = "https://telemetry.googleapis.com"
  }

  secret_environment_variables = [
    {
      key     = "DISCORD_BOT_TOKEN"
      secret  = "discord-bot-token"
      version = "latest"
    }
  ]

  labels = {
    function_type = "worker"
    service       = "pixel"
  }

  depends_on = [module.iam, module.storage, module.pubsub]
}

# Snapshot worker function
module "snapshot_worker" {
  source = "../../modules/cloud-function"

  project_id            = var.project_id
  region                = var.region
  function_name         = "snapshot-worker"
  runtime               = "go122"
  entry_point           = "handler"
  source_bucket         = module.storage.functions_source_bucket
  source_object         = google_storage_bucket_object.function_source_placeholder["snapshot-worker"].name
  service_account_email = module.iam.worker_functions_sa_email
  trigger_topic         = "projects/${var.project_id}/topics/${module.pubsub.snapshot_events_topic}"
  retry_on_failure      = true
  memory                = "1Gi"
  timeout               = 300

  environment_variables = {
    PROJECT_ID                   = var.project_id
    SNAPSHOTS_BUCKET             = module.storage.canvas_snapshots_bucket
    OTEL_SERVICE_NAME            = "snapshot-worker"
    OTEL_EXPORTER_OTLP_ENDPOINT  = "https://telemetry.googleapis.com"
  }

  secret_environment_variables = [
    {
      key     = "DISCORD_BOT_TOKEN"
      secret  = "discord-bot-token"
      version = "latest"
    }
  ]

  labels = {
    function_type = "worker"
    service       = "snapshot"
  }

  depends_on = [module.iam, module.storage, module.pubsub]
}

# Session worker function
module "session_worker" {
  source = "../../modules/cloud-function"

  project_id            = var.project_id
  region                = var.region
  function_name         = "session-worker"
  entry_point           = "handler"
  source_bucket         = module.storage.functions_source_bucket
  source_object         = google_storage_bucket_object.function_source_placeholder["session-worker"].name
  service_account_email = module.iam.worker_functions_sa_email
  trigger_topic         = "projects/${var.project_id}/topics/${module.pubsub.session_events_topic}"
  retry_on_failure      = true
  memory                = "512M"
  timeout               = 120

  environment_variables = {
    PROJECT_ID                   = var.project_id
    OTEL_SERVICE_NAME            = "session-worker"
    OTEL_EXPORTER_OTLP_ENDPOINT  = "https://telemetry.googleapis.com"
  }

  secret_environment_variables = [
    {
      key     = "DISCORD_BOT_TOKEN"
      secret  = "discord-bot-token"
      version = "latest"
    }
  ]

  labels = {
    function_type = "worker"
    service       = "session"
  }

  depends_on = [module.iam, module.storage, module.pubsub]
}

# API Gateway OpenAPI Spec
locals {
  openapi_spec = templatefile("${path.module}/api-spec.yaml", {
    discord_proxy_url = module.discord_proxy.function_uri
    auth_handler_url  = module.auth_handler.function_uri
  })
}

# API Gateway
module "api_gateway" {
  source = "../../modules/api-gateway"

  project_id               = var.project_id
  region                   = var.region
  api_id                   = "pixel-canvas-api"
  api_config_id            = "pixel-canvas-config-${formatdate("YYYYMMDDHHmmss", timestamp())}"
  gateway_id               = "pixel-canvas-gateway"
  openapi_spec             = local.openapi_spec
  gateway_service_account  = module.iam.proxy_functions_sa_email

  labels = {
    environment = "dev"
  }

  depends_on = [
    module.discord_proxy,
    module.auth_handler,
    google_project_service.required_apis
  ]
}
