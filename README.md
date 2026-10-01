# Neon Snake

A compact browser game built with Phaser 3, TypeScript, Vite, and a DOM-based interface, integrated with the [Famobi GameInterface SDK](https://docs.famobi.com/).

This repository covers parts 1–3 of the Famobi development challenge:

1. **SDK integration:** the game reports its moments to the Famobi GameInterface ([below](#famobi-sdk-integration)).
2. **Gameplay analytics:** the game records every level attempt and sends it to our own backend ([Gameplay analytics](#gameplay-analytics)).
3. **Backend:** a Node.js API in `backend/` that checks the events, stores them in Firestore on the Firebase Local Emulator Suite and serves statistics ([Analytics backend](#analytics-backend)).

Part 4, the React dashboard, is not part of it yet; it will only read the backend's statistics API.

## Gameplay

- Clear three increasingly fast levels.
- Eat the required number of fruit to advance.
- Avoid walls, your own trail, and level obstacles.
- Pause, resume, retry, or return to the main menu.
- Unlock levels, retain a best score, and restore mute preferences between sessions.
- Hear lightweight procedural sound effects without external audio assets.
- Play with arrow keys, WASD, swipe gestures, or the on-screen direction pad.

The SDK integration does not change any of this: levels, scoring, unlocks and saving work as before.

## Famobi SDK integration

The game reports its important moments to the Famobi GameInterface and, where the SDK requires it, waits for the platform before it continues.

| Moment | SDK calls | The game waits? |
| --- | --- | --- |
| Loading | `init([...])` loads the game, then `sendPreloadProgress(0)`, `sendPreloadProgress(100)`, `gameReady()` | – |
| Level starts (Start, level select, Next level, Try again) | `gameStart(level)` | Yes, the level starts after it resolves |
| Level cleared / failed / left | `sendScore(levelScore, { type: "level", level })`, `sendScore(score, { type: "total" })`, `gameEnd("complete" \| "fail" \| "quit", { metrics })` | Yes, the result screen or menu appears after it resolves |
| Last level cleared | `gameFinished()` after `gameEnd("complete")`, once per session | Yes |
| Fruit eaten | `sendScore(score, { level })`, `sendProgress(percent)` | No |
| Player pause / resume | `gamePause()` / `gameResume()` | Yes |
| Player mute | `gameMuted(isMuted)` | No |
| Saving the profile | `GameInterface.storage.getItem` / `setItem` | No |

The platform can also control the game:

| Platform event | Game reaction |
| --- | --- |
| `onPauseStateChange`, `isPaused()` | Master pause on every screen: "Please wait" overlay, no buttons, player input blocked |
| `onMuteStateChange`, `isMuted()` | Master mute; the player's own mute choice is kept and restored |
| `onGoToHome`, `onQuitGame` | Leave the level with `gameEnd("quit")` and show the menu |
| `onGoToNextLevel` | Same as the Next level button |
| `onGoToLevel(level)` | Start that level, or the highest unlocked one if it is still locked |
| `onRestartGame` | Same as the Try again button (restart the current level) |
| `onGameOver` | End the current level as a failure |

When no GameInterface exists (for example on GitHub Pages, or offline), the page loads the game files itself and the game runs on its own with `localStorage`.

### How it is built

- `game/src/application/GamePlatform.ts` is a small interface for the awaited moments (`startRun`, `endRun`, `finishGame`, `pauseRun`, `resumeRun`). The controller only knows this interface; `offlinePlatform` is used without the SDK.
- `game/src/platform/famobi/` holds all Famobi knowledge: `FamobiPlatform` implements the interface with SDK calls, and `connectFamobi` wires loading, live score and progress, pause, mute and the platform requests.
- `GameController` runs player and platform commands one at a time. While it waits for the platform it is "busy": the snake is frozen, buttons are disabled, and a result screen stays hidden until `gameEnd` resolves.
- `GameInterface.init()` runs each file as a classic script, so the production build is a single IIFE bundle (`game.js`) plus `game.css`. In development a small Vite shim serves the same two URLs, so `pnpm dev` also loads the game through `init()`.

## Gameplay analytics

The Famobi SDK's events go to Famobi and cannot be read back, so the game also records its own events and sends them to the backend in `backend/`.

- **What is recorded:** two events per level attempt (a *run*): `run_started` and `run_ended`. Every event carries a schema version, an event ID, the session ID, the run ID, the level and the time. `run_ended` adds the outcome (`complete`, `fail` or `quit`), the failure reason for a fail (`wall`, `snake`, `obstacle`, or `external` for a game over requested by the platform), the score, the level score, the progress (0–100 % of the level's fruit target) and the duration. These mirror the metrics the game already sends with Famobi's `gameEnd`.
- **Session and run:** a session is one page load; the player can play many runs in it. A reload or a new tab starts a new session. No personal data and no persistent player ID are recorded.
- **Sending:** each event is posted at once and stays pending until the backend answers. Network errors, timeouts, `408`, `429` and `5xx` are retried with growing delays (1 s doubling up to 30 s, with ±20 % jitter); events the backend rejects are dropped. When the page is hidden or closed, all pending events are handed to the browser with `navigator.sendBeacon`. The game never waits for any of this.
- **Optional:** the backend URL comes from `VITE_ANALYTICS_URL` at build time. Without it (for example on GitHub Pages) the game records and sends nothing.

How it is built (`game/src/platform/analytics/`): `connectAnalytics` listens to the controller's existing `runStarted` and `runEnded` events and turns them into contract events, so neither the game logic nor the Famobi integration changes. `HttpEventSender` delivers them; `NoopEventSender` is used without a URL. `fetch`, `sendBeacon`, timers, page events and the random source are injected, so all of it is tested without a browser.

## Analytics backend

`backend/` is an independent Node.js project (TypeScript, Express 5, Zod, firebase-admin). It only runs against the Firestore emulator.

```text
server.ts            composition root: config, Firestore, services, app
└─ http/             createApp(): routes, body parsing, CORS, error answers   (only HTTP)
   └─ services/      contract (Zod), IngestionService, StatsService, stats     (rules, no HTTP, no Firestore)
      └─ ports/      EventStore and Clock interfaces
         └─ adapters/  FirestoreEventStore, InMemoryEventStore                  (storage details)
```

### API

The full contract with request and response examples is in [`backend/API.md`](backend/API.md).

| Endpoint | What it does |
| --- | --- |
| `POST /api/events` | Stores a batch of 1–50 events (JSON or `text/plain` from `sendBeacon`, at most 100 kB). Answers `202 { accepted, duplicates, rejected: [{ index, errors }] }`; `400`/`413` for a bad body; `503` when Firestore does not answer within 3 s |
| `GET /api/stats/overview` | Sessions, runs, finished and unfinished runs, completion rate, runs per session |
| `GET /api/stats/levels` | Per level: runs per outcome, completion rate, average duration, failed runs per progress range (0-19 … 80-99 %) and per failure reason |
| `GET /api/health` | `200` when Firestore answers within 3 s, `503` otherwise |

Errors use `{ "error": { "message": "..." } }`. Only the local game and dashboard origins may read responses (CORS).

### Firebase data structure

```text
events/{eventId}   the event as validated (unknown fields dropped) + receivedAt (server time)   source of truth
runs/{runId}       sessionId, level, status (unfinished | complete | fail | quit),              one per level attempt
                   startedAt, endedAt, failureReason, score, levelScore, progress, durationMs,
                   startEventId, endEventId, updatedAt
```

Each event is saved in one transaction: a known event ID is a duplicate and changes nothing; an event that conflicts with its run is rejected; otherwise the event is created and merged into its run. The run ends up the same whichever of its two events arrives first. Statistics are computed from `runs/` on each request.

## Install and run

Requirements:

- **Node.js 22.13 or newer** (pnpm 11 does not start on older versions). With nvm: `nvm install 22 && nvm use 22`.
- **pnpm 11**, for example with `corepack enable`.
- **Java 21 or newer**, for the Firestore emulator (only for `backend/`). Check with `java -version`. To install: `brew install openjdk@21` on macOS, `sudo apt install openjdk-21-jre-headless` on Debian/Ubuntu, or Temurin 21 from [adoptium.net](https://adoptium.net/) on Windows. With Homebrew, Java 21 can stay next to an older default; put it first on `PATH` in the emulator terminal: `export PATH="$(brew --prefix openjdk@21)/bin:$PATH"`.
- The backend's scripts use POSIX shell syntax: macOS, Linux, or WSL/Git Bash on Windows.

### The game only

```bash
cd game
pnpm install
pnpm dev
```

Then open http://localhost:5173/. On localhost, Famobi's `init.js` loads its local tester SDK, which needs an internet connection. Offline, the page falls back to loading the game without the SDK. Without `VITE_ANALYTICS_URL`, analytics is off.

### Game, backend and emulator

Three terminals, each started from the repository root:

```bash
# Terminal 1: Firestore emulator (Java 21+ on PATH), UI at http://localhost:4000
cd backend
pnpm install
pnpm emulators

# Terminal 2: analytics API at http://localhost:3000
cd backend
pnpm dev

# Terminal 3: the game, sending analytics to the API
cd game
pnpm install
cp .env.example .env.local
pnpm dev
```

Then open http://localhost:5173/ and play. `pnpm emulators` saves the data to `backend/emulator-data/` when stopped with Ctrl+C and loads it again on the next start; delete that folder to start empty. The emulator uses the project ID `demo-neon-snake`, so no Firebase account or credentials are needed, and the backend refuses to start without the emulator.

Other scripts:

```bash
# in game/
pnpm check          # type check
pnpm test           # unit tests (Vitest)
pnpm build          # production build into game/dist/
pnpm preview        # serve game/dist/ at http://localhost:4173/

# in backend/
pnpm check          # type check
pnpm test           # unit and HTTP tests, without the emulator
pnpm test:emulator  # Firestore adapter tests; starts its own emulator, so stop `pnpm emulators` first
```

## Test the complete flow locally

### Parts 2 and 3: game → backend → Firestore → statistics

Run `pnpm test` in `game/` and `backend/`, and `pnpm test:emulator` in `backend/`, for the automated checks. Then, with the three terminals from [above](#game-backend-and-emulator) running:

1. Check the API: `curl http://localhost:3000/api/health` answers `{"status":"ok"}`.
2. Play a few levels at http://localhost:5173/: clear level 1, fail a level on a wall, on your own tail and on a level 2 barrier, leave a level with "Exit to menu", restart a level during play.
3. Open a second tab, start a level and close the tab while playing.
4. Look at the data in the emulator UI (http://localhost:4000/firestore): one document per event in `events/`, one per level attempt in `runs/`. The closed tab's run has the status `unfinished`.
5. Read the statistics and compare them with what you played:

   ```bash
   curl http://localhost:3000/api/stats/overview
   curl http://localhost:3000/api/stats/levels
   ```

6. Backend down: stop terminal 2, play and fail a level, start `pnpm dev` again. Within about 30 s (the game's retry delay) the level's events arrive and the statistics include it.
7. Emulator restart: stop terminal 1 with Ctrl+C and start `pnpm emulators` again; the data is still there. The backend reconnects on its own within a few seconds.

#### How I confirmed it works

1. **Unit tests** without a browser or emulator: 94 in `backend/` (contract rules, ingestion with duplicates, conflicts and both arrival orders, statistics, every HTTP status code with Supertest, configuration) and 75 in `game/` (including `connectAnalytics`, `HttpEventSender` with fake `fetch`, timers and beacon, and the new `runEnded` fields).
2. **Emulator tests** (6, `pnpm test:emulator`): the Firestore adapter's transaction, duplicates, conflicts and both arrival orders against the real emulator.
3. **End to end** in headless Chrome against the emulator, the backend and the game's dev server: a script steered the snake through the game's real controller (the same call the arrow keys make), while the game's own loop and analytics code did the rest.

Results on 2026-10-01:

- 9 runs in 2 sessions: level 1 cleared; failed on a wall (twice), on the snake's own tail and on a level 2 barrier (twice, once while the backend was stopped); left with "Exit to menu"; restarted during play; and a second tab closed mid-level.
- `events/` held 17 events (9 starts, 8 ends) and `runs/` 9 runs, each matching its events; the closed tab's run was `unfinished`.
- The overview (2 sessions, 9 runs, 8 finished, 1 unfinished, completion rate 0.125, 4.5 runs per session) and the per-level statistics matched what was played, including the average durations computed from the game's own log.
- The run played while the backend was stopped arrived 3 s after the backend was back. With the emulator stopped, health, posting and the statistics answered `503` within 3 s; after an emulator restart the data was still there.
- Page exit: with the game's `fetch` requests held unanswered through Chrome's DevTools protocol, a level's `run_started` and `run_ended` were both still pending when the tab was closed; they reached Firestore through `sendBeacon`. A control run with `sendBeacon` disabled in the page stored nothing, so the beacon, not the held requests, delivered them.
- Not checked end to end: the platform's game over (`external`), which needs the Famobi SDK, and the page becoming hidden without closing (for example a mobile app switch); both are covered by unit tests.

### Part 1: the game → the Famobi SDK

Inside `game/`, run `pnpm test` for the automated checks, then follow these steps in the browser with Famobi's local tester:

1. In `game/`, run `pnpm dev` (or `pnpm build` and `pnpm preview`) and open the game in Chrome with DevTools open. Every SDK call is logged in the console as `GameInterface …`.
2. Loading: the console shows `getItem('neon-snake:profile')`, `sendPreloadProgress(0)`, the registered listeners, `sendPreloadProgress(100)` and `gameReady()`.
3. Play: Start logs `gameStart(1)`; eating fruit logs `sendScore` and `sendProgress`; clearing or failing a level logs the level and total `sendScore` and `gameEnd(...)` before the result screen appears; clearing level 3 also logs `gameFinished()`.
4. Pause and mute: the game's ‖ and ♪ buttons log `gamePause`/`gameResume` and `gameMuted`.
5. Platform events: after `gameReady` the tester adds a collapsible test menu (≡, top left). Use it to act as the platform: pause and resume during a level and on the menu, mute and unmute, go to a level, restart, quit, home. (It has no game-over button; `onGameOver` is covered by the unit tests.) The test menu is part of Famobi's local tester and does not appear on the Famobi portal.
6. Loading order: open `http://localhost:4173/?holdInit=1`. No game file loads until you click START in the tester's overlay.
7. Without the SDK: in DevTools, block the request for `init.js` (Network tab → right-click → Block request URL) and reload. The game loads by itself and plays normally, with no `GameInterface` logs.

#### How I confirmed it works

1. **Unit tests** (34, `pnpm test`) check the logic without a browser. A fake Famobi SDK records every call, and the tests assert the order and that the game waits, for example that no result screen appears before `gameEnd` resolves.
2. **Browser checks** load the real game in a headless Chrome, where the page counts as visible and the game actually runs.
   - A script clicks the game's real buttons and the tester's real buttons (pause, mute, restart, go to level, quit, home). It only steers the snake itself.
   - It reads the calls that Famobi's local tester writes to the console, compares their order with the specs, and checks what is on screen at each step.
3. **The no-SDK run** blocks `init.js` and confirms the game still works on its own.

Results on 2026-10-01:

- **Without the SDK** (`init.js` blocked, built game): the game loads, plays, pauses, clears a level and saves the profile to `localStorage`; no SDK calls.
- **With the SDK** (local tester, `pnpm dev`): loading order, `gameStart` before each level, live and end-of-level scores, progress, `gameEnd` before each result screen, `gameFinished` after level 3, player pause and mute, platform pause on the menu and during a level, master mute, and the restart, go-to-level, quit and home requests all behaved as described above.
- Not checked: tab switches (the tester sends no pause for them) and `onGameOver` (the tester menu has no button for it; it is covered by unit tests).
- Observed: the tester's own mute toggle occasionally ignores a click during a level (its `isMuted()` does not change either); the game always followed the SDK's mute state.

## Project structure

The repository holds independent projects side by side, each with its own `package.json` and install. They share no code and talk to each other only over HTTP: the event contract is written once in `backend/API.md` and implemented separately in the game's types and the backend's Zod schema. `dashboard/` will be added next to them the same way.

```text
README.md
LICENSE
.github/workflows/deploy-pages.yml   # builds game/ and deploys it to GitHub Pages
openspec/                            # plans (changes) and the resulting specs
game/                                # the game: an independent Vite project
├── package.json
├── .env.example               # VITE_ANALYTICS_URL for the local backend
├── index.html                 # loads init.js, then the game through GameInterface.init()
├── public/famobi.json         # { "maxLevels": 3 }
├── vite.config.ts             # IIFE build and the dev-server shim
└── src/
    ├── application/
    │   ├── GameController.ts  # commands, platform waits, persistence, domain events
    │   ├── GamePlatform.ts    # awaited platform moments + offlinePlatform
    │   └── gameEvents.ts
    ├── core/
    │   ├── audio/GameAudio.ts
    │   ├── events/EventBus.ts
    │   └── storage/GameStorage.ts   # profile over any key-value store (SDK storage or localStorage)
    ├── game/
    │   ├── input.ts
    │   ├── levels.ts
    │   ├── scenes/SnakeScene.ts
    │   ├── snakeGame.ts
    │   └── types.ts
    ├── platform/analytics/
    │   ├── AnalyticsEvent.ts        # event contract types, EventSender, NoopEventSender
    │   ├── connectAnalytics.ts      # controller run events → contract events
    │   ├── HttpEventSender.ts       # immediate POST, retries with backoff, beacon on page exit
    │   ├── listenForPageExit.ts     # visibilitychange (hidden) and pagehide
    │   ├── createEventSender.ts     # browser wiring, or the no-op sender without a URL
    │   └── randomId.ts
    ├── platform/famobi/
    │   ├── FamobiGameInterface.ts   # SDK types, getGameInterface()
    │   ├── FamobiPlatform.ts        # awaited moments as SDK calls
    │   └── connectFamobi.ts         # loading, score, progress, pause, mute, requests
    ├── test/spawnFoodAhead.ts       # test helper: fruit always spawns in front of the snake
    ├── main.ts
    └── style.css
backend/                             # the analytics API: an independent Node.js project
├── package.json
├── API.md                     # the event contract and every endpoint
├── firebase.json              # Firestore emulator on 8080, UI on 4000
├── .firebaserc                # project demo-neon-snake
├── firestore.rules            # no client access; only the backend writes, through the Admin SDK
└── src/
    ├── server.ts              # composition root
    ├── config.ts              # env settings; refuses to start without the emulator or a demo- project
    ├── http/                  # createApp() with routes and error answers, cors()
    ├── services/              # contract (Zod), IngestionService, StatsService, stats, runRecord, storeDeadline
    ├── ports/                 # EventStore, Clock
    ├── adapters/              # FirestoreEventStore, InMemoryEventStore, systemClock
    └── test/events.ts         # event fixtures
```

The game simulation remains independent from Phaser and from Famobi. The application controller coordinates commands, persistence, audio, and domain events; the Famobi adapter translates them into SDK calls. The Phaser scene adapts simulation state into graphics and input, while the HUD and menus remain accessible DOM elements.

The included workflow builds and deploys the game to GitHub Pages whenever the default branch is updated; there `init.js` stays inactive and the game runs without the SDK.

## Main technical decisions and assumptions

Where the brief or the Famobi docs leave room for interpretation, these are the choices made and why.

### Part 1: SDK integration

The overall structure is described under [How it is built](#how-it-is-built).

**Scope**

- The SDK is wired only to features the game already has. No new game features were added, and the game's logic (levels, scoring, unlocks, saving) stays the same.
- Not done: the `hasFeature` flags (UI-01/02/04, Misc-02 tutorial, Misc-03 visibilitychange, Misc-05 home), the Famobi copyright logo (UI-03), ads, in-app purchases, localisation and credits, because the brief does not ask for them.
- No stage events: Neon Snake levels have no stages.
- `GameInterface.log` (Misc-01) is not needed: the game has no `console` calls.

**Scores and progress**

- Level score = points earned in that level: the docs ask for a per-level score, and the game already tracks the score at level start. Famobi's Game-08 example sends the running score as the level score instead.
- Total score = the run's score on screen, which carries over between levels. The Game-08 example sends a lifetime total ("total cumulative score across all sessions/levels"), but that is only an example, and a lifetime total would be a new profile field. Assumption to confirm with Famobi.
- Progress = integer percentage of the level's fruit target: fruit eaten is the only progress within a level, and 0-100 matches `sendPreloadProgress`.
- Preload is sent as 0, then 100 just before `gameReady`: the game has no assets to download (graphics and audio are procedural).
- `gameEnd` metrics (level, score, levelScore, durationMs, progress): uses the documented `EventParams.metrics` shape; Famobi's optional Analytics-01 asks for metrics that show level difficulty, and these are the values the game already has.

**Waiting for the platform**

- One command at a time: player and platform commands that arrive while an SDK promise is pending are dropped. This prevents double clicks and conflicting transitions while gameplay must wait. End-of-level events are always queued, so none are lost.
- The snake freezes while a promise is pending: the docs forbid gameplay continuing before the promise resolves, and it stops the player dying during a pending pause. For `gamePause` this is a conscious deviation from the wording of Game-06 ("do not pause gameplay until resolved"); the pause menu still appears only after the promise resolves.
- Restart and go-to-level during play keep the frozen level on screen until the new level starts: this avoids a menu flicker between `gameEnd("quit")` and `gameStart`. The run is still counted and reported as ended and started.
- Leaving a result screen sends no second `gameEnd`: the SDK's order check rejects `gameEnd` after `gameEnd`.
- `gameFinished` is sent the first time the last level is cleared in a session, including when level 3 is chosen from the level select: level 3 unlocks only after levels 1 and 2 are cleared, so every level has been finished (Game-11). The SDK allows it only once per session.

**Pause and mute**

- The platform pause applies on every screen and blocks Start, the level select, retry and next level: Pause-01 says the pause can arrive at any moment and player input must stop.
- Platform pause and mute changes apply immediately, even while an SDK promise is pending; a level started during a platform pause begins frozen, for the same reason.
- No own tab-visibility handling: Phaser already freezes the game while the tab is hidden, and a platform pause stays in the game's state until `onPauseStateChange(false)`, so returning to the tab never lifts it (Pause-02).

**Platform requests**

- `onGoToLevel` for a level the player has not reached yet starts the highest unlocked level instead: the request is still answered with a level start, but a jump to a locked level would let `gameFinished` fire, or level 3 unlock, without the earlier levels being played. Requests-03 does not mention unlocks; this is my reading.
- `onGoToNextLevel` during an active level keeps the game's existing behavior and starts the next level, even if it is still locked.
- `onRestartGame` restarts the current level, not the whole game: it matches the game's existing Try again button.
- Go-home and quit both return to the menu and are ignored at the menu: the game has a single menu screen and nothing to leave when already there (the Requests docs ask for them "at least during the actual gameplay").

**Storage**

- Saving keeps its existing timing (for example, the best score is written whenever it is beaten): the game's logic stays the same; these are meaningful changes under Storage-01, and nothing is written per frame.
- Existing `localStorage` saves are not migrated: on Famobi the SDK storage is the only store, so a player there starts with level 1 unlocked and no best score. The no-SDK fallback keeps the same key (`neon-snake:profile`), so those saves still work there.

**Loading and build**

- `init.js` sits in `<head>` (Start-01), and `init()` is called after the markup: the game reads its page elements as soon as its script runs.
- The bundle starts itself instead of from `init([...]).then(...)`: Start-03 allows a game that starts when its engine loads; `init()` runs the files in order after the CSS, and the fallback needs no second start path.
- No-SDK fallback: `init.js` only activates on localhost, private-network hosts, `*.local` or when forced, so GitHub Pages must load the game itself; the fallback also keeps the game playable offline (Basics-04). With the SDK present, the files are never embedded manually.
- IIFE build and dev-server shim: `init()` runs files as classic scripts, so ES modules cannot load; the shim keeps one code path for `pnpm dev` and production.

### Parts 2 and 3: analytics and backend

The structure is described under [Gameplay analytics](#gameplay-analytics) and [Analytics backend](#analytics-backend).

**What is measured**

- A *run* is one level attempt, from its start to clearing, failing or leaving it: the brief asks when gameplay starts and ends, which level was played and whether the player completed, failed or left it, which all describe one attempt; it is also the unit the game (and Famobi's `gameStart`/`gameEnd`) already has.
- A *session* is one page load with any number of runs; a reload or a new tab starts a new one. No player ID is kept across visits, so no personal data is stored. Assumption: the brief does not define sessions or players, and a visit is the grouping that needs no personal data.
- The `run_ended` fields mirror Famobi's `gameEnd` metrics, plus the outcome and the failure reason: the reason shows what fails players, which serves the brief's goal of seeing "where the player experience can be improved". The failure reason stays out of Famobi's metrics, so the SDK integration is unchanged.
- Three outcomes, `complete`, `fail` and `quit`; a run without an end is `unfinished`. There is no separate "abandoned" status: the brief's "left the gameplay" is covered by `quit`, and a closed tab cannot be told apart from a run still in play without guessing a timeout.
- Statistics: an overview, and per level the outcomes, completion rate, average duration, how far failed runs got (progress ranges) and what failed them. No funnel and no activity-over-time chart: unlocks persist across visits, so a funnel of levels per session would be misleading, and activity over time shows little with local test data.
- Completion rate = complete ÷ (complete + fail + quit): unfinished runs may still be in play, so they are shown as their own count and left out of rates. The average duration also leaves them out.

**Keeping the data trustworthy**

- The first stored event of a run fixes its session and level, and a run takes at most one start and one end; anything else is rejected, not merged: "last write wins" would let a buggy or foreign client silently change a run's level or outcome.
- Progress is checked against the outcome (exactly 100 for `complete`, below 100 for `fail` and `quit`), so contradictory events are rejected. The game caps a failed or left run at 99 % when rounding would reach 100.
- Every event has an ID created once, when the game records it; resends keep it, and the backend counts a known ID as a duplicate. So retries and a beacon racing a `fetch` never count twice.
- The backend stores `receivedAt` next to the game's `occurredAt` and rejects times more than 5 minutes in the future: client clocks can be wrong; past times are accepted because events can be retried late.
- Fields outside the contract are dropped, and IDs are limited to letters, digits, `-` and `_` because they become Firestore document IDs.

**Delivery**

- Each event is sent at once, not batched on a timer: simpler, and the dashboard is fresher; traffic is tiny. Batches of up to 50 only happen for retries and at page exit.
- Retry on network errors, timeouts (5 s), `408`, `429` and `5xx`; drop on other `4xx` and on events listed as rejected: those would fail again. Backoff 1 s doubling to 30 s with ±20 % jitter, capped after the jitter so it never exceeds 30 s. At most 100 events pending; the oldest are dropped first.
- At page exit the pending events go out with `sendBeacon` as `text/plain`: a JSON content type would need a CORS preflight, which a beacon cannot make. The backend reads `text/plain` bodies as JSON.
- The backend gives Firestore 3 s per call and then answers `503`: below the game's 5 s timeout, so the game gets a clear "try later" instead of a timeout. A batch is saved one event at a time, so a start and its end in one batch never race, and a resent batch is safe because stored events count as duplicates.

**Backend and Firebase**

- Express 5 and Zod: small and well known; the Zod schema is the enforced contract and gives a readable reason per rejected field. CORS is a few lines of own middleware instead of another dependency.
- Layers with injected interfaces (HTTP → services → `EventStore` port → Firestore adapter): each layer is tested without the next one, and Firestore is one implementation of the storage interface (the tests use an in-memory one).
- Two collections, `events/` as the source of truth and `runs/` as one summary per attempt: the statistics need no re-pairing of events, and the runs are easy to read in the emulator UI.
- Statistics are computed on each request from all runs: correct by construction and enough for local data (see the improvements for large data).
- Emulator only, with the project ID `demo-neon-snake`: the brief asks for the Local Emulator Suite; a `demo-` project cannot reach a real Firebase project and needs no credentials. The backend refuses to start without an emulator host or with another project ID. `firestore.rules` denies all client access, since only the backend writes, through the Admin SDK.
- Independent projects: the game and the backend share no code; the contract is written once in `backend/API.md` and implemented twice (TypeScript types in the game, Zod in the backend). No root `package.json` starts everything, so the README lists three terminals instead.

## Known limitations

**Parts 2 and 3: analytics and backend**

- A run whose tab was closed stays `unfinished` forever, mixed with runs still in play; both are left out of the rates and shown as one count.
- `sendBeacon` is best effort: the browser may still lose events at page exit, and a lost end leaves the run `unfinished`. Events still pending when the page closes and the beacon fails are lost too.
- No authentication or rate limiting: any page can post events, because a `text/plain` POST needs no CORS preflight; CORS only hides the responses from other origins. Acceptable for a local-only challenge.
- The statistics read every run on each request, which is fine locally but grows with the data.
- Times come from the player's clock (`occurredAt`); only times far in the future are rejected. `receivedAt` is stored next to it.
- The contract exists twice (game types and backend schema) and could drift; `backend/API.md` is the reference, and the backend rejects anything that does not match it with a clear reason.
- After an emulator restart, the backend answers `503` for a few seconds until it has reconnected; the game retries meanwhile.
- The backend's scripts need a POSIX shell (macOS, Linux, WSL or Git Bash).

**Part 1: SDK integration**

- "Play again" after clearing the last level sends `gameStart` after `gameFinished`, which the local tester reports as an invalid event, because the SDK allows no events after `gameFinished`. Open question for Famobi.
- Phaser freezes the game while the tab is hidden, also on portals that would require it to keep running (Misc-03); that needs the out-of-scope `hasFeature("visibilitychange")`.
- Tab switches cannot be verified with the local tester, which does not send a pause for them.
- The snake freezes before `gamePause` resolves (see the Game-06 deviation above).
- A platform request that arrives while another SDK promise is pending is dropped.
- The local tester SDK is downloaded from Famobi, so checking the SDK calls locally needs an internet connection.
- On Famobi, existing browser saves are not carried over into the SDK storage.

## What I would improve with more time

**Parts 2 and 3: analytics and backend**

- Detect closed tabs, for example by marking a run abandoned after a timeout or when a later run of the same session starts, and show it as its own outcome.
- Send the failure reason to Famobi as an extra `gameEnd` metric, so the portal sees it too.
- Keep counters per level (updated in the same transaction, or aggregated on a schedule) instead of reading all runs per request, once the data grows.
- Authentication for the event endpoint (for example signed requests or Firebase App Check) and rate limiting.
- A contract test that feeds exactly the events the game produces into the backend's validation, or a generated shared schema, so the two sides cannot drift.

**Part 1: SDK integration**

- Implement the `hasFeature` flags and the copyright logo, so the game adapts to each portal's requirements.
- Confirm with Famobi the meaning of the total score and whether "Play again" after `gameFinished` is acceptable.
- Add an automated browser test (for example Playwright) that plays through with the local tester and checks the order of SDK calls in the console.
- Reduce the bundle size (about 1.2 MB, 326 kB gzipped), for example with a custom Phaser build.

## Use of AI tools

All parts so far were developed with Claude Code (Claude Opus 5.5, by Anthropic).

- **Part 1:** it was used to read and compare the Famobi documentation with the code, write and revise the OpenSpec plan (`openspec/changes/archive/2026-10-01-famobi-sdk-integration/`, with the resulting specs in `openspec/specs/famobi-sdk/`), implement the code and tests, check the game in Chrome, and draft this README.
- **Parts 2 and 3:** it was used to write and revise the OpenSpec plan (`openspec/changes/add-gameplay-analytics-backend/`), implement the analytics, the backend and their tests, run the end-to-end check in headless Chrome, and draft the README sections and `backend/API.md`.

The design decisions above were discussed and chosen by me, and I reviewed the implementation task by task.

## License

MIT