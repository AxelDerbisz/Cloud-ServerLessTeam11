# Architecture Diagram

> **Level:** C4 Container Diagram — shows the deployed units and their interactions.

```mermaid
graph TD
    classDef client fill:#e3f2fd,stroke:#1565c0,stroke-width:2px,color:#0d47a1
    classDef gateway fill:#fff3e0,stroke:#ef6c00,stroke-width:2px,color:#e65100
    classDef function fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px,color:#4a148c
    classDef topic fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px,color:#1b5e20
    classDef storage fill:#fce4ec,stroke:#c2185b,stroke-width:2px,color:#880e4f
    classDef external fill:#eceff1,stroke:#546e7a,stroke-width:2px,color:#37474f

    %% --- Clients ---
    Discord(("Discord")):::client
    Web(("Web App — React / App Engine")):::client

    %% --- API Gateway ---
    GW["API Gateway"]:::gateway

    Discord -->|Slash Commands| GW
    Web -->|HTTP Requests| GW

    %% --- Proxies ---
    subgraph Proxies ["Proxy Functions — Cloud Functions"]
        DP["Discord Proxy (Go)"]:::function
        AH["Auth Handler (Node.js)"]:::function
        WP["Web Proxy (Node.js)"]:::function
    end

    GW -->|/discord/webhook| DP
    GW -->|/auth/*| AH
    GW -->|/api/*| WP

    OAuth["Discord OAuth2"]:::external
    AH -->|Authorization Code| OAuth
    OAuth -->|Access Token| AH

    %% --- Pub/Sub ---
    subgraph EventBus ["Pub/Sub Topics"]
        T_Pixel{{"pixel-events"}}:::topic
        T_Session{{"session-events"}}:::topic
        T_Snap{{"snapshot-events"}}:::topic
    end

    DP -.->|Publish| T_Pixel
    DP -.->|Publish| T_Session
    DP -.->|Publish| T_Snap
    WP -.->|Publish| T_Pixel

    %% --- Workers ---
    subgraph Workers ["Worker Functions — Cloud Functions"]
        W_Pixel["Pixel Worker (Go)"]:::function
        W_Snap["Snapshot Worker (Go)"]:::function
        W_Session["Session Worker (Node.js)"]:::function
    end

    T_Pixel -.->|Subscribe| W_Pixel
    T_Session -.->|Subscribe| W_Session
    T_Snap -.->|Subscribe| W_Snap

    %% --- Storage ---
    subgraph Storage
        DB[("Firestore")]:::storage
        Bucket[("Cloud Storage")]:::storage
    end

    W_Pixel -->|Write| DB
    W_Session -->|Read/Write| DB
    W_Snap -->|Read| DB
    W_Snap -->|Save PNG| Bucket

    %% --- Feedback to clients ---
    W_Pixel -->|Follow-up| Discord
    W_Snap -->|Post Image| Discord
    W_Session -->|Follow-up| Discord
    DB -.->|Realtime onSnapshot| Web
```

```mermaid
graph LR
    classDef function fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px,color:#4a148c
    classDef storage fill:#fce4ec,stroke:#c2185b,stroke-width:2px,color:#880e4f
    classDef monitoring fill:#fff8e1,stroke:#f9a825,stroke-width:2px,color:#f57f17

    Functions["All Terraform-managed Functions"]:::function

    subgraph Observability
        Logging["Cloud Logging"]:::monitoring
        Monitoring["Cloud Monitoring"]:::monitoring
        Trace["Cloud Trace"]:::monitoring
    end

    Secrets["Secret Manager"]:::storage

    Functions -->|Structured Logs| Logging
    Functions -->|Traces| Trace
    Functions -->|Read Secrets| Secrets
    Logging --> Monitoring
```


**Legend:**
| Symbol | Meaning |
|---|---|
| Solid arrow `→` | Synchronous request (HTTP) |
| Dashed arrow `⇢` | Asynchronous message (Pub/Sub, Firestore listener) |
| Circle | External client |
| Rectangle | Cloud Function |
| Hexagon | Pub/Sub topic |
| Cylinder | Data store |
