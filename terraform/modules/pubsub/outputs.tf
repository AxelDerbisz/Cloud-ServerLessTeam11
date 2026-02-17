output "pixel_events_topic" {
  description = "Pixel events topic name"
  value       = google_pubsub_topic.pixel_events.name
}

output "session_events_topic" {
  description = "Session events topic name"
  value       = google_pubsub_topic.session_events.name
}

output "snapshot_events_topic" {
  description = "Snapshot events topic name"
  value       = google_pubsub_topic.snapshot_events.name
}

output "dead_letter_topic" {
  description = "Dead letter topic name"
  value       = google_pubsub_topic.dead_letter.name
}

output "public_pixel_topic" {
  description = "Public pixel topic name (for real-time web client updates)"
  value       = google_pubsub_topic.public_pixel.name
}
