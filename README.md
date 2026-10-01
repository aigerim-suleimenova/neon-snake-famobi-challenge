# Neon Snake

A compact browser game built with Phaser 3, TypeScript, Vite, and the Famobi GameInterface SDK.

The project contains four parts:

1. **Game** — Neon Snake with Famobi SDK integration.
2. **Analytics** — Records gameplay events and sends them to the backend.
3. **Backend** — Node.js API with Firestore Emulator for analytics.
4. **Dashboard** — React dashboard showing gameplay statistics.

## Tech Stack

* **Game:** Phaser 3, TypeScript, Vite
* **Backend:** Node.js, Express 5, Zod, Firebase/Firestore Emulator
* **Dashboard:** React 19, TypeScript, Vite
* **Testing:** Vitest, Testing Library
* **Package manager:** pnpm

## Gameplay

* Three increasingly difficult levels
* Fruit collection and scoring
* Collision detection
* Pause, resume, retry and level selection
* Keyboard, swipe and on-screen controls
* Persistent best score and mute preference
* Procedural sound effects

## Famobi SDK Integration

The game integrates the main Famobi GameInterface events:

| Moment          | SDK                                       |
| --------------- | ----------------------------------------- |
| Loading         | `init()`, preload progress, `gameReady()` |
| Level start     | `gameStart(level)`                        |
| Level end       | `sendScore()`, `gameEnd()`                |
| Final level     | `gameFinished()`                          |
| Fruit collected | `sendScore()`, `sendProgress()`           |
| Pause / resume  | `gamePause()`, `gameResume()`             |
| Mute            | `gameMuted()`                             |

Platform events such as pause, mute, restart, quit and level navigation are also supported.

When the Famobi SDK is unavailable, the game runs independently using its local fallback.

## Analytics

Each level attempt creates two events:

* `run_started`
* `run_ended`

Events contain:

* Session and run IDs
* Level
* Timestamp
* Outcome
* Score and level score
* Progress
* Duration
* Failure reason

Events are sent immediately and retried after network errors, timeouts and temporary server errors. Pending events are also sent with `sendBeacon` when the page closes.

A session represents one page load. No personal data or persistent player ID is stored.

## Backend

The backend is an independent Node.js application using Express, TypeScript, Zod and the Firebase Firestore Local Emulator.

### API

| Endpoint                  | Purpose                |
| ------------------------- | ---------------------- |
| `POST /api/events`        | Store analytics events |
| `GET /api/stats/overview` | Overall statistics     |
| `GET /api/stats/levels`   | Per-level statistics   |
| `GET /api/health`         | Health check           |

Events are validated, deduplicated by event ID and stored in Firestore.

The backend keeps:

* `events/` — validated analytics events
* `runs/` — one record per level attempt

## Dashboard

The dashboard is an independent React application.

It displays:

* Sessions and total runs
* Finished and unfinished runs
* Completion rate
* Runs per session
* Completion rate by level
* Failures by progress
* Failures by reason
* Per-level statistics

It supports loading, empty, refreshing and backend-error states.

The dashboard fetches data on page load and when **Refresh** or **Retry** is clicked.

## Project Structure

```text
neon-snake/
├── game/          # Phaser game + Famobi integration
├── backend/       # Analytics API + Firestore
├── dashboard/     # React analytics dashboard
├── openspec/      # Specifications and implementation plans
└── README.md
```

Each part is an independent project with its own `package.json`.

## Requirements

* Node.js 22.13+
* pnpm 11
* Java 21+ for the Firestore emulator

One-time setup on macOS with nvm and Homebrew:

```bash
nvm install 22
nvm alias default 22
corepack enable
brew install openjdk@21
```

No Firebase account is needed: the backend runs only against the local Firestore emulator with the demo project `demo-neon-snake`, which cannot reach a real Firebase project. The emulator configuration is in `backend/firebase.json`, `backend/.firebaserc` and `backend/firestore.rules`.

## Run Locally

Use four terminals, each opened in the project folder. In every terminal, run `nvm use 22` first.

### 1. Start Firestore

```bash
export PATH="$(brew --prefix openjdk@21)/bin:$PATH"
cd backend
pnpm install
pnpm emulators
```

Wait until:

```text
All emulators ready!
```

The stored data is visible at http://localhost:4000/firestore. Stopping the emulator with Ctrl+C saves the data to `backend/emulator-data/`; delete that folder to start empty.

### 2. Start the backend

In another terminal:

```bash
cd backend
pnpm dev
```

Check the API:

```bash
curl http://localhost:3000/api/health
```

Expected:

```json
{"status":"ok"}
```

### 3. Start the game

In another terminal:

```bash
cd game
pnpm install
cp .env.example .env.local
pnpm dev
```

Open:

```text
http://localhost:5173
```

Play a level to generate analytics events.

### 4. Start the dashboard

In another terminal:

```bash
cd dashboard
pnpm install
pnpm dev
```

Open:

```text
http://localhost:5174
```

Click **Refresh** to load the latest statistics.

### Troubleshooting

| Problem | Fix |
| --- | --- |
| `node:sqlite` or "requires at least Node.js v22.13" | Run `nvm use 22` in that terminal |
| Java error when starting the emulator | Run the `export PATH=...openjdk@21...` line again |
| Dashboard shows "Offline" | Start the backend (step 2), then click **Retry** |
| Played, but the dashboard does not change | Click **Refresh**; if still unchanged, restart the game with `pnpm dev` (it reads `.env.local` only at start) and reload the page |

