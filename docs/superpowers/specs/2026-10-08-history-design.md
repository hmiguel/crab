# Persistent history — Design

## Context
Crab forgets every response when you run again or restart. Persistent, searchable history is the rest of milestone M2 in `ROADMAP.md`. Environments, the first part of M2, is merged, and requests already reach the backend masked (`ResolvedRequest::masked`, `crates/crab-core/src/model.rs`).

**Agreed brief**
- **What you said:**
  - History is mainly for **seeing what an API returned**. Store the full masked request and the response.
  - Show it in a **History tab in the sidebar**, and in a **per-request list** in the response panel.
  - Use SQLite in the Rust core (approach 1).
- **Assumptions:**
  - Keep the last 1,000 runs, with bodies capped at 1 MB.
  - History lives in the app data folder, never in the repo.
  - Diffing two responses is out of scope and moves to M5.
- **Success:**
  - Run a request, restart Crab, find the run in History by a word from its response body, and open it read-only with its date.
  - The response panel lists earlier runs of the request under the cursor.
  - ⌘P finds past runs.
  - A broken database never stops requests from running.

## 1. Storage and recording (`crates/crab-core/src/history.rs`, new)
**Dependency:** `rusqlite` with the `bundled` feature. It compiles SQLite into the binary, with FTS5 included.

**Schema**, created on open if missing, with `PRAGMA user_version = 1`:
```sql
CREATE TABLE runs (
  id INTEGER PRIMARY KEY,
  at_ms INTEGER NOT NULL,            -- unix epoch milliseconds, when the run started
  path TEXT,                         -- .http file
  request_key TEXT NOT NULL,
  name TEXT,
  method TEXT NOT NULL,
  url TEXT NOT NULL,                 -- masked, resolved
  env TEXT,
  status INTEGER,                    -- null when the run errored
  error_kind TEXT,                   -- network | timeout | cancelled, null on success
  error_message TEXT,
  total_ms REAL, ttfb_ms REAL, size_bytes INTEGER,
  request_json TEXT NOT NULL,        -- masked ResolvedRequest
  response_json TEXT,                -- ResponseData minus the body fields, null on error
  body_text TEXT, body_base64 TEXT, truncated INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX runs_key_at ON runs(request_key, at_ms DESC);
CREATE VIRTUAL TABLE runs_fts USING fts5(name, url, body, content='');
```
The full-text table stores only the index. Its rowid equals `runs.id`, and it's kept in step by `record`, `prune` and `clear`.

**Request key.** `request_key(text, line) -> Option<RequestKey { key, name }>` lives in `crates/crab-core/src/lib.rs` and uses the same parser as `prepare_request`.
- Named requests: `key = "<name>"`.
- Unnamed requests: `key = "<METHOD> <url as written>"`, for example `GET {{host}}/orders`.

The file path is stored separately. Lists filter by `(path, request_key)`.

**API**
- `History::open(path: &Path) -> Result<History, CrabError>` creates the parent folder and schema. It then checks that it can write, with `BEGIN IMMEDIATE; COMMIT;`, so a read-only or locked file fails here instead of quietly at the first run. An error is `Io`.
- `History::record(&self, run: &NewRun) -> Result<i64, CrabError>`:
  - inserts the run and its full-text entry, then prunes to the newest `limit` runs (default 1,000; `History::with_limit` sets it in tests);
  - caps the body at 1 MB (`MAX_BODY_BYTES = 1_048_576`), cutting text on a character boundary, and sets `truncated`;
  - only ever receives the masked request.
- `History::list(&self, q: &ListQuery) -> Result<Vec<RunSummary>, CrabError>`:
  - `ListQuery { query: Option<String>, path: Option<String>, key: Option<String>, before: Option<i64 /* id */>, limit: u32 }`, newest first;
  - `query` uses FTS5 with each word quoted as a phrase prefix, so user input can't produce invalid FTS syntax;
  - a summary carries no request or body.
- `History::get(&self, id: i64) -> Result<Option<PastRun>, CrabError>`. `PastRun { summary: RunSummary, response: Option<ResponseData> }`. For errored runs, `response` is null and the summary carries the error.
- `History::clear(&self) -> Result<(), CrabError>`.

**Recording rules**
- Recorded: every run that was **sent**, which means successes and the `network`, `timeout` and `cancelled` errors.
- Not recorded: runs that fail before sending (`parse`, `unresolvedVars`, `env`, and `io` from body files).
- A failed history write never changes the run's own result. The app records its message as the history error (Section 2), so the History tab shows the warning.

**Tests** (`crates/crab-core/tests/history.rs`, using `tempfile`):
- a round trip of a successful run, and of an errored run,
- the masked URL is what's stored,
- the 1 MB cap is applied on a character boundary,
- pruning with `with_limit(3)`, including the full-text entries,
- search by a body word, with special characters (`"`, `*`, `-`, `:`) in the query,
- filtering by path and key, and paging with `before`,
- `clear`,
- reopening keeps the data,
- opening a read-only file fails,
- `request_key` for named and unnamed requests and for a line outside any request.

## 2. Commands and frontend state

