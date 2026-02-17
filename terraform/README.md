# Terraform Infrastructure

This directory contains the Terraform infrastructure as code for the Serverless Pixel Canvas project.

## Structure

```
terraform/
├── modules/              # Reusable Terraform modules
│   ├── api-gateway/     # API Gateway configuration
│   ├── cloud-function/  # Cloud Function module (reusable)
│   ├── firestore/       # Firestore database
│   ├── iam/             # Service accounts and IAM permissions
│   ├── pubsub/          # Pub/Sub topics and subscriptions
│   └── storage/         # Cloud Storage buckets
└── environments/        # Environment-specific configurations
    ├── dev/            # Development environment
    └── prod/           # Production environment (to be created)
```

## Prerequisites

1. **Google Cloud SDK** installed and authenticated
   ```bash
   gcloud auth login
   gcloud config set project YOUR_PROJECT_ID
   ```

2. **Terraform** installed (version >= 1.0)
   ```bash
   terraform version
   ```

3. **Required GCP APIs** will be automatically enabled by Terraform

4. **Discord Application** created in [Discord Developer Portal](https://discord.com/developers/applications)
   - Get your Discord Client ID, Client Secret, Bot Token, and Public Key

## Quick Start

### Option 1: Using Deployment Script (Recommended)

```powershell
# From the project root
cd scripts
.\deploy.ps1 -ProjectId "your-project-id" -Region "europe-west1"
```

### Option 2: Manual Deployment

1. **Create placeholder function**
   ```powershell
   cd scripts
   .\create-placeholder.ps1
   ```

2. **Setup secrets**
   ```powershell
   .\setup-secrets.ps1 -ProjectId "your-project-id" `
       -DiscordPublicKey "YOUR_DISCORD_PUBLIC_KEY" `
       -DiscordClientSecret "YOUR_CLIENT_SECRET" `
       -DiscordBotToken "YOUR_BOT_TOKEN"
   ```

3. **Configure Terraform variables**
   ```powershell
   cd ..\terraform\environments\dev
   cp terraform.tfvars.example terraform.tfvars
   # Edit terraform.tfvars with your values
   ```

4. **Initialize Terraform**
   ```bash
   terraform init
   ```

5. **Plan the deployment**
   ```bash
   terraform plan
   ```

6. **Apply the infrastructure**
   ```bash
   terraform apply
   ```

7. **Note the outputs**
   ```bash
   terraform output
   ```

## Configuration

### Variables

Edit `environments/dev/terraform.tfvars`:

```hcl
project_id           = "your-gcp-project-id"
region               = "europe-west1"
firestore_location   = "eur3"
discord_client_id    = "YOUR_DISCORD_CLIENT_ID"
```

### Secrets

The following secrets must be created in Google Secret Manager:

- `discord-public-key` - Discord application public key for webhook signature verification
- `discord-client-secret` - Discord OAuth2 client secret
- `discord-bot-token` - Discord bot token for sending messages
- `jwt-secret` - Secret for signing JWT tokens (auto-generated if not provided)

Use the `setup-secrets.ps1` script to create these automatically.

## Architecture

The infrastructure creates:

- **API Gateway**: Single entry point for all HTTP traffic
- **Cloud Functions**:
  - `discord-proxy` - HTTP-triggered (Go), validates Discord webhooks and routes commands
  - `auth-handler` - HTTP-triggered, handles Discord OAuth2
  - `pixel-worker` - Pub/Sub-triggered, processes pixel placement
  - `snapshot-worker` - Pub/Sub-triggered, generates canvas snapshots
  - `session-worker` - Pub/Sub-triggered, manages sessions
- **Pub/Sub Topics**: Event-driven messaging between functions
- **Firestore**: NoSQL database for pixels, users, and sessions
- **Cloud Storage**:
  - Function source code
  - Canvas snapshots
  - Web application hosting
- **IAM**: Service accounts with least-privilege permissions

## Outputs

After deployment, Terraform outputs important information:

- `api_gateway_url` - Use this for Discord webhook configuration
- `discord_webhook_url` - Full Discord webhook URL
- `web_app_url` - Web application hosting URL
- `functions_source_bucket` - Bucket for deploying function code
- `service_accounts` - Service account emails for functions

## Updating Infrastructure

1. Modify Terraform files
2. Run `terraform plan` to preview changes
3. Run `terraform apply` to apply changes

## Updating Function Code

To update function implementations:

1. Create a ZIP file with your function code
2. Upload to the functions source bucket:
   ```bash
   gcloud storage cp function.zip gs://PROJECT-functions-source/FUNCTION_NAME/source.zip
   ```
3. Trigger a re-deployment:
   ```bash
   terraform apply -replace="module.FUNCTION_NAME.google_cloudfunctions2_function.function"
   ```

## Destroying Infrastructure

**WARNING**: This will delete all resources including data!

```bash
cd environments/dev
terraform destroy
```

## Troubleshooting

### API Not Enabled

If you get errors about APIs not being enabled, wait a few minutes and try again. API enablement can take time.

### Insufficient Permissions

Ensure your GCP user has the following roles:
- Owner (or)
- Editor + Security Admin + Service Account Admin

### Function Deployment Fails

Check that:
1. Placeholder function ZIP exists
2. Secrets are created in Secret Manager
3. Service accounts have proper permissions

### API Gateway Errors

API Gateway deployment can take 5-10 minutes. Be patient.

## Cost Estimation

The infrastructure uses serverless services with pay-per-use pricing:

- **Cloud Functions**: Free tier includes 2M invocations/month
- **Pub/Sub**: Free tier includes 10 GB/month
- **Firestore**: Free tier includes 1 GB storage, 50K reads, 20K writes per day
- **Cloud Storage**: $0.020 per GB per month
- **API Gateway**: $3.00 per million API calls

Expected monthly cost for development: **$5-20**
Expected monthly cost under load: **$50-200**

## Security

- All functions use dedicated service accounts with minimal permissions
- Secrets stored in Secret Manager, never in code
- API Gateway provides HTTPS termination
- No public access to backend services
- Discord webhooks use signature verification
- Web API requires JWT authentication

## Next Steps

After infrastructure deployment:

1. Configure Discord webhook URL in Discord Developer Portal
2. Implement and deploy actual function code
3. Register Discord slash commands
4. Deploy web application frontend
5. Set up monitoring dashboards
6. Test end-to-end functionality

## Support

For issues or questions:
- Check Terraform logs: `terraform show`
- Check GCP logs: Cloud Console → Logging
- Review function logs: `gcloud functions logs read FUNCTION_NAME`
