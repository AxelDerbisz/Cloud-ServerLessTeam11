# Serverless Pixel Canvas

A fully serverless, event-driven collaborative pixel canvas application inspired by Reddit's r/place. Users can draw pixels via Discord bot commands or a web interface, with all changes synchronized in real-time.

## Features

- **Discord Bot Integration**: Draw pixels and manage sessions via Discord slash commands
- **Web Application**: Interactive canvas with Discord OAuth2 authentication
- **Real-time Updates**: Firestore real-time listeners for instant canvas synchronization
- **Event-Driven Architecture**: Asynchronous processing via Google Cloud Pub/Sub
- **Serverless**: 100% serverless using Google Cloud Functions, Firestore, and Cloud Storage
- **Rate Limiting**: Per-user rate limits to prevent abuse
- **Admin Controls**: Session management and canvas snapshots for administrators
- **Infrastructure as Code**: Complete Terraform configuration for reproducible deployments

## Architecture

```
┌─────────────┐         ┌──────────────┐
│   Discord   │────────▶│ API Gateway  │
└─────────────┘         └──────┬───────┘
                               │
┌─────────────┐                │
│  Web Client │────────────────┘
└─────────────┘         │
                        ▼
              ┌─────────────────┐
              │ Proxy Functions │
              │ (HTTP)          │
              └────────┬────────┘
                       │
                       ▼
              ┌─────────────────┐
              │    Pub/Sub      │
              │    Topics       │
              └────────┬────────┘
                       │
                       ▼
              ┌─────────────────┐
              │ Worker Functions│
              │ (Event-driven)  │
              └────────┬────────┘
                       │
              ┌────────┴────────┐
              ▼                 ▼
         ┌──────────┐      ┌──────────┐
         │Firestore │      │  Cloud   │
         │          │      │ Storage  │
         └──────────┘      └──────────┘
```

### Components

- **API Gateway**: Single entry point for all HTTP traffic
- **Proxy Functions** (HTTP-triggered):
  - `discord-proxy`: Validates Discord webhooks, publishes to Pub/Sub
  - `web-proxy`: Validates JWT tokens, handles API requests
  - `auth-handler`: Discord OAuth2 authentication
- **Worker Functions** (Pub/Sub-triggered):
  - `pixel-worker`: Processes pixel placements with rate limiting
  - `discord-worker`: Handles Discord slash commands
  - `snapshot-worker`: Generates canvas PNG images
  - `session-worker`: Manages canvas sessions
- **Data Storage**:
  - Firestore: Pixels, users, sessions, rate limits
  - Cloud Storage: Function source code, canvas snapshots, web app

## Prerequisites

