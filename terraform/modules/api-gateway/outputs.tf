output "gateway_url" {
  description = "API Gateway URL"
  value       = google_api_gateway_gateway.gateway.default_hostname
}

output "api_id" {
  description = "API Gateway API ID"
  value       = google_api_gateway_api.api.api_id
}

output "gateway_id" {
  description = "API Gateway Gateway ID"
  value       = google_api_gateway_gateway.gateway.gateway_id
}
