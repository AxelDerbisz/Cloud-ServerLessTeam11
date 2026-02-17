# Firestore database module

# Enable Firestore in Native mode
resource "google_firestore_database" "database" {
  project     = var.project_id
  name        = "team11-database"
  location_id = var.region
  type        = "FIRESTORE_NATIVE"

  # Prevent accidental deletion
  deletion_policy = "DELETE"
}

resource "google_firestore_index" "pixels_by_user" {
  project    = var.project_id
  database   = google_firestore_database.database.name
  collection = "pixels"

  fields {
    field_path = "userId"
    order      = "ASCENDING"
  }

  fields {
    field_path = "updatedAt"
    order      = "DESCENDING"
  }

  fields {
    field_path = "__name__"
    order      = "DESCENDING"
  }
}