## Testing

### Game

```bash
cd game
pnpm check
pnpm test
pnpm build
```

### Backend

```bash
cd backend
pnpm check
pnpm test
pnpm test:emulator
```

### Dashboard

```bash
cd dashboard
pnpm check
pnpm test
pnpm build
```

## Test the Complete Flow

With all four terminals from [Run Locally](#run-locally) running:

1. Open the dashboard at http://localhost:5174. On an empty emulator it shows "No gameplay recorded yet".
2. Open the game at http://localhost:5173 and play:
   * clear level 1
   * fail on a wall, on your own tail and on a level 2 barrier
   * leave a level with "Exit to menu"
   * start a level in a second tab and close that tab while playing
3. Open http://localhost:4000/firestore: `events/` has one document per event, `runs/` one per level attempt. The closed tab's run is `unfinished`.
4. Click **Refresh** on the dashboard and compare its numbers with:

   ```bash
   curl http://localhost:3000/api/stats/overview
   curl http://localhost:3000/api/stats/levels
   ```

5. Stop the backend and click **Refresh**: the dashboard shows "Analytics backend is unreachable". Start it again and click **Retry**: the data is back.
6. Stop the backend, fail a level, start the backend again: within about 30 seconds the game resends the events and they appear after **Refresh**.

Famobi SDK calls can be checked in the game's browser console: on localhost, Famobi's local tester logs every call as `GameInterface ...` (needs an internet connection).

## Verification

The complete flow was tested locally:

**Game → Analytics → Backend → Firestore → Dashboard**

Testing covered:

* Famobi SDK integration
* Gameplay event creation
* Event retries and `sendBeacon`
* Duplicate and invalid events
* Backend API responses
* Firestore persistence
* Statistics calculations
* Dashboard loading, empty and error states
* Responsive layout

End-to-end testing on 2026-10-01 confirmed that gameplay events were stored correctly and that dashboard statistics matched the backend data.

## Technical Decisions

**Game and Famobi SDK**

* The SDK is wired only to features the game already has; the game logic is unchanged.
* The game waits for the SDK's promises (`gameStart`, `gameEnd`, `gamePause`) before it continues, and runs one command at a time to avoid conflicting transitions.
* A small `GamePlatform` interface keeps all Famobi code in one adapter; the game also runs without the SDK.

**Analytics**

* A *run* is one level attempt, with two events: `run_started` and `run_ended`.
* Events are sent immediately, retried with growing delays, and sent with `sendBeacon` at page exit. Each event keeps its ID on resends, so the backend can ignore duplicates.

**Backend**

* Layers: HTTP → services → storage interface → Firestore adapter, so each layer is tested on its own (the tests use an in-memory store).
* Zod checks every event and returns a reason for each rejected field.
* Two collections: `events/` as the source of truth and `runs/` as one record per attempt, so statistics need no re-pairing of events.
* The first event of a run fixes its session and level; conflicting events are rejected instead of overwriting data.
* Firestore gets 3 seconds per call, then the API answers `503`, so the game retries instead of waiting.
* Emulator only, with a `demo-` project; the backend refuses to start otherwise.

**Dashboard**

* Three graphs, each answering one question: how hard is each level (completion rate), where do players fail (progress) and why (failure reason).
* Completion rate is the key figure: complete ÷ finished runs; unfinished runs are shown separately and left out.
* Data loads on page open and on **Refresh**, without polling: simpler, and the status shows when the data was loaded.
* One error state when the backend cannot be reached, instead of a half-filled page.
* Plain CSS bars instead of a chart library: three simple bar graphs did not need the extra size.
* All formatting rules live in one tested function; components only display data.

**Project**

* `game/`, `backend/` and `dashboard/` are independent projects that share no code and talk only over HTTP; the API contract is written once in `backend/API.md`.

## Assumptions

* A session is one page load; a reload or a new tab starts a new one. No player ID is stored, so no personal data is collected.
* "Left the gameplay" in the brief is the `quit` outcome; a closed tab cannot be told apart from a run still in play, so it stays `unfinished`.
* The Famobi total score is the run's score on screen, not a lifetime total; to confirm with Famobi.
* Ads, the `hasFeature` flags, the copyright logo and localisation are out of scope, because the brief does not ask for them.

## Known Limitations

* Closed tabs remain `unfinished`.
* `sendBeacon` is best effort.
* The backend has no authentication or rate limiting.
* Statistics currently read all runs on each request.
* Dashboard data updates only on Refresh.
* Famobi `hasFeature` flags and copyright logo are not implemented because they were outside the requested scope.
* The dashboard's two requests are not one snapshot; while someone plays, the totals can differ by one run until the next Refresh.
* "Play again" after the last level sends `gameStart` after `gameFinished`, which Famobi's local tester reports as invalid; open question for Famobi.

## What I Would Improve With More Time

* Detect closed tabs (for example after a timeout) and show them as their own outcome.
* Keep counters per level instead of reading all runs on each request, once the data grows.
* Add authentication and rate limiting to the event endpoint.
* Share or generate the API contract so the game, backend and dashboard cannot drift apart.
* Refresh the dashboard automatically and keep the last data visible when a refresh fails.
* Add automated browser tests (for example Playwright) for the whole flow and the SDK call order.

## AI Usage

The project was developed with **Claude Code**.

AI was used for documentation review, OpenSpec planning, implementation, testing and dashboard development.

The implementation and technical decisions were reviewed manually.
