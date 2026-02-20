# Collaborative Pixel Canvas

A serverless multiplayer drawing platform inspired by Reddit's r/place. Users draw pixels on a shared canvas through Discord slash commands and a web interface.

## Project Structure

```
functions/
  proxy/
    discord-proxy/       Discord interactions handler (Go)
    auth-handler/        OAuth2 login and user auth (Node.js)
    web-proxy/           Web pixel API (Node.js)
  worker/
    pixel-worker-go/     Processes pixel placements (Go)
    snapshot-worker-go/  Generates canvas snapshots (Go)
    session-worker/      Manages canvas sessions (Node.js)
pixel-web/
  frontend/              React web app (App Engine)
terraform/
  environments/dev/      Dev environment config
  modules/               Reusable Terraform modules
docs/
  architecture.md        Architecture diagram
  firestore-schema.md    Firestore data model
scripts/                 Setup and deployment scripts
```

## Architecture

All traffic goes through API Gateway. Proxy functions acknowledge requests and publish events to Pub/Sub topics. Worker functions subscribe to topics and process events asynchronously.

- Discord slash commands -> API Gateway -> Discord Proxy -> Pub/Sub -> Workers
- Web pixel placement -> API Gateway -> Web Proxy -> Pub/Sub -> Pixel Worker
- Auth flow -> API Gateway -> Auth Handler -> Discord OAuth2

Workers write to Firestore. The web frontend streams updates in real-time using Firestore onSnapshot.

See [docs/architecture.md](docs/architecture.md) for the full diagram.

## GCP Services Used

- Cloud Functions Gen2 (compute)
- API Gateway (routing)
- Pub/Sub (async messaging)
- Firestore (database)
- Cloud Storage (snapshots)
- Secret Manager (secrets)
- Cloud Logging, Cloud Monitoring, Cloud Trace (observability)
- App Engine (web frontend hosting)

## Prerequisites

- GCP project with billing enabled
- Terraform >= 1.0
- Go >= 1.22
- Node.js >= 20
- gcloud CLI authenticated

## Setup

### 1. Configure secrets

Create the following secrets in Secret Manager:

- `discord-public-key` - Discord application public key
- `discord-bot-token` - Discord bot token
- `discord-client-secret` - Discord OAuth2 client secret
- `jwt-secret` - JWT signing secret
- `admin-role-ids` - Comma-separated Discord role IDs for admin access

Or use the setup script:

```
scripts/setup-secrets.ps1
```

### 2. Deploy infrastructure

```
cd terraform/environments/dev
terraform init -backend-config=../../backends/dev/dev.config
terraform plan
terraform apply
```

### 3. Register Discord commands

Update `scripts/register-discord-commands-curl.ps1` with your application ID and bot token, then run it.

### 4. Deploy the web frontend

```
cd pixel-web/frontend
npm install
npm run build
gcloud app deploy
```

### 5. Set the Discord interactions endpoint

In the Discord Developer Portal, set your application's Interactions Endpoint URL to:

```
https://<your-gateway-domain>/discord/webhook
```

## Discord Commands

| Command | Description | Access |
|---|---|---|
| `/draw x y color` | Place a pixel on the canvas | Everyone |
| `/canvas` | View current canvas status | Everyone |
| `/session start [width] [height]` | Start a new session | Admin |
| `/session pause` | Pause the session | Admin |
| `/session reset` | Reset the canvas | Admin |
| `/snapshot` | Generate and post a canvas image | Admin |

## Firestore Schema

See [docs/firestore-schema.md](docs/firestore-schema.md) for the full data model.

Collections: `pixels`, `sessions`, `rate_limits`, `users`.

## Monitoring

- Structured JSON logging in all Terraform-managed functions
- Cloud Monitoring dashboard with log-based metrics
- Distributed tracing via Cloud Trace (Go functions use GCP exporter)
- IAM least-privilege with dedicated service accounts for proxy and worker functions
