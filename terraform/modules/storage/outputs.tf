output "functions_source_bucket" {
  description = "Functions source code bucket"
  value       = google_storage_bucket.functions_source.name
}

output "canvas_snapshots_bucket" {
  description = "Canvas snapshots bucket"
  value       = google_storage_bucket.canvas_snapshots.name
}

output "web_app_bucket" {
  description = "Web application bucket"
  value       = google_storage_bucket.web_app.name
}

output "web_app_url" {
  description = "Web application URL"
  value       = "https://storage.googleapis.com/${google_storage_bucket.web_app.name}/index.html"
}
