variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "region" {
  description = "GCP region"
  type        = string
}

variable "function_name" {
  description = "Name of the Cloud Function"
  type        = string
}

variable "runtime" {
  description = "Runtime for the function (e.g., nodejs20, python311)"
  type        = string
  default     = "nodejs20"
}

variable "entry_point" {
  description = "Entry point function name"
  type        = string
}

variable "source_bucket" {
  description = "Source code bucket name"
  type        = string
}

variable "source_object" {
  description = "Source code object name (zip file)"
  type        = string
}

variable "service_account_email" {
  description = "Service account email for the function"
  type        = string
}

variable "max_instances" {
  description = "Maximum number of instances"
  type        = number
  default     = 10
}

variable "min_instances" {
  description = "Minimum number of instances"
  type        = number
  default     = 0
}

variable "memory" {
  description = "Memory allocation (e.g., 256M, 512M, 1Gi)"
  type        = string
  default     = "256M"
}

variable "timeout" {
  description = "Function timeout in seconds"
  type        = number
  default     = 60
}

variable "environment_variables" {
  description = "Environment variables"
  type        = map(string)
  default     = {}
}

variable "secret_environment_variables" {
  description = "Secret environment variables from Secret Manager"
  type = list(object({
    key     = string
    secret  = string
    version = string
  }))
  default = []
}

variable "trigger_topic" {
  description = "Pub/Sub topic to trigger the function (null for HTTP functions)"
  type        = string
  default     = null
}

variable "retry_on_failure" {
  description = "Retry on failure for event-driven functions"
  type        = bool
  default     = true
}

variable "allow_unauthenticated" {
  description = "Allow unauthenticated invocations (for HTTP functions behind API Gateway)"
  type        = bool
  default     = false
}

variable "gateway_service_account" {
  description = "Service account email used by API Gateway to invoke this function (optional, for HTTP functions)"
  type        = string
  default     = null
}

variable "enable_gateway_invoker" {
  description = "Enable IAM binding for API Gateway to invoke this function (use this instead of checking gateway_service_account != null)"
  type        = bool
  default     = false
}

variable "labels" {
  description = "Labels for the function"
  type        = map(string)
  default     = {}
}
