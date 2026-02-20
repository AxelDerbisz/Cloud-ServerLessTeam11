# Pub/Sub topics and subscriptions module

# Pixel events topic
resource "google_pubsub_topic" "pixel_events" {
  name = "pixel-events"

  message_retention_duration = "604800s" # 7 days
}

# Pixel events dead letter topic
resource "google_pubsub_topic" "pixel_events_dead_letter" {
  name = "pixel-events-dead-letter"

  message_retention_duration = "604800s" # 7 days
}

# Session events topic
resource "google_pubsub_topic" "session_events" {
  name = "session-events"

  message_retention_duration = "604800s" # 7 days
}

# Session events dead letter topic
resource "google_pubsub_topic" "session_events_dead_letter" {
  name = "session-events-dead-letter"

  message_retention_duration = "604800s" # 7 days
}

# Snapshot events topic
resource "google_pubsub_topic" "snapshot_events" {
  name = "snapshot-events"

  message_retention_duration = "604800s" # 7 days
}

# Snapshot events dead letter topic
resource "google_pubsub_topic" "snapshot_events_dead_letter" {
  name = "snapshot-events-dead-letter"

  message_retention_duration = "604800s" # 7 days
}

# Public pixel topic (for real-time web client updates)
resource "google_pubsub_topic" "public_pixel" {
  name = "public-pixel"

  message_retention_duration = "604800s" # 7 days
}

# Public pixel dead letter topic
resource "google_pubsub_topic" "public_pixel_dead_letter" {
  name = "public-pixel-dead-letter"

  message_retention_duration = "604800s" # 7 days
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
    dead_letter_topic     = google_pubsub_topic.pixel_events_dead_letter.id
    max_delivery_attempts = 5
  }

  depends_on = [google_pubsub_topic_iam_member.pixel_events_dead_letter_publisher]
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
    dead_letter_topic     = google_pubsub_topic.session_events_dead_letter.id
    max_delivery_attempts = 5
  }

  depends_on = [google_pubsub_topic_iam_member.session_events_dead_letter_publisher]
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
    dead_letter_topic     = google_pubsub_topic.snapshot_events_dead_letter.id
    max_delivery_attempts = 5
  }

  depends_on = [google_pubsub_topic_iam_member.snapshot_events_dead_letter_publisher]
}

# Dead letter subscriptions (for monitoring)
resource "google_pubsub_subscription" "pixel_events_dead_letter" {
  name  = "pixel-events-dead-letter-sub"
  topic = google_pubsub_topic.pixel_events_dead_letter.name

  ack_deadline_seconds = 600
}

resource "google_pubsub_subscription" "session_events_dead_letter" {
  name  = "session-events-dead-letter-sub"
  topic = google_pubsub_topic.session_events_dead_letter.name

  ack_deadline_seconds = 600
}

resource "google_pubsub_subscription" "snapshot_events_dead_letter" {
  name  = "snapshot-events-dead-letter-sub"
  topic = google_pubsub_topic.snapshot_events_dead_letter.name

  ack_deadline_seconds = 600
}

resource "google_pubsub_subscription" "public_pixel_dead_letter" {
  name  = "public-pixel-dead-letter-sub"
  topic = google_pubsub_topic.public_pixel_dead_letter.name

  ack_deadline_seconds = 600
}

# IAM for dead letter topics
resource "google_pubsub_topic_iam_member" "pixel_events_dead_letter_publisher" {
  topic  = google_pubsub_topic.pixel_events_dead_letter.name
  role   = "roles/pubsub.publisher"
  member = "serviceAccount:service-${var.project_number}@gcp-sa-pubsub.iam.gserviceaccount.com"
}

resource "google_pubsub_topic_iam_member" "session_events_dead_letter_publisher" {
  topic  = google_pubsub_topic.session_events_dead_letter.name
  role   = "roles/pubsub.publisher"
  member = "serviceAccount:service-${var.project_number}@gcp-sa-pubsub.iam.gserviceaccount.com"
}

resource "google_pubsub_topic_iam_member" "snapshot_events_dead_letter_publisher" {
  topic  = google_pubsub_topic.snapshot_events_dead_letter.name
  role   = "roles/pubsub.publisher"
  member = "serviceAccount:service-${var.project_number}@gcp-sa-pubsub.iam.gserviceaccount.com"
}

resource "google_pubsub_topic_iam_member" "public_pixel_dead_letter_publisher" {
  topic  = google_pubsub_topic.public_pixel_dead_letter.name
  role   = "roles/pubsub.publisher"
  member = "serviceAccount:service-${var.project_number}@gcp-sa-pubsub.iam.gserviceaccount.com"
}
