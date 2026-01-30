# Pub/Sub topics and subscriptions module

# Dead letter topic
resource "google_pubsub_topic" "dead_letter" {
  name = "dead-letter"
}

# Pixel events topic
resource "google_pubsub_topic" "pixel_events" {
  name = "pixel-events"
}

# Discord commands topic
resource "google_pubsub_topic" "discord_commands" {
  name = "discord-commands"
}

# Session events topic
resource "google_pubsub_topic" "session_events" {
  name = "session-events"
}

# Snapshot events topic
resource "google_pubsub_topic" "snapshot_events" {
  name = "snapshot-events"
}

# Public pixel topic (for real-time web client updates)
resource "google_pubsub_topic" "public_pixel" {
  name = "public-pixel"
}

# Pixel worker subscription
resource "google_pubsub_subscription" "pixel_worker" {
  name  = "pixel-worker-sub"
  topic = google_pubsub_topic.pixel_events.name

  ack_deadline_seconds = 60

  retry_policy {
    minimum_backoff = "10s"
    maximum_backoff = "600s"
  }

  dead_letter_policy {
    dead_letter_topic     = google_pubsub_topic.dead_letter.id
    max_delivery_attempts = 5
  }

  depends_on = [google_pubsub_topic_iam_member.dead_letter_publisher]
}

# Discord worker subscription
resource "google_pubsub_subscription" "discord_worker" {
  name  = "discord-worker-sub"
  topic = google_pubsub_topic.discord_commands.name

  ack_deadline_seconds = 60

  retry_policy {
    minimum_backoff = "10s"
    maximum_backoff = "600s"
  }

  dead_letter_policy {
    dead_letter_topic     = google_pubsub_topic.dead_letter.id
    max_delivery_attempts = 5
  }

  depends_on = [google_pubsub_topic_iam_member.dead_letter_publisher]
}

# Session worker subscription
resource "google_pubsub_subscription" "session_worker" {
  name  = "session-worker-sub"
  topic = google_pubsub_topic.session_events.name

  ack_deadline_seconds = 60

  retry_policy {
    minimum_backoff = "10s"
    maximum_backoff = "600s"
  }

  dead_letter_policy {
    dead_letter_topic     = google_pubsub_topic.dead_letter.id
    max_delivery_attempts = 5
  }

  depends_on = [google_pubsub_topic_iam_member.dead_letter_publisher]
}

# Snapshot worker subscription
resource "google_pubsub_subscription" "snapshot_worker" {
  name  = "snapshot-worker-sub"
  topic = google_pubsub_topic.snapshot_events.name

  ack_deadline_seconds = 120

  retry_policy {
    minimum_backoff = "10s"
    maximum_backoff = "600s"
  }

  dead_letter_policy {
    dead_letter_topic     = google_pubsub_topic.dead_letter.id
    max_delivery_attempts = 5
  }

  depends_on = [google_pubsub_topic_iam_member.dead_letter_publisher]
}

# Dead letter subscription (for monitoring)
resource "google_pubsub_subscription" "dead_letter" {
  name  = "dead-letter-sub"
  topic = google_pubsub_topic.dead_letter.name

  ack_deadline_seconds = 600
}

# IAM for dead letter topic
resource "google_pubsub_topic_iam_member" "dead_letter_publisher" {
  topic  = google_pubsub_topic.dead_letter.name
  role   = "roles/pubsub.publisher"
  member = "serviceAccount:service-${var.project_number}@gcp-sa-pubsub.iam.gserviceaccount.com"
}
