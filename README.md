# Neon Snake

A compact browser game built with Phaser 3, TypeScript, Vite, and a DOM-based interface, integrated with the [Famobi GameInterface SDK](https://docs.famobi.com/).

This repository covers part 1 of the Famobi development challenge: the SDK integration. Parts 2–4 (gameplay analytics, a Node.js backend on the Firebase Local Emulator Suite, and a React dashboard) are not part of it yet.

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

- `src/application/GamePlatform.ts` is a small interface for the awaited moments (`startRun`, `endRun`, `finishGame`, `pauseRun`, `resumeRun`). The controller only knows this interface; `offlinePlatform` is used without the SDK.
- `src/platform/famobi/` holds all Famobi knowledge: `FamobiPlatform` implements the interface with SDK calls, and `connectFamobi` wires loading, live score and progress, pause, mute and the platform requests.
- `GameController` runs player and platform commands one at a time. While it waits for the platform it is "busy": the snake is frozen, buttons are disabled, and a result screen stays hidden until `gameEnd` resolves.
- `GameInterface.init()` runs each file as a classic script, so the production build is a single IIFE bundle (`game.js`) plus `game.css`. In development a small Vite shim serves the same two URLs, so `pnpm dev` also loads the game through `init()`.

## Install and run

Requirements: Node.js 22.13 or newer (pnpm 11 does not start on older versions) and pnpm 11. With nvm: `nvm install 22 && nvm use 22`.

```bash
pnpm install
pnpm dev
```

Then open http://localhost:5173/. On localhost, Famobi's `init.js` loads its local tester SDK, which needs an internet connection. Offline, the page falls back to loading the game without the SDK.

Other scripts:

```bash
pnpm check     # type check
pnpm test      # unit tests (Vitest)
pnpm build     # production build into dist/
pnpm preview   # serve dist/ at http://localhost:4173/
```

## Test the complete flow locally

For part 1 the flow is: the game → the Famobi SDK. Run `pnpm test` for the automated checks, then follow these steps in the browser with Famobi's local tester:

1. Run `pnpm dev` (or `pnpm build` and `pnpm preview`) and open the game in Chrome with DevTools open. Every SDK call is logged in the console as `GameInterface …`.
2. Loading: the console shows `getItem('neon-snake:profile')`, `sendPreloadProgress(0)`, the registered listeners, `sendPreloadProgress(100)` and `gameReady()`.
3. Play: Start logs `gameStart(1)`; eating fruit logs `sendScore` and `sendProgress`; clearing or failing a level logs the level and total `sendScore` and `gameEnd(...)` before the result screen appears; clearing level 3 also logs `gameFinished()`.
4. Pause and mute: the game's ‖ and ♪ buttons log `gamePause`/`gameResume` and `gameMuted`.
5. Platform events: after `gameReady` the tester adds a collapsible test menu (≡, top left). Use it to act as the platform: pause and resume during a level and on the menu, mute and unmute, go to a level, restart, quit, home. (It has no game-over button; `onGameOver` is covered by the unit tests.) The test menu is part of Famobi's local tester and does not appear on the Famobi portal.
6. Loading order: open `http://localhost:4173/?holdInit=1`. No game file loads until you click START in the tester's overlay.
7. Without the SDK: in DevTools, block the request for `init.js` (Network tab → right-click → Block request URL) and reload. The game loads by itself and plays normally, with no `GameInterface` logs.

### How I confirmed it works

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

```text
index.html                 # loads init.js, then the game through GameInterface.init()
public/famobi.json         # { "maxLevels": 3 }
vite.config.ts             # IIFE build and the dev-server shim
src/
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
├── platform/famobi/
│   ├── FamobiGameInterface.ts   # SDK types, getGameInterface()
│   ├── FamobiPlatform.ts        # awaited moments as SDK calls
│   └── connectFamobi.ts         # loading, score, progress, pause, mute, requests
├── test/spawnFoodAhead.ts       # test helper: fruit always spawns in front of the snake
├── main.ts
└── style.css
```

The game simulation remains independent from Phaser and from Famobi. The application controller coordinates commands, persistence, audio, and domain events; the Famobi adapter translates them into SDK calls. The Phaser scene adapts simulation state into graphics and input, while the HUD and menus remain accessible DOM elements.

The included workflow builds and deploys the game to GitHub Pages whenever the default branch is updated; there `init.js` stays inactive and the game runs without the SDK.

## Main technical decisions and assumptions

The overall structure is described under [How it is built](#how-it-is-built). Where the brief or the Famobi docs leave room for interpretation, these are the choices made and why.

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

## Known limitations

- "Play again" after clearing the last level sends `gameStart` after `gameFinished`, which the local tester reports as an invalid event, because the SDK allows no events after `gameFinished`. Open question for Famobi.
- Phaser freezes the game while the tab is hidden, also on portals that would require it to keep running (Misc-03); that needs the out-of-scope `hasFeature("visibilitychange")`.
- Tab switches cannot be verified with the local tester, which does not send a pause for them.
- The snake freezes before `gamePause` resolves (see the Game-06 deviation above).
- A platform request that arrives while another SDK promise is pending is dropped.
- The local tester SDK is downloaded from Famobi, so checking the SDK calls locally needs an internet connection.
- On Famobi, existing browser saves are not carried over into the SDK storage.

## What I would improve with more time

- Implement the `hasFeature` flags and the copyright logo, so the game adapts to each portal's requirements.
- Confirm with Famobi the meaning of the total score and whether "Play again" after `gameFinished` is acceptable.
- Add an automated browser test (for example Playwright) that plays through with the local tester and checks the order of SDK calls in the console.
- Reduce the bundle size (about 1.2 MB, 326 kB gzipped), for example with a custom Phaser build.

## Use of AI tools

This part was developed with Claude Code (Claude Opus 5.5, by Anthropic). It was used to read and compare the Famobi documentation with the code, write and revise the OpenSpec plan (`openspec/changes/archive/2026-10-01-famobi-sdk-integration/`, with the resulting specs in `openspec/specs/famobi-sdk/`), implement the code and tests, check the game in Chrome, and draft this README. The design decisions above were discussed and chosen by me, and I reviewed the implementation.

## License

MIT