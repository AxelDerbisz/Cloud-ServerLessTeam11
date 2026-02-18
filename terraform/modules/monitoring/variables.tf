variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "function_names" {
  description = "List of Cloud Function names to monitor"
  type        = list(string)
}
