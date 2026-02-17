output "api_gateway_url" {
  description = "API Gateway URL (use this for Discord webhook and web app)"
  value       = "https://${module.api_gateway.gateway_url}"
}

output "functions_source_bucket" {
  description = "Cloud Storage bucket for function source code"
  value       = module.storage.functions_source_bucket
}

output "canvas_snapshots_bucket" {
  description = "Cloud Storage bucket for canvas snapshots"
  value       = module.storage.canvas_snapshots_bucket
}

output "web_app_bucket" {
  description = "Cloud Storage bucket for web application"
  value       = module.storage.web_app_bucket
}

output "web_app_url" {
  description = "Web application URL"
  value       = module.storage.web_app_url
}

output "firestore_database" {
  description = "Firestore database name"
  value       = module.firestore.database_name
}

output "pubsub_topics" {
  description = "Pub/Sub topics"
  value = {
    pixel_events    = module.pubsub.pixel_events_topic
    session_events  = module.pubsub.session_events_topic
    snapshot_events = module.pubsub.snapshot_events_topic
    public_pixel    = module.pubsub.public_pixel_topic
    dead_letter     = module.pubsub.dead_letter_topic
  }
}

output "service_accounts" {
  description = "Service account emails"
  value = {
    proxy_functions  = module.iam.proxy_functions_sa_email
    worker_functions = module.iam.worker_functions_sa_email
  }
}

output "discord_webhook_url" {
  description = "Discord webhook URL (configure this in Discord Developer Portal)"
  value       = "https://${module.api_gateway.gateway_url}/discord/webhook"
}
