# Real-Time Tic-Tac-Toe Backend

Authoritative real-time 1-vs-1 Tic-Tac-Toe backend built with Node.js, Express 5, TypeScript, and Socket.IO.

---

## Table of Contents

- [Overview](#overview)
- [Architecture & Tech Stack](#architecture--tech-stack)
- [Project Structure](#project-structure)
- [Prerequisites & Installation](#prerequisites--installation)
- [Environment Variables](#environment-variables)
- [Running the Application](#running-the-application)
- [Session & Cookie Management](#session--cookie-management)
- [REST API Reference](#rest-api-reference)
  - [Standard Response Envelope](#standard-response-envelope)
  - [Error Codes](#error-codes)
  - [Endpoints](#endpoints)
- [Real-Time Socket.IO Protocol](#real-time-socketio-protocol)
  - [Socket Authentication & Connection](#socket-authentication--connection)
  - [Client-to-Server Events](#client-to-server-events)
  - [Server-to-Client Events](#server-to-client-events)
  - [Game Lifecycle & State Machine](#game-lifecycle--state-machine)
- [Game Engine Rules & Timing Specs](#game-engine-rules--timing-specs)
- [Production & Cloud Run Deployment](#production--cloud-run-deployment)
- [Postman Collection](#postman-collection)

---

## Overview

- **1-vs-1 Authoritative Gameplay**: The server authoritatively validates turns, moves, win/draw conditions, and timers.
- **Accountless Session Architecture**: Players enter a display name (or receive an auto-generated one) and are identified via a secure HTTP-only cookie.
- **Ephemeral In-Memory State**: Active sessions, rooms, games, and timers live in memory (no SQL/NoSQL database or Redis required).
- **Graceful Reconnection**: Players who briefly drop network connection have a 60-second window to reconnect without forfeiting.
- **Authoritative Timing**: 30-second authoritative turn timer (choosing a uniformly random available cell on timeout), 10-minute waiting room expiration, 30-second rematch request expiration window, and 3-second synchronized countdown on game start and rematch start.

---

## Architecture & Tech Stack

- **Runtime**: [Node.js](https://nodejs.org/) (ES Modules)
- **Language**: [TypeScript](https://www.typescriptlang.org/) (strict mode)
- **Web Framework**: [Express 5](https://expressjs.com/)
- **Real-Time Engine**: [Socket.IO 4](https://socket.io/)
- **Validation**: [express-validator](https://express-validator.github.io/docs/)
- **Configuration**: [dotenv](https://github.com/motdotla/dotenv)
- **State Storage**: In-memory `Map` data structures

---

## Project Structure

```
.
├── src/
│   ├── server.ts             # Process bootstrapper & graceful shutdown handling
│   ├── app.ts                # Express application configuration & HTTP middlewares
│   ├── server.socket.ts      # Socket.IO initialization, auth middleware, & event dispatchers
│   ├── config/
│   │   ├── index.ts          # Typed environment config validation
│   │   └── cors.ts           # CORS origin setup for HTTP & WebSockets
│   ├── middleware/
│   │   ├── auth.ts           # requireSession middleware for protected REST endpoints
│   │   ├── errorHandler.ts   # 404 & centralized error handling
│   │   └── response.ts       # Unified API response envelope helper & AppError
│   ├── session/
│   │   ├── sessionStore.ts   # In-memory session store, TTL management, name generator
│   │   ├── sessionCookie.ts  # Cookie configuration (SameSite/Secure per environment)
│   │   └── sessionRouter.ts  # POST /api/v1/session endpoint
│   ├── room/
│   │   ├── roomStore.ts      # Room state, game loop, timers, rematch handling, sanitization
│   │   └── roomRouter.ts     # /api/v1/rooms endpoints (create, join, get current, leave)
│   └── game/
│       └── board.ts          # 3x3 board logic, win check, full board check, empty cells
├── dist/                     # Compiled JavaScript (generated on build)
├── postman_collection.json   # Postman Collection v2.1 for REST endpoints & socket documentation
├── tsconfig.json             # TypeScript configuration
├── package.json              # Project scripts & dependencies
└── .env.example              # Environment variables template
```

---

## Prerequisites & Installation

- **Node.js**: v18.0.0 or higher
- **npm**: v9.0.0 or higher

Clone the repository and install dependencies:

```bash
git clone <repository-url>
cd games-backend
npm install
```

---

## Environment Variables

Create a `.env` file in the project root based on `.env.example`:

```bash
cp .env.example .env
```

| Variable | Type | Default | Description |
|---|---|---|---|
| `PORT` | number | `3000` | Port for the HTTP and WebSocket server. |
| `NODE_ENV` | string | `development` | Runtime environment (`development` or `production`). |
| `FRONTEND_URL` | string | `http://localhost:3000` | Frontend origin permitted for CORS and cookie credentials. |
| `CORS_ORIGIN` | string | `http://localhost:3000` | Fallback CORS origin if `FRONTEND_URL` is omitted. |

---

## Running the Application

### Development Mode

Run the TypeScript compiler in watch mode alongside nodemon:

```bash
# Terminal 1: Watch & compile TypeScript
npm run build:watch

# Terminal 2: Run dev server with auto-restart on dist/ changes
npm run dev
```

### Production Build & Run

```bash
npm run build
npm start
```

The server will listen on `http://localhost:3000` (or the configured `PORT`).

---

## Session & Cookie Management

- **Cookie Name**: `tic_tac_toe_session`
- **Lifetime**: 24 hours of inactivity (`24 * 60 * 60 * 1000` ms). Any authenticated request refreshes the session expiration.
- **Attributes**:
  - `httpOnly: true` (prevents client-side script access)
  - `secure: true` in production, `false` in development
  - `sameSite`: `"none"` in production (required for cross-origin frontend-backend deployments over HTTPS), `"lax"` in development

---

## REST API Reference

All routes return JSON using a standard envelope.

### Standard Response Envelope

#### Success (2xx)
```json
{
  "success": true,
  "status_code": 200,
  "message": "Operation description",
  "error": false,
  "error_code": null,
  "data": {}
}
```

#### Failure (4xx / 5xx)
```json
{
  "success": false,
  "status_code": 404,
  "message": "Human-readable error description",
  "error": true,
  "error_code": "ROOM_NOT_FOUND",
  "data": null
}
```

### Error Codes

| Error Code | HTTP Status | Description |
|---|---|---|
| `INVALID_NAME` | 400 | Session name does not meet validation criteria. |
| `INVALID_ROOM_CODE` | 400 | Provided room code format is invalid. |
| `ROOM_FULL` | 400 | The room already has two players. |
| `UNAUTHORIZED` | 401 | Missing `tic_tac_toe_session` cookie. |
| `SESSION_EXPIRED` | 401 | Session has expired or does not exist in store. |
| `NOT_IN_ROOM` | 404 | Player is not currently assigned to any active room. |
| `ROOM_NOT_FOUND` | 404 | The specified room code does not exist. |
| `ROOM_EXPIRED` | 410 | The waiting room was closed due to inactivity. |
| `ROUTE_NOT_FOUND` | 404 | Unmatched REST API endpoint. |
| `INTERNAL_SERVER_ERROR` | 500 | Unexpected server error. |

---

### Endpoints

#### 1. Health Check
```http
GET /
```
- **Auth**: None
- **Response**:
```json
{
  "status": "ok",
  "service": "tic-tac-toe-api",
  "version": "1.0.0"
}
```

---

#### 2. Create or Restore Session
```http
POST /api/v1/session
Content-Type: application/json
```
- **Auth**: Optional (if valid `tic_tac_toe_session` cookie is sent, the existing session is returned and refreshed).
- **Body** (Optional):
```json
{
  "name": "Mohyddine"
}
```
*Rules for `name`*: Optional. 2–20 characters. Letters, numbers, and spaces only. If omitted or empty, an automatic name format (`PlayerXXXX`, `0000`–`9999`) is generated.
- **Sets Cookie**: `tic_tac_toe_session=<sessionId>`
- **Response (201 Created / 200 OK)**:
```json
{
  "success": true,
  "status_code": 201,
  "message": "Session created.",
  "error": false,
  "error_code": null,
  "data": {
    "playerId": "4f9d2242-b91c-43fe-a86d-66e85d9980d2",
    "name": "Mohyddine"
  }
}
```

---

#### 3. Create Room
```http
POST /api/v1/rooms
```
- **Auth**: Required (`tic_tac_toe_session` cookie)
- **Behavior**: Generates a unique 5-character room code (excluding confusing characters `O`, `0`, `I`, `1`). Room enters `WAITING` status with a 10-minute expiry timer. If the creator was in another room, they automatically leave it.
- **Response (201 Created)**:
```json
{
  "success": true,
  "status_code": 201,
  "message": "Room created successfully.",
  "error": false,
  "error_code": null,
  "data": {
    "code": "KM7PX",
    "gameStatus": "WAITING"
  }
}
```

---

#### 4. Join Room
```http
POST /api/v1/rooms/:code/join
```
- **Auth**: Required (`tic_tac_toe_session` cookie)
- **Path Parameter**: `:code` — Case-insensitive 5-character room code.
- **Behavior**: Adds Player 2 to the room. Room transitions to `COUNTDOWN` (3-2-1), randomly assigns symbols `X` and `O` (with room display name conflict resolution if both players share identical names), and broadcasts synchronized real-time countdown.
- **Response (200 OK)**:
```json
{
  "success": true,
  "status_code": 200,
  "message": "Joined room successfully.",
  "error": false,
  "error_code": null,
  "data": {
    "code": "KM7PX",
    "players": [
      {
        "playerId": "4f9d2242-b91c-43fe-a86d-66e85d9980d2",
        "name": "Mohyddine",
        "displayName": "Mohyddine",
        "symbol": null,
        "isCreator": true,
        "connected": false
      },
      {
        "playerId": "7a3e811c-22dc-4fef-a419-482a01efba83",
        "name": "Alex",
        "displayName": "Alex",
        "symbol": null,
        "isCreator": false,
        "connected": false
      }
    ],
    "gameStatus": "COUNTDOWN",
    "createdAt": 1726650000000,
    "expiresAt": 1726650600000,
    "winnerPlayerId": null,
    "winReason": null,
    "board": [null, null, null, null, null, null, null, null, null],
    "currentTurn": null,
    "turnTimeRemaining": 30,
    "rematch": null
  }
}
```

---

#### 5. Get Current Room
```http
GET /api/v1/rooms/current
```
- **Auth**: Required (`tic_tac_toe_session` cookie)
- **Response (200 OK)**: Returns the sanitized room state for the authenticated player.
- **Error (404 Not Found)**: If the player is not currently in a room (`NOT_IN_ROOM`).

---

#### 6. Leave Room
```http
DELETE /api/v1/rooms/current
```
- **Auth**: Required (`tic_tac_toe_session` cookie)
- **Behavior**:
  - In `WAITING`: Deletes the room immediately.
  - In `COUNTDOWN` or `PLAYING`: Forfeits the game; opponent wins by `ABANDONMENT`.
  - In `REMATCH_PENDING`: Deletes room if requester leaves; notifies opponent.
  - In `FINISHED`: Closes room for leaving player.
- **Response (200 OK)**:
```json
{
  "success": true,
  "status_code": 200,
  "message": "Left room successfully.",
  "error": false,
  "error_code": null,
  "data": {
    "left": true,
    "roomDeleted": false
  }
}
```

---

## Real-Time Socket.IO Protocol

### Socket Authentication & Connection

Connect to `/` with credentials enabled:

```typescript
import { io } from "socket.io-client";

const socket = io("http://localhost:3000", {
  withCredentials: true, // Sends the tic_tac_toe_session cookie
  transports: ["websocket", "polling"],
});
```

The connection handshake inspects `socket.handshake.headers.cookie` for `tic_tac_toe_session`. If invalid or missing, connection is rejected with an authentication error.

---

### Client-to-Server Events

| Event | Payload | Description |
|---|---|---|
| `room:join` | `{ "code": "KM7PX" }` | Associates/authenticates the player's existing session socket with the room's Socket.IO channel and restores real-time connection. Requires prior room membership via `POST /api/v1/rooms` or `POST /api/v1/rooms/:code/join`. Does **not** create or add another player. Uses the authenticated HTTP-only session cookie (the client never chooses a playerId). |
| `room:leave` | *(none)* | Leave the current room over WebSocket. |
| `game:move` | `{ "cellIndex": 4 }` | Submit a move on board index `0..8` (supports `{ "cell": 4 }` or `{ "index": 4 }`). |
| `rematch:request` | *(none)* | Request a rematch after a game is `FINISHED` (starts a 30-second rematch request expiration window). |
| `rematch:accept` | *(none)* | Opponent accepts pending rematch request (resets board and starts synchronized 3-second countdown `3 → 2 → 1`). |
| `rematch:decline` | *(none)* | Opponent declines rematch (deletes room). |

---

### Server-to-Client Events

#### `room:joined`
Emitted to the connecting socket upon successful room association/restoration.
```json
{
  "room": { ...sanitizedRoomObject }
}
```

#### `room:updated`
Broadcast to room members whenever player attributes or room metadata change.
```json
{
  "room": { ...sanitizedRoomObject }
}
```

#### `room:expired`
Broadcast when an unfilled room expires (after 10 minutes in `WAITING`).
```json
{
  "code": "KM7PX",
  "message": "Room expired due to inactivity."
}
```

#### `game:countdown`
Synchronized countdown ticks (`3 → 2 → 1`) emitted on game start and rematch acceptance.
```json
{
  "count": 3
}
```

#### `game:state`
Authoritative game state broadcast after valid moves, player reconnects, and every 1-second interval timer tick **only while the game status is `PLAYING`**.
```json
{
  "code": "KM7PX",
  "gameStatus": "PLAYING",
  "board": ["X", null, null, null, "O", null, null, null, null],
  "players": [
    {
      "playerId": "4f9d2242-b91c-43fe-a86d-66e85d9980d2",
      "name": "Mohyddine",
      "symbol": "X",
      "isConnected": true,
      "isMyTurn": false
    },
    {
      "playerId": "7a3e811c-22dc-4fef-a419-482a01efba83",
      "name": "Alex",
      "symbol": "O",
      "isConnected": true,
      "isMyTurn": true
    }
  ],
  "currentTurn": "7a3e811c-22dc-4fef-a419-482a01efba83",
  "winner": null,
  "turnTimeRemaining": 28,
  "connectionState": {
    "allConnected": true
  },
  "rematch": null
}
```

#### `game:finished`
Broadcast when the game reaches a terminal state.
```json
{
  "winner": "4f9d2242-b91c-43fe-a86d-66e85d9980d2",
  "winReason": "NORMAL",
  "room": { ...sanitizedRoomObject }
}
```
*Note: `winReason` can be `"NORMAL"`, `"DRAW"`, or `"ABANDONMENT"`.*

#### `player:connected` / `player:disconnected`
Broadcast when a player disconnects or reconnects.
```json
{
  "playerId": "7a3e811c-22dc-4fef-a419-482a01efba83",
  "name": "Alex"
}
```

#### `player:left`
Broadcast when a player explicitly leaves or fails to reconnect within the 60-second grace period.
```json
{
  "playerId": "7a3e811c-22dc-4fef-a419-482a01efba83",
  "winnerPlayerId": "4f9d2242-b91c-43fe-a86d-66e85d9980d2",
  "winReason": "ABANDONMENT",
  "room": { ...sanitizedRoomObject }
}
```

#### `rematch:requested` / `rematch:accepted` / `rematch:declined` / `rematch:expired`
Lifecycle events for rematch negotiations.
```json
// rematch:requested (starts 30-second rematch request expiration window)
{
  "requestedBy": "4f9d2242-b91c-43fe-a86d-66e85d9980d2",
  "expiresInMs": 30000
}

// rematch:accepted (triggers 3-second synchronized countdown 3 -> 2 -> 1)
{
  "acceptedBy": "7a3e811c-22dc-4fef-a419-482a01efba83"
}

// rematch:declined (deletes room)
{
  "declinedBy": "7a3e811c-22dc-4fef-a419-482a01efba83"
}

// rematch:expired (deletes room after 30-second window expires without response)
{
  "code": "KM7PX"
}
```

---

### Game Lifecycle & State Machine

```
              [Create Room]
                    │
                    ▼
               ┌─────────┐
               │ WAITING │ ──── (10 min timeout) ────► [Room Expired]
               └────┬────┘
                    │
              [Player 2 Joins (REST)]
                    │
                    ▼
              ┌───────────┐
              │ COUNTDOWN │ (3s synchronized countdown: 3 → 2 → 1)
              └─────┬─────┘
                    │
                    ▼
              ┌───────────┐
        ┌───► │  PLAYING  │ ◄─── (Turn alternation / 30s authoritative timer)
        │     └─────┬─────┘
        │           │
        │     [Win / Draw / Abandonment]
        │           │
        │           ▼
        │     ┌──────────┐
        │     │ FINISHED │
        │     └─────┬────┘
        │           │
        │     [Rematch Request]
        │           │
        │           ▼
        │     ┌─────────────────┐
        └───  │ REMATCH_PENDING │ ──── (Decline / 30s expiration) ────► [Room Deleted]
              └─────────────────┘
```

---

## Game Engine Rules & Timing Specs

1. **Board Structure**: Represented as a flat array of 9 elements (`0`–`8`):
   ```
   0 | 1 | 2
   ---------
   3 | 4 | 5
   ---------
   6 | 7 | 8
   ```
2. **First Turn**: The player assigned `'X'` always plays first.
3. **Turn Timeout (Authoritative)**: If a player does not submit a valid move within 30 seconds, the backend authoritatively selects one uniformly random available cell and executes the move. There is no client-side control and no heuristic/AI logic. Turn timers and 1-second interval broadcasts only run while status is `PLAYING`.
4. **Rematch Timing**: A rematch request opens a **30-second request expiration window**. If accepted by the opponent before expiration, the board resets and both players enter a **3-second synchronized countdown** (`3 → 2 → 1`) before the next match begins. If declined or if the 30-second window expires without response, the room is deleted.
5. **Display Name Disambiguation**: If both players in a room have identical names (e.g., `"Player"`), the server appends suffixes to the room display name (`"Player"`, `"Player2"`) while preserving their original session name.
6. **Disconnect Grace Period**: When a socket drops unexpectedly, a 60-second timer begins. If the player reconnects with their session cookie before the grace period ends, their socket connection is restored. If the grace period expires, the remaining player wins by `ABANDONMENT`.
7. **Timer Cleanup**: All turn, countdown, rematch, reconnect, and room expiration timers are strictly cleared whenever a game finishes, a player abandons, a room is deleted, or a new round begins, preventing duplicate or leaked timers.

---

## Production & Cloud Run Deployment

This service is container-ready and follows 12-factor application design principles:
- Reads `PORT` dynamically from environment variables (Cloud Run sets `PORT=8080`).
- Graceful shutdown handles `SIGTERM` and `SIGINT` signals by closing the HTTP and WebSocket servers cleanly.
- When running behind a reverse proxy or Cloud Run with SSL termination, configure `FRONTEND_URL` to your production frontend origin to ensure `SameSite=None; Secure` cookies are accepted by browsers.

### Example Dockerfile
```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist

EXPOSE 8080
CMD ["node", "dist/server.js"]
```

---

## Postman Collection

A complete Postman Collection is included at [`postman_collection.json`](./postman_collection.json).

### Importing into Postman
1. Open Postman.
2. Click **Import** in the top left.
3. Select `postman_collection.json` from this repository.
4. The collection uses the `{{baseUrl}}` variable (preconfigured to `http://localhost:3000`).

### Features in Collection
- Automatic cookie preservation across requests (`tic_tac_toe_session`).
- Ready-to-use requests for Health Check, Session Creation, Room Creation, Room Joining, Room Query, and Leave Room.
- Pre-populated example responses and documentation for WebSocket events.
