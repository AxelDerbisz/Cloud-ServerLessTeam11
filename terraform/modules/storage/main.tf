# Cloud Storage buckets module

# Bucket for function source code
resource "google_storage_bucket" "functions_source" {
  name     = "${var.project_id}-functions-source"
  location = var.region

  uniform_bucket_level_access = true
  force_destroy               = true # Allow deletion even with objects

  versioning {
    enabled = true
  }

  lifecycle_rule {
    action {
      type = "Delete"
    }
    condition {
      num_newer_versions = 5
    }
  }
}

# Bucket for canvas snapshots
resource "google_storage_bucket" "canvas_snapshots" {
  name     = "${var.project_id}-canvas-snapshots"
  location = var.region

  uniform_bucket_level_access = true
  force_destroy               = true

  lifecycle_rule {
    action {
      type = "Delete"
    }
    condition {
      days_since_noncurrent_time = 30
    }
  }
}

# Bucket for web application hosting
resource "google_storage_bucket" "web_app" {
  name     = "${var.project_id}-web-app"
  location = var.region

  uniform_bucket_level_access = true
  force_destroy               = true

  website {
    main_page_suffix = "index.html"
    not_found_page   = "404.html"
  }

  cors {
    origin          = ["*"]
    method          = ["GET", "HEAD", "PUT", "POST", "DELETE"]
    response_header = ["*"]
    max_age_seconds = 3600
  }
}

# Make web app bucket publicly readable
resource "google_storage_bucket_iam_member" "web_app_public" {
  bucket = google_storage_bucket.web_app.name
  role   = "roles/storage.objectViewer"
  member = "allUsers"
}
