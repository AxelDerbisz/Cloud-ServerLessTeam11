variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "region" {
  description = "Firestore region (must be a Firestore location)"
  type        = string
  default = "europe-west9"
}
