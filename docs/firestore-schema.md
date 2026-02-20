# Firestore Schema

> **Database:** `team11-database` (Firestore Native mode, project `team11-dev`)

---

## Collections Overview

| Collection | Document ID | Purpose | Client Access |
|---|---|---|---|
| `pixels` | `{x}_{y}` | One document per placed pixel | Read (public) |
| `sessions` | `current` / `archive_{ts}` | Canvas session state | Read (public) |
| `rate_limits` | `{userId}_{windowMinute}` | Per-user rate limiting (20/min) | None |
| `users` | `{discordUserId}` | User profiles and stats | None |

---

## `pixels/{x}_{y}`

Stores individual pixel data. Document ID is the pixel coordinate (e.g., `5_12`).

| Field | Type | Description |
|---|---|---|
| `x` | number | X coordinate |
| `y` | number | Y coordinate |
| `color` | string | 6-digit hex without `#` (e.g., `"FF0000"`) |
| `userId` | string | Discord user ID of last placer |
| `username` | string | Discord username of last placer |
| `source` | string | `"web"` or `"discord"` |
| `updatedAt` | string (RFC 3339) | Timestamp of last update |

**Composite index:** `userId` ASC, `updatedAt` DESC, `__name__` DESC

**Example** — `pixels/5_12`:
```json
{
  "x": 5,
  "y": 12,
  "color": "FF0000",
  "userId": "123456789012345678",
  "username": "PlayerOne",
  "source": "discord",
  "updatedAt": "2026-02-20T12:34:56Z"
}
```

**Read by:** pixel-worker, snapshot-worker, session-worker, web-proxy, frontend (onSnapshot)
**Written by:** pixel-worker (in a Firestore transaction)

---

## `sessions/current`

Singleton document holding the active canvas session.

| Field | Type | Description |
|---|---|---|
| `status` | string | `"active"` or `"paused"` |
| `startedAt` | string (ISO 8601) | When session started |
| `canvasWidth` | number | Canvas width in pixels (default 100) |
| `canvasHeight` | number | Canvas height in pixels (default 100) |
| `createdBy` | string | Discord user ID of creator |
| `createdByUsername` | string | Discord username of creator |
| `pausedAt` | string (ISO 8601) | When paused (optional) |
| `resumedAt` | string (ISO 8601) | When resumed (optional) |
| `resetAt` | string (ISO 8601) | When canvas was last reset (optional) |
| `pixelsCleared` | number | Count of pixels deleted on last reset (optional) |

**Example** — `sessions/current`:
```json
{
  "status": "active",
  "startedAt": "2026-02-20T10:00:00.000Z",
  "canvasWidth": 100,
  "canvasHeight": 100,
  "createdBy": "123456789012345678",
  "createdByUsername": "AdminUser"
}
```

### `sessions/archive_{timestamp}`

Created when a session ends. Contains all fields from `current` plus:

| Field | Type | Description |
|---|---|---|
| `status` | string | Overwritten to `"ended"` |
| `endedAt` | string (ISO 8601) | When session ended |

**Read by:** pixel-worker, snapshot-worker, session-worker, web-proxy, frontend
**Written by:** session-worker

---

## `rate_limits/{userId}_{windowMinute}`

Per-user rate limiting. Document ID combines the user ID and the current minute (`floor(unixSeconds / 60)`).

| Field | Type | Description |
|---|---|---|
| `count` | number | Pixels placed in this window (incremented atomically) |
| `userId` | string | Discord user ID |
| `window` | number | Window minute value (`floor(unix / 60)`) |
| `expiresAt` | string (RFC 3339) | Expiry timestamp (window + 120s) |

**Example** — `rate_limits/123456789012345678_28473870`:
```json
{
  "count": 5,
  "userId": "123456789012345678",
  "window": 28473870,
  "expiresAt": "2026-02-20T12:36:56Z"
}
```

**Read by:** pixel-worker (authoritative check in transaction), web-proxy (pre-check)
**Written by:** pixel-worker (in a Firestore transaction)

---

## `users/{discordUserId}`

User profile and lifetime stats. Created on first pixel placement, updated on OAuth login.

| Field | Type | Description |
|---|---|---|
| `id` | string | Discord user ID |
| `username` | string | Discord username |
| `discriminator` | string | Discord discriminator (e.g., `"0"`) |
| `avatar` | string | Discord avatar hash |
| `lastLogin` | string (ISO 8601) | Last OAuth login time |
| `lastPixelAt` | string (RFC 3339) | Timestamp of last pixel placed |
| `pixelCount` | number | Total pixels placed (lifetime) |
| `createdAt` | string (RFC 3339) | When user doc was first created |

**Example** — `users/123456789012345678`:
```json
{
  "id": "123456789012345678",
  "username": "PlayerOne",
  "discriminator": "0",
  "avatar": "a_abc123def456",
  "lastLogin": "2026-02-20T09:00:00.000Z",
  "lastPixelAt": "2026-02-20T12:34:56Z",
  "pixelCount": 42,
  "createdAt": "2026-02-15T08:00:00Z"
}
```

**Read by:** auth-handler (`/auth/me`), pixel-worker
**Written by:** pixel-worker (set/update in transaction), auth-handler (merge on OAuth callback)

---

## Security Rules

| Collection | Client Read | Client Write | Server Read | Server Write |
|---|---|---|---|---|
| `pixels` | Public | Denied | Yes | Yes |
| `sessions` | Public | Denied | Yes | Yes |
| `rate_limits` | Denied | Denied | Yes | Yes |
| `users` | Denied | Denied | Yes | Yes |

`pixels` and `sessions` are public-read to allow the frontend to stream updates via `onSnapshot`. All writes go through Cloud Functions only.

---

## Visual Diagram

```
Firestore (team11-database)
│
├── pixels/
│   ├── 0_0       → { x, y, color, userId, username, source, updatedAt }
│   ├── 5_12      → { ... }
│   └── 99_99     → { ... }
│
├── sessions/
│   ├── current           → { status, startedAt, canvasWidth, canvasHeight, ... }
│   └── archive_170843..  → { ..., status: "ended", endedAt }
│
├── rate_limits/
│   ├── 12345678_28473870 → { count, userId, window, expiresAt }
│   └── ...
│
└── users/
    ├── 123456789012345678 → { id, username, pixelCount, lastPixelAt, ... }
    └── ...
```
