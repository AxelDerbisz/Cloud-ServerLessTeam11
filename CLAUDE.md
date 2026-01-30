# C3: Serverless Pixel Canvas - Project Requirements

**Project:** Collaborative Pixel Canvas via Discord & Web (inspired by Reddit's r/place)
**Goal:** Build a secure, scalable, event-driven cloud-native system using ONLY serverless services

---

## 🎯 Project Overview

Build a fully serverless multiplayer drawing platform where users collaboratively draw pixels on a shared canvas via:
- Discord bot commands (slash commands)
- Serverless web interface

**Platform Choice:** GCP or AWS (this project uses **GCP**)

---

## ⚠️ MANDATORY CONSTRAINTS (CRITICAL!)

These are **REQUIRED** - failure to comply will result in project rejection:

### ✅ Serverless-Only
- ❌ NO virtual machines
- ❌ NO Kubernetes
- ❌ NO manually managed servers
- ✅ ONLY serverless services (Cloud Functions, Cloud Run, Firestore, etc.)

### ✅ API Gateway Required
- **ALL public endpoints MUST go through API Gateway**
- Functions **CANNOT** be invoked directly via HTTP
- Flow: `Client → API Gateway → Proxy Function → Pub/Sub → Worker Function`

### ✅ Event-Driven Architecture
- All workloads must be **asynchronous**
- Must use **message brokers** (Pub/Sub, SQS, EventBridge, EventArc)
- Exception: Lightweight proxy functions that ACK HTTP and publish to queue

### ✅ Serverless Storage
- Persistent data in Firestore, DynamoDB, S3, Cloud Storage
- NO self-managed databases

### ✅ Single Responsibility Principle
- Each function performs **ONE clear task**
- Separate concerns (proxy, worker, snapshot, session, etc.)

---

## 🏗️ Architecture Requirements

### Request Flow (MUST FOLLOW THIS)
```
Discord → API Gateway → discord-proxy (ACK) → Pub/Sub → discord-worker
Web     → API Gateway → web-proxy (ACK)     → Pub/Sub → pixel-worker
OAuth   → API Gateway → auth-handler        → (processes sync)
```

### Components Required

#### 1. API Gateway
- **Purpose:** Single entry point for all public traffic
- **Routes:**
  - `POST /discord/webhook` → discord-proxy
  - `POST /api/pixels` → web-proxy
  - `GET /api/pixels` → web-proxy
  - `GET /api/canvas` → web-proxy
  - `GET /auth/login` → auth-handler
  - `GET /auth/callback` → auth-handler
  - `GET /auth/me` → auth-handler

#### 2. Proxy Functions (HTTP Triggered)
- **discord-proxy**: Verify Discord signature, ACK immediately, publish to Pub/Sub
- **web-proxy**: Validate JWT, ACK immediately, publish to Pub/Sub
- **auth-handler**: Handle Discord OAuth2 flow, issue JWTs

#### 3. Worker Functions (Pub/Sub Triggered)
- **pixel-worker**: Validate rate limits, update Firestore, broadcast changes
- **discord-worker**: Process Discord commands, send responses
- **snapshot-worker**: Generate canvas image, upload to Cloud Storage, post to Discord
- **session-worker**: Manage sessions (start, pause, reset)

#### 4. Pub/Sub Topics
- `pixel-events`: Pixel draw requests
- `discord-commands`: Discord slash commands
- `session-events`: Session management events
- `dead-letter`: Failed message handling

#### 5. Data Storage
- **Firestore Collections:**
  - `pixels/{x}_{y}`: Individual pixel data
  - `sessions/{id}`: Session state
  - `users/{discord_id}`: User info
  - `rate_limits/{user_id}_{minute}`: Rate limiting
- **Cloud Storage Buckets:**
  - `functions-source`: Function code
  - `canvas-snapshots`: Generated images
  - `web-app`: Static website hosting

---

## 🤖 Discord Bot Requirements

### Features (REQUIRED)
- ✅ Users can **draw pixels** on canvas
- ✅ Users can **retrieve canvas state**
- ✅ Admins can **manage sessions** (start, pause, reset)
- ✅ Admins can **take snapshots** (posted as Discord embed/image)

### Technical Constraints
- Must use **Discord Interactions** (slash commands)
- Custom Endpoint URL points to **API Gateway** (not direct function URL)
- Flow: `API Gateway → proxy function → Pub/Sub queue`
- **Asynchronous operations:** ACK within 3 seconds, process via queue

### Example Commands
```
/draw <x> <y> <color>     # Draw a pixel
/canvas                    # Get canvas snapshot
/session start            # Admin: start session
/session pause            # Admin: pause session
/session reset            # Admin: reset canvas
/snapshot                 # Admin: generate image
```

---

## 🗄️ Data Storage Requirements

### Pixel Data
- ✅ Store efficiently with **timestamps** and **user identifiers**
- ✅ **Configurable or infinite canvas size** (sparse data model)
- ✅ Maintain **consistency** under concurrent updates
- ✅ Record **author** and **update timestamp** for every pixel
- ✅ Implement **rate limiting** (e.g., 20 pixels per minute)

### Firestore Data Model
```javascript
pixels/{x}_{y}:
  color: string (hex)
  userId: string
  username: string
  updatedAt: timestamp

sessions/{sessionId}:
  status: "active" | "paused" | "ended"
  startedAt: timestamp
  canvasWidth: number (or null for infinite)
  canvasHeight: number (or null for infinite)

users/{discordId}:
  username: string
  lastPixelAt: timestamp
  pixelCount: number

rate_limits/{userId}_{minute}:
  count: number
  expiresAt: timestamp
```

---

## 🌐 Web Application Requirements

### Features (REQUIRED)
- ✅ Draw pixels **interactively**
- ✅ View canvas in **near real-time**
- ✅ **Discord OAuth2** authentication
- ✅ Select pixel to see **author** and **timestamp**

### Technical Constraints
- ✅ **Fully serverless** (no self-managed backend or VMs)
- ✅ API calls must be **authenticated** (JWT)
- ✅ Canvas state must be **as fresh as possible** (near real-time)
- ✅ Login via **Discord OAuth2**
- ✅ Static hosting on **Cloud Storage** or **Cloud Run**

### Real-Time Updates
Two options:
1. **Firestore Real-time Listeners** (recommended)
2. **Polling** (simpler, less responsive)

---

## 🔒 Security Requirements

### IAM & Access Control
- ✅ **Least privilege principle** throughout
- ✅ Dedicated service accounts with **minimum permissions**
- ✅ **NO public access** to backend services
- ✅ Restrict **unauthenticated access** to API endpoints
- ✅ **HTTPS only** for all public traffic
- ✅ **Secret Manager** for all secrets (Discord keys, JWT secret)

### Authentication & Authorization
- ✅ Web: **JWT tokens** (signed with secret from Secret Manager)
- ✅ Discord: **Signature verification** (using Discord public key)
- ✅ Admin commands: **Role-based access** (check Discord role ID)

### Secret Management
- ✅ Store in **Google Secret Manager**:
  - `discord-public-key`: Discord webhook verification
  - `discord-client-secret`: OAuth2 flow
  - `jwt-secret`: JWT token signing
- ✅ **NEVER** commit secrets to git
- ✅ Functions access via Secret Manager API (not env vars)

---

## 📊 Monitoring & Logging Requirements

### Logging (REQUIRED)
- ✅ Log **all key events**:
  - Pixel draws
  - Discord commands
  - Errors
  - Metrics (latency, queue depth, etc.)
- ✅ Use **Cloud Logging** (structured logs)
- ✅ Include **correlation IDs** for request tracing

### Monitoring (REQUIRED)
- ✅ Set up **error alerts**
- ✅ Create **metrics dashboards**
- ✅ Monitor:
  - Function invocations
  - Pub/Sub message backlog
  - Firestore read/write operations
  - API Gateway latency
  - Rate limit violations

### Observability Services
- **GCP:** Cloud Logging, Cloud Monitoring, Cloud Trace
- Tools: Cloud Console, Logs Explorer, Metrics Explorer

---

## 📦 Deliverables (REQUIRED)

### 1. Source Code ✅
- Well-structured repository organized by function/service
- Clear folder structure:
  ```
  functions/
    discord-proxy/
    web-proxy/
    auth-handler/
    pixel-worker/
    discord-worker/
    snapshot-worker/
    session-worker/
  terraform/
  web-app/
  docs/
  ```

### 2. Documentation ✅
- **README.md**: Project overview, setup instructions
- **Architecture diagrams**: Show services, data flow, queues, functions
- **Setup guide**: Step-by-step deployment instructions
- **API documentation**: Endpoints, request/response formats

### 3. Architecture Diagrams ✅
- Must show:
  - Cloud services used
  - Data flow (request → response)
  - Pub/Sub topics and subscriptions
  - Function triggers
  - Integrations (Discord, OAuth2)

### 4. Monitoring Setup ✅
- Logs configuration
- Tracing setup
- Dashboard definitions
- Alerting rules

### 5. Infrastructure as Code (OPTIONAL BUT RECOMMENDED) ✅
- Terraform templates (preferred)
- Or CloudFormation, Pulumi, Serverless Framework
- **Current project uses Terraform**

---

## 🎓 Defense Guidelines

### You Must Be Able To:

#### 1. Explain Architecture
- Why you chose specific services
- How components interact
- Trade-offs made
- Design patterns used

#### 2. Demonstrate System
- Show Discord bot working (commands, responses)
- Show web app working (login, draw, real-time)
- Prove end-to-end functionality

#### 3. Show Monitoring
- Dashboards proving scalability
- Logs showing request flow
- Traces showing latency
- Metrics proving reliability

#### 4. Discuss Implementation
- Concurrency handling (Firestore transactions, idempotency)
- Rate limiting strategy (per-user counters, time windows)
- Authentication flow (OAuth2, JWT validation)
- Data persistence (Firestore data model, sparse canvas)

#### 5. Propose Improvements
- Potential optimizations
- Scalability enhancements
- Feature additions
- Architecture refinements

---

## 📋 Evaluation Criteria

### Core Requirements (Must Pass)
1. **Functionality** - All features working
2. **Serverless Compliance** - 100% serverless components
3. **Security** - Proper IAM, least privilege, secrets management
4. **Scalability** - Handles concurrent users
5. **Code Quality** - Clean, modular, maintainable
6. **Documentation** - Clear and complete

### Additional Points
7. **Innovation** - Creative solutions, unique approaches
8. **Comprehension** - Deep understanding, able to explain/justify
9. **Bonus** - Outstanding implementations:
   - Infrastructure as Code (Terraform) ✅
   - Real-time streaming
   - Advanced monitoring/observability
   - Infinite canvas implementation
   - Advanced web UX
   - CI/CD pipeline

---

## ✅ Implementation Checklist

### Phase 1: Infrastructure Setup
- [ ] Create GCP project
- [ ] Set up Secret Manager (discord keys, JWT secret)
- [ ] Deploy Terraform infrastructure:
  - [ ] API Gateway
  - [ ] Cloud Functions (proxies + workers)
  - [ ] Pub/Sub topics & subscriptions
  - [ ] Firestore database
  - [ ] Cloud Storage buckets
  - [ ] IAM service accounts & permissions

### Phase 2: Discord Bot
- [ ] Implement discord-proxy (signature verification, ACK)
- [ ] Implement discord-worker (command processing)
- [ ] Implement snapshot-worker (image generation)
- [ ] Implement session-worker (session management)
- [ ] Register Discord slash commands
- [ ] Configure Discord webhook endpoint (API Gateway URL)
- [ ] Test all commands

### Phase 3: Backend Functions
- [ ] Implement web-proxy (JWT validation, rate limiting)
- [ ] Implement pixel-worker (Firestore updates, validation)
- [ ] Implement auth-handler (OAuth2 flow, JWT issuance)
- [ ] Set up rate limiting logic
- [ ] Test Pub/Sub message flow

### Phase 4: Web Application
- [ ] Build React/Vue/vanilla JS frontend
- [ ] Implement Discord OAuth2 login
- [ ] Implement canvas rendering
- [ ] Implement pixel placement
- [ ] Implement real-time updates (Firestore listeners)
- [ ] Implement pixel info display (author, timestamp)
- [ ] Deploy to Cloud Storage

### Phase 5: Monitoring & Security
- [ ] Configure Cloud Logging
- [ ] Set up Cloud Monitoring dashboards
- [ ] Create error alerts
- [ ] Enable Cloud Trace
- [ ] Audit IAM permissions (least privilege)
- [ ] Test security (unauthenticated access blocked)

### Phase 6: Documentation
- [ ] Write comprehensive README
- [ ] Create architecture diagrams
- [ ] Document API endpoints
- [ ] Write deployment guide
- [ ] Document monitoring setup

### Phase 7: Testing & Demo
- [ ] End-to-end testing (Discord + Web)
- [ ] Load testing (concurrent users)
- [ ] Prepare demo scenarios
- [ ] Prepare defense presentation

---

## 🚨 Common Pitfalls to Avoid

1. ❌ **Functions directly accessible via HTTP** (must go through API Gateway)
2. ❌ **Secrets in code or environment variables** (use Secret Manager)
3. ❌ **Public access to backend services** (IAM must restrict)
4. ❌ **Synchronous processing in proxy functions** (must ACK and queue)
5. ❌ **Missing rate limiting** (required per user)
6. ❌ **No monitoring/logging** (required for evaluation)
7. ❌ **Canvas size not scalable** (must support large/infinite canvas)
8. ❌ **No authentication on web API** (must use JWT)
9. ❌ **Poor concurrency handling** (use Firestore transactions)
10. ❌ **Missing architecture documentation** (required deliverable)

---

## 📚 Key Resources

### GCP Documentation
- [API Gateway](https://cloud.google.com/api-gateway/docs)
- [Cloud Functions](https://cloud.google.com/functions/docs)
- [Pub/Sub](https://cloud.google.com/pubsub/docs)
- [Firestore](https://cloud.google.com/firestore/docs)
- [Cloud Storage](https://cloud.google.com/storage/docs)
- [Secret Manager](https://cloud.google.com/secret-manager/docs)
- [IAM](https://cloud.google.com/iam/docs)

### Discord Documentation
- [Developer Portal](https://discord.com/developers/applications)
- [Interactions](https://discord.com/developers/docs/interactions/overview)
- [Slash Commands](https://discord.com/developers/docs/interactions/application-commands)
- [OAuth2](https://discord.com/developers/docs/topics/oauth2)

### Terraform
- [GCP Provider](https://registry.terraform.io/providers/hashicorp/google/latest/docs)
- [Best Practices](https://www.terraform.io/docs/cloud/guides/recommended-practices/index.html)

---

## 🎯 Success Criteria Summary

**PASS Requirements:**
- ✅ 100% serverless
- ✅ API Gateway enforced
- ✅ Event-driven architecture (Pub/Sub)
- ✅ All features working (Discord + Web)
- ✅ Proper security (IAM, secrets, auth)
- ✅ Documentation complete
- ✅ Can demonstrate and explain

**EXCELLENT Requirements:**
- ✅ All PASS requirements
- ✅ Infrastructure as Code (Terraform)
- ✅ Advanced monitoring/observability
- ✅ Real-time updates
- ✅ Infinite canvas implementation
- ✅ Outstanding code quality
- ✅ Deep comprehension in defense

---

## 📅 Project Status

**Current Implementation:**
- ✅ Terraform infrastructure complete
- ✅ API Gateway configured
- ✅ Cloud Functions deployed (placeholders)
- ✅ Pub/Sub topics created
- ✅ Firestore database initialized
- ✅ Secret Manager configured
- ✅ IAM permissions set (least privilege)
- ⏳ Function implementation in progress
- ⏳ Web app development pending
- ⏳ Discord commands registration pending
- ⏳ End-to-end testing pending

**Next Steps:**
1. Deploy real Discord proxy function (signature verification)
2. Implement worker functions (pixel, discord, snapshot, session)
3. Register Discord slash commands
4. Build web application frontend
5. Set up monitoring dashboards
6. End-to-end testing
7. Documentation finalization
8. Defense preparation

---

**Last Updated:** 2026-01-23
**Project:** team11-dev
**Region:** europe-west1
