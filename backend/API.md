# Neon Snake Analytics API

The backend receives gameplay events from the game and serves statistics for the dashboard. It runs on `http://localhost:3000` (`PORT`) and stores data only in the local Firestore emulator.

- [Event contract](#event-contract)
- [POST /api/events](#post-apievents)
- [GET /api/stats/overview](#get-apistatsoverview)
- [GET /api/stats/levels](#get-apistatslevels)
- [GET /api/health](#get-apihealth)
- [Errors](#errors)
- [CORS](#cors)

## Event contract

Schema version `1`. The game records one `run_started` and one `run_ended` event per run (one level attempt). A session is one game-page session: a reload or a new tab starts a new one.

### Common fields

| Field | Type | Rule |
| --- | --- | --- |
| `schemaVersion` | number | `1` |
| `eventId` | string | unique per event; kept when the event is resent |
| `type` | string | `run_started` or `run_ended` |
| `sessionId` | string | one per page session |
| `runId` | string | one per level attempt |
| `level` | number | positive integer |
| `occurredAt` | string | ISO 8601 UTC time, e.g. `2026-10-01T12:00:00.000Z`; at most `MAX_FUTURE_SKEW_MS` (5 minutes) ahead of the server clock; no limit on past times |

IDs consist of 1 to 100 letters, digits, `-` or `_` (`^[A-Za-z0-9_-]{1,100}$`).

### `run_ended` fields

| Field | Type | Rule |
| --- | --- | --- |
| `outcome` | string | `complete`, `fail` or `quit` |
| `failureReason` | string or null | required for `fail`: `wall`, `snake`, `obstacle` or `external` (a game over requested by the platform); absent or `null` otherwise |
| `score` | number | non-negative integer: the run's on-screen score |
| `levelScore` | number | non-negative integer: points earned in this level |
| `progress` | number | integer 0-100, share of the level's fruit target; exactly `100` for `complete`, below `100` for `fail` and `quit` |
| `durationMs` | number | non-negative integer |

For `run_started`, `failureReason` must be absent or `null`. Fields outside the contract are dropped and not stored.

### Examples

```json
{
  "schemaVersion": 1,
  "eventId": "Jq8v2LxT0bM1kz3c",
  "type": "run_started",
  "sessionId": "p4Rk9sWm2nQe7tYb",
  "runId": "H3fZ8aKd1uVo6cXs",
  "level": 2,
  "occurredAt": "2026-10-01T12:00:00.000Z"
}
```

```json
{
  "schemaVersion": 1,
  "eventId": "a7Dn4Wq0Ry2Lp9Ve",
  "type": "run_ended",
  "sessionId": "p4Rk9sWm2nQe7tYb",
  "runId": "H3fZ8aKd1uVo6cXs",
  "level": 2,
  "occurredAt": "2026-10-01T12:00:14.250Z",
  "outcome": "fail",
  "failureReason": "obstacle",
  "score": 70,
  "levelScore": 20,
  "progress": 29,
  "durationMs": 14250
}
```

### Runs

The first stored event of a run fixes its session and level. A run has at most one `run_started` and one `run_ended`. A run without a `run_ended` is `unfinished`: still being played, or its page was closed. The order in which a run's two events arrive does not matter.

## POST /api/events

Stores a batch of 1 to 50 events.

- Body: a JSON array of events, at most 100 kB, sent as `application/json` or as `text/plain` (the form `navigator.sendBeacon` uses at page exit; the body is still JSON).
- Events are checked and saved one at a time, in array order.

### `202 Accepted`

```json
{
  "accepted": 1,
  "duplicates": 1,
  "rejected": [
    { "index": 2, "errors": ["level: must be a positive integer"] }
  ]
}
```

- `accepted`: events stored now.
- `duplicates`: events whose `eventId` was already stored (also a repeat within the same batch). They change nothing and are safe to resend.
- `rejected`: events that do not match the contract or conflict with their run, with their position in the array and the reasons. Each reason names the field it is about. Conflicts:
  - `sessionId: run r1 belongs to session s1`
  - `level: run r1 is on level 1`
  - `type: run r1 already has a run_ended event`

  A rejected event is not stored and should not be resent.

### Other answers

| Status | When |
| --- | --- |
| `400` | the body is not valid JSON, not an array, empty, or holds more than 50 events; nothing is stored |
| `413` | the body is larger than 100 kB; nothing is stored |
| `503` | the store did not answer within 3 s; processing stopped there. Events before that point may be stored, so resending the batch is safe |

## GET /api/stats/overview

```json
{
  "sessions": 2,
  "runs": 5,
  "finished": 4,
  "unfinished": 1,
  "completionRate": 0.5,
  "runsPerSession": 2.5
}
```

- `finished`: runs with a `run_ended` (`complete`, `fail` or `quit`), also when their `run_started` is missing.
- `completionRate`: complete ÷ finished; `null` when no run has finished.
- `runsPerSession`: runs ÷ sessions; `null` without runs.

`503` when the store did not answer within 3 s.

## GET /api/stats/levels

Every level with at least one run, in ascending order. Levels without runs are left out.

```json
{
  "levels": [
    {
      "level": 2,
      "outcomes": { "complete": 1, "fail": 3, "quit": 0, "unfinished": 1 },
      "completionRate": 0.25,
      "averageDurationMs": 12500,
      "failedByProgress": { "0-19": 2, "20-39": 1, "40-59": 0, "60-79": 0, "80-99": 0 },
      "failedByReason": { "wall": 1, "snake": 0, "obstacle": 2, "external": 0 }
    }
  ]
}
```

- `completionRate`: complete ÷ (complete + fail + quit); `null` when the level has no finished runs.
- `averageDurationMs`: average duration of finished runs (unfinished runs excluded), rounded to whole milliseconds; `null` when the level has no finished runs.
- `failedByProgress`: failed runs per progress range. A run at 100 % has completed, so the last range ends at 99.
- `failedByReason`: failed runs per failure reason.
- All ranges and reasons are always present, with `0` where there are no runs.

`503` when the store did not answer within 3 s.

## GET /api/health

- `200` with `{ "status": "ok" }` when the Firestore emulator answers within 3 s.
- `503` with the error format otherwise.

## Errors

Every error answer has this form; `details` is optional:

```json
{ "error": { "message": "Body must be a JSON array of 1 to 50 events" } }
```

Unexpected errors are logged on the server and answered with `500` and a generic message.

## CORS

Only these origins may read responses (`ALLOWED_ORIGINS`, comma-separated):

- `http://localhost:5173` (game, dev server)
- `http://localhost:4173` (game, preview)
- `http://localhost:5174` (dashboard)

The backend answers the CORS preflight for `application/json` posts. CORS only controls which pages can read responses; it does not stop other pages from posting events.