- Google Cloud Platform account
- [Google Cloud SDK](https://cloud.google.com/sdk/install) installed and configured
- [Terraform](https://www.terraform.io/downloads) >= 1.0
- [Node.js](https://nodejs.org/) >= 20 (for local function development)
- [Discord Application](https://discord.com/developers/applications) created

## Quick Start

### 1. Clone the Repository

```bash
git clone <repository-url>
cd Cloud-ServerLessTeam11
```

### 2. Set Up Discord Application

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application
3. Go to "Bot" section and create a bot
4. Note down:
   - Application ID (Client ID)
   - Public Key
   - Client Secret
   - Bot Token

### 3. Configure GCP Project

```bash
# Authenticate with GCP
gcloud auth login
gcloud auth application-default login

# Set your project ID
gcloud config set project YOUR_PROJECT_ID
```

### 4. Deploy Infrastructure

#### Option A: Using Deployment Script (Recommended)

```powershell
cd scripts
.\deploy.ps1 -ProjectId "your-project-id" -Region "europe-west1"
```

The script will prompt you for Discord credentials.

#### Option B: Manual Deployment

```powershell
# Create placeholder function
cd scripts
.\create-placeholder.ps1

# Setup secrets
.\setup-secrets.ps1 -ProjectId "your-project-id" `
    -DiscordPublicKey "YOUR_PUBLIC_KEY" `
    -DiscordClientSecret "YOUR_CLIENT_SECRET" `
    -DiscordBotToken "YOUR_BOT_TOKEN"

# Deploy Terraform
cd ..\terraform\environments\dev
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars with your values

terraform init
terraform plan
terraform apply
```

### 5. Configure Discord Webhook

After deployment, Terraform will output the webhook URL:

```
discord_webhook_url = "https://your-api-gateway-url/discord/webhook"
```

1. Go to Discord Developer Portal → Your Application → General Information
2. Set "Interactions Endpoint URL" to the webhook URL
3. Save changes

### 6. Register Discord Commands

Create a script to register slash commands with Discord:

```javascript
// register-commands.js
const https = require('https');

const APPLICATION_ID = 'YOUR_APPLICATION_ID';
const BOT_TOKEN = 'YOUR_BOT_TOKEN';

const commands = [
  {
    name: 'draw',
    description: 'Draw a pixel on the canvas',
    options: [
      { name: 'x', description: 'X coordinate', type: 4, required: true },
      { name: 'y', description: 'Y coordinate', type: 4, required: true },
      { name: 'color', description: 'Color in hex (e.g., #FF0000)', type: 3, required: true }
    ]
  },
  {
    name: 'canvas',
    description: 'Get canvas information',
  },
  {
    name: 'session',
    description: 'Manage canvas sessions (admin only)',
    options: [
      {
        name: 'start',
        description: 'Start a new session',
        type: 1
      },
      {
        name: 'pause',
        description: 'Pause the current session',
        type: 1
      },
      {
        name: 'reset',
        description: 'Reset the canvas',
        type: 1
      }
    ]
  },
  {
    name: 'snapshot',
    description: 'Generate a canvas snapshot (admin only)'
  }
];

// Register commands...
// See Discord documentation for full implementation
```

Run with: `node register-commands.js`

## Development

### Project Structure

```
Cloud-ServerLessTeam11/
├── functions/              # Cloud Functions source code
│   ├── proxy/             # HTTP-triggered functions
│   │   ├── discord-proxy/
│   │   ├── web-proxy/
│   │   └── auth-handler/
│   └── worker/            # Event-triggered functions
│       ├── pixel-worker/
│       ├── discord-worker/
│       ├── snapshot-worker/
│       └── session-worker/
├── terraform/             # Infrastructure as Code
│   ├── modules/          # Reusable modules
│   └── environments/     # Environment configs
│       └── dev/
├── scripts/              # Deployment scripts
├── frontend/             # Web application (TBD)
├── docs/                 # Documentation
└── README.md
```

### Local Development

To run functions locally:

```bash
cd functions/proxy/web-proxy
npm install
npm start
# Function runs on http://localhost:8080
```

### Deploying Function Updates

After modifying function code:

```bash
# Package function
cd functions/proxy/discord-proxy
zip -r discord-proxy.zip .

# Upload to Cloud Storage
gcloud storage cp discord-proxy.zip gs://YOUR_PROJECT-functions-source/discord-proxy/source.zip

# Redeploy function
cd terraform/environments/dev
terraform apply -replace="module.discord_proxy.google_cloudfunctions2_function.function"
```

## Discord Commands

Once deployed and configured:

- `/draw <x> <y> <color>` - Draw a pixel (e.g., `/draw 10 20 #FF0000`)
- `/canvas` - Get canvas information
- `/session start` - Start a new session (admin)
- `/session pause` - Pause the session (admin)
- `/session reset` - Reset the canvas (admin)
- `/snapshot` - Generate and post canvas snapshot (admin)

## API Endpoints

Web API endpoints (require JWT authentication for write operations):

- `GET /api/pixels` - Get all pixels
- `POST /api/pixels` - Place a pixel (authenticated)
- `GET /api/canvas` - Get canvas state
- `GET /auth/login` - Initiate Discord OAuth2
- `GET /auth/callback` - OAuth2 callback
- `GET /auth/me` - Get current user info (authenticated)

## Monitoring

View logs and metrics in Google Cloud Console:

- **Cloud Logging**: All function logs
- **Cloud Monitoring**: Function metrics, Pub/Sub queue depth
- **Error Reporting**: Automatic error tracking

Example log query:

```
resource.type="cloud_function"
resource.labels.function_name="pixel-worker"
severity>=ERROR
```

## Security

- **API Gateway**: All traffic goes through API Gateway (no direct function access)
- **Authentication**: Discord signature verification, JWT tokens
- **IAM**: Least-privilege service accounts for all functions
- **Secrets**: All sensitive data in Secret Manager
- **Rate Limiting**: Per-user rate limits (20 pixels/minute)

## Cost Estimation

Development usage (low traffic):
- **Cloud Functions**: ~$2/month (within free tier)
- **Firestore**: ~$1/month (within free tier)
- **Pub/Sub**: Free (within free tier)
- **Cloud Storage**: ~$1/month
- **Total**: **~$5/month**

Production usage (moderate traffic):
- **Cloud Functions**: ~$20/month
- **Firestore**: ~$10/month
- **Pub/Sub**: ~$5/month
- **Cloud Storage**: ~$2/month
- **API Gateway**: ~$10/month
- **Total**: **~$50/month**

## Troubleshooting

### Function deployment fails

- Check that all required APIs are enabled
- Verify service account permissions
- Ensure placeholder.zip exists in scripts folder

### Discord webhook verification fails

- Verify Discord Public Key is correct in Secret Manager
- Check function logs for signature verification errors

### Pixels not appearing

- Check Firestore rules allow writes
- Verify Pub/Sub subscriptions are working
- Check pixel-worker logs for rate limit errors

### "Session not active" errors

- Run `/session start` command to create a session
- Check session-worker logs

## Testing

Run end-to-end tests:

```bash
# Place a pixel via Discord
/draw 10 10 #FF0000

# Verify in Firestore
gcloud firestore documents list pixels --limit=1

# Check logs
gcloud functions logs read pixel-worker --limit=10
```

## Future Enhancements

- [ ] Web application frontend (React/Vue)
- [ ] Real-time canvas updates via WebSocket
- [ ] Infinite canvas with spatial indexing
- [ ] Advanced image rendering (gradients, patterns)
- [ ] Analytics dashboard
- [ ] CI/CD pipeline
- [ ] Multi-region deployment
- [ ] Canvas history/time-lapse

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

MIT License - see LICENSE file for details

## Support

For issues or questions:
- Check the [troubleshooting section](#troubleshooting)
- Review Cloud Function logs
- Open an issue on GitHub

## Acknowledgments

- Inspired by Reddit's [r/place](https://www.reddit.com/r/place/)
- Built for Epitech C3 Serverless project
- Powered by Google Cloud Platform

---

**Project Status**: ✅ Infrastructure Complete | ⏳ Function Implementation Complete | ⏳ Web App Pending

Last Updated: 2026-01-23
