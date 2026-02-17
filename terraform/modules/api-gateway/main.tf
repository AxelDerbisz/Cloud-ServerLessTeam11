# API Gateway module

# API Gateway API
resource "google_api_gateway_api" "api" {
  provider = google-beta
  api_id   = var.api_id
  project  = var.project_id
}

# API Gateway API Config
resource "google_api_gateway_api_config" "api_config" {
  provider      = google-beta
  api           = google_api_gateway_api.api.api_id
  api_config_id = var.api_config_id
  project       = var.project_id

  openapi_documents {
    document {
      path     = "spec.yaml"
      contents = base64encode(var.openapi_spec)
    }
  }

  gateway_config {
    backend_config {
      google_service_account = var.gateway_service_account
    }
  }

  lifecycle {
    create_before_destroy = true
  }
}

# API Gateway Gateway
resource "google_api_gateway_gateway" "gateway" {
  provider   = google-beta
  api_config = google_api_gateway_api_config.api_config.id
  gateway_id = var.gateway_id
  project    = var.project_id
  region     = var.region

  labels = var.labels
}