### Tauri
- In `src-tauri/src/lib.rs` `.setup()`: `History::open(app_data_dir/history.db)`. Store `Mutex<Option<History>>` and `history_error: Mutex<Option<String>>` in `AppState`.
- `run_request` (`src-tauri/src/commands.rs`):
  - computes `request_key` before running and notes the start time;
  - after `execute`, on success or on a network, timeout or cancelled error, builds a `NewRun` from the masked request and the response or error, and calls `record`;
  - `ResponseData` gains `history_id: Option<i64>`, set on success. Errored runs are recorded but return the error as before.
- Commands:
  - `history_list(query: ListQuery) -> Vec<RunSummary>`
  - `history_get(id) -> Option<PastRun>`
  - `history_clear()`
  - `history_status() -> { enabled: bool, error: Option<String> }`. `enabled` is false when opening failed. `error` is also set by the latest failed `record`.
  - `request_key(text, line) -> Option<RequestKey>`, which `openPastRun` and the response panel's History dropdown use.
  - When history is off, the first three return empty results or do nothing, never an error.

### `src/state/history.ts` (new)
- State: `items: RunSummary[]`, `query`, `hasMore`, `status`, `forRequest: { path, key, items }`.
- Actions:
  - `setQuery(q)`, debounced 200 ms, resets and reloads;
  - `loadMore()` uses `before` set to the last id;
  - `refresh()` reloads the first page and the current request's list;
  - `loadForRequest(path, key)`;
  - `clear()` asks first, using `ask` from the dialog plugin.
- `runAt` (`src/state/run.ts`) calls `useHistory.getState().refresh()` after every run that settles, success or error.

### Past runs in the response store (`src/state/responses.ts`)
- `RunState`'s `done` variant gains an optional `past?: { id: number; at: number }`.
- `showPast(tabId, past: PastRun)` sets it, and a new run replaces it.

### Opening a past run (`src/ui/history-actions.ts`, new): `openPastRun(id)`
1. `history_get(id)`. Null means the run was cleared or pruned: show "This run is no longer in history".
2. If `summary.path` exists:
   - open the file;
   - find the request whose key matches (parse the tab text and compute keys the same way, through `api.requestKey`), falling back to the stored request line;
   - reveal it and call `showPast` on that tab.
3. If the file is missing:
   - call `showPast` on the active tab, if there is one;
   - show "The file <path> no longer exists". The run is still shown read-only.

### Tests (vitest)
- History store: debounced search, paging, `refresh` after `runAt`, and `clear` asking first.
- Response store: `showPast`, and a new run replacing it.
- `openPastRun`: a request that moved (matched by key), a missing file, a pruned run.

## 3. UI

### Sidebar (`src/components/Sidebar.tsx`)
- The header becomes two tabs, **Workspace | History**. The active tab is remembered in the session state.
- **`src/components/HistoryView.tsx` (new):**
  - a search box;
  - groups headed **Today**, **Yesterday**, then the date in the system's locale;
  - each row shows: the method (`.method m-…`), the name or masked URL, the status (with `statusClass`) or the error title, the environment dot (`colorOf`) and the local time; the row's tooltip shows the file and duration;
  - more rows load when the user scrolls near the bottom;
  - a **Clear history** button at the bottom;
  - when `status.enabled` is false, the warning `History is off: <error>`.

### Response panel (`src/components/ResponsePanel.tsx`)
- **History dropdown:** a `History (n)` dropdown in the summary header for the request under the cursor. It lists the newest 20 runs of `(path, key)` with time, status and environment. Picking one calls `showPast`, and **Latest** puts the live run back. It's hidden when there are no past runs.
- **Past-run banner:** `From <date time> · <env> · Run again`. **Run again** runs the request at the cursor.
- **Reveal secrets** is hidden for past runs, because the real values were never saved.

### ⌘P (`src/components/QuickOpen.tsx`)
For queries of 3 or more characters, call `history_list({ query, limit: 8 })`, debounced 150 ms. Results go in a **Past runs** group below the ranked files and requests: the method, the label and the date. Enter or a click calls `openPastRun`.

### Docs
- README:
  - a feature line;
  - a **History** section: what's stored, the 1,000-run and 1 MB limits, search, the per-request list, Clear history;
  - a `history.db` line in "Where Crab keeps its data";
  - **the privacy note:** requests are stored masked, responses are stored as received.
- CHANGELOG under Unreleased. `ROADMAP.md`: remove M2, and add "diff two responses" to M5.
- Run `pnpm site:llms`.

## Out of scope
- Diffing responses.
- Configurable retention.
- Exporting history.
- History shared between machines.
- Masking secrets that appear in responses.

## Verification
- `cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace`
- `pnpm build && pnpm test`
- Manual checks in `pnpm tauri dev`:
  1. Run three requests and restart. All three appear in History under Today.
  2. Search for a word that only appears in one response body, and only that run is listed.
  3. Run the same request twice. **History (2)** appears and picking the older run shows the banner. **Latest** goes back.
  4. In ⌘P, type a word from a past response. The run appears under **Past runs**, and Enter opens it.
  5. Clear history, confirm, and the list is empty.
  6. Quit, run `chmod 444` on `history.db`, and relaunch. Requests still run, and History shows the "History is off" warning.
