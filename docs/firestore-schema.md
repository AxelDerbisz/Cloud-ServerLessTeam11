# Firestore Schema Design

## Overview

This document describes the Firestore data model for the Collaborative Pixel Canvas application.

The design prioritizes:
- **Scalability**: Supports near-infinite canvas size through chunking
- **Cost efficiency**: Balanced read/write operations
- **Simplicity**: Minimal collections, clear structure

---

## Collections

### 1. `config/session`

Stores global game configuration and state.

| Field | Type | Description |
|-------|------|-------------|
| `status` | string | Game state: `"active"`, `"paused"`, `"ended"` |
| `palette` | array[string] | Available colors, e.g., `["#FFFFFF", "#000000", "#FF4500", ...]` |
| `chunkSize` | number | Pixels per chunk dimension (default: `50` = 50x50 chunks) |
| `pixelsPerMinute` | number | Rate limit per user (default: `20`) |

**Example:**
```json
{
  "status": "active",
  "palette": ["#FFFFFF", "#000000", "#FF4500", "#0000FF", "#00FF00"],
  "chunkSize": 50,
  "pixelsPerMinute": 20
}
```

---

### 2. `chunks/{chunkX_chunkY}`

Stores pixel data grouped by spatial chunks. Only chunks with placed pixels exist (sparse storage).

**Document ID format:** `{chunkX}_{chunkY}` where coordinates are chunk indices (not pixel coordinates).

| Field | Type | Description |
|-------|------|-------------|
| `pixels` | map | Map of pixel coordinates to pixel data |

**Pixel data structure:**

| Field | Type | Description |
|-------|------|-------------|
| `c` | number | Color palette index |
| `u` | string | Discord user ID who placed the pixel |
| `t` | number | Unix timestamp of placement |

**Example:** Document `chunks/2_3` (chunk at grid position 2,3)
```json
{
  "pixels": {
    "115_167": { "c": 2, "u": "123456789", "t": 1706012345 },
    "116_167": { "c": 0, "u": "987654321", "t": 1706012400 },
    "120_180": { "c": 4, "u": "123456789", "t": 1706012500 }
  }
}
```

**Coordinate calculation:**
```
chunkX = floor(pixelX / chunkSize)
chunkY = floor(pixelY / chunkSize)
```

---

### 3. `users/{discordId}`

Stores per-user data including rate limiting and profile info.

| Field | Type | Description |
|-------|------|-------------|
| `username` | string | Discord username (for display when viewing pixel author) |
| `pixelCount` | number | Pixels placed in current window |
| `windowStart` | number | Unix timestamp when current rate limit window started |

**Example:** Document `users/123456789`
```json
{
  "username": "PlayerOne",
  "pixelCount": 5,
  "windowStart": 1706012000
}
```

**Rate limiting logic:**
```
if (now - windowStart) > 60 seconds:
    reset: pixelCount = 1, windowStart = now
else if pixelCount < pixelsPerMinute:
    increment: pixelCount++
else:
    reject: rate limited
```

---

## Visual Diagram

```
Firestore
│
├── config/
│   └── session
│       ├── status: "active"
│       ├── palette: [...]
│       ├── chunkSize: 50
│       └── pixelsPerMinute: 20
│
├── chunks/
│   ├── 0_0
│   │   └── pixels: { "x_y": { c, u, t }, ... }
│   ├── 0_1
│   │   └── pixels: { ... }
│   └── ...
│
└── users/
    ├── 123456789
    │   ├── username: "PlayerOne"
    │   ├── pixelCount: 5
    │   └── windowStart: 1706012000
    └── ...
```
