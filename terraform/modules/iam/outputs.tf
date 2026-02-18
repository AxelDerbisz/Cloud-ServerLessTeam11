output "proxy_functions_sa_email" {
  description = "Proxy functions service account email"
  value       = google_service_account.proxy_functions.email
}

output "worker_functions_sa_email" {
  description = "Worker functions service account email"
  value       = google_service_account.worker_functions.email
}


