variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "region" {
  description = "GCP region"
  type        = string
}

variable "api_id" {
  description = "API Gateway API ID"
  type        = string
}

variable "api_config_id" {
  description = "API Gateway API Config ID"
  type        = string
}

variable "gateway_id" {
  description = "API Gateway Gateway ID"
  type        = string
}

variable "openapi_spec" {
  description = "OpenAPI specification (YAML content)"
  type        = string
}

variable "gateway_service_account" {
  description = "Service account for API Gateway"
  type        = string
}

variable "labels" {
  description = "Labels for the gateway"
  type        = map(string)
  default     = {}
}
