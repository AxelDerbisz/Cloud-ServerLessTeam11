variable "project_id" {
  description = "GCP project ID"
  type        = string
  default     = "team11-dev"
}

variable "region" {
  description = "GCP region for Cloud Functions and other regional resources"
  type        = string
  default     = "europe-west1"
}

variable "firestore_location" {
  description = "Firestore location (must be a valid Firestore region)"
  type        = string
  default     = "eur3" # Europe multi-region
}

variable "discord_client_id" {
  description = "Discord OAuth2 client ID"
  type        = string
  default     = "1464237067012931665"
}

variable "placeholder_source_path" {
  description = "Path to placeholder function source ZIP file"
  type        = string
  default     = "../../../scripts/placeholder.zip"
}


