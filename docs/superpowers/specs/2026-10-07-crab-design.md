# Crab — open-source, cross-platform `.http` API client — Design

## Context
Crab is an **open-source**, **cross-platform** (Windows first) API client built with **Tauri v2** around plain `.http`/`.rest` files: files stay on disk and work with Git, a workspace spans many repos, and it adds tabs, environments, history, a rich response viewer and an MCP server. The project starts empty in `~/github/crab` (no git repo yet).

**Agreed brief**
- What you said: open source; Tauri; Windows first; a desktop client for `.http` files with workspace, tabs, environments, history and a rich response viewer.
- **v1 scope:** the core runner plus workspace and tabs.
- **Later:** M2 adds environments (`http-client.env.json`, `.env`, per-file env selection) and persistent, searchable history. M3 adds a `crab-cli` and an MCP server.
- Assumptions (correct me if any are wrong):
  - In-file `@var = value` variables and basic `{{$guid}}`/`{{$timestamp}}`/`{{$randomInt}}` work in v1.
  - Request chaining (`{{login.response.body.$.token}}`) is deferred.
  - Development happens on macOS. Windows installers come from GitHub Actions.
- Success for v1: you open a folder from any repo, browse its `.http` files in a tree, edit them in tabs, press Ctrl+Enter to run the request under the cursor, and inspect the response. Relaunching the app restores the same tabs.

## Architecture (Rust core)
```
crab/
  Cargo.toml                 # workspace: crates/crab-core, src-tauri
  crates/crab-core/          # pure Rust, no Tauri dependency → reused later by the CLI and MCP server
    src/parser/              # .http → Vec<RequestBlock> (with source spans)
    src/vars.rs              # {{var}} resolution: file vars + dynamic vars ($guid, $timestamp, $randomInt)
    src/exec.rs              # reqwest executor, timing, cancellation
    tests/fixtures/*.http
  src-tauri/                 # Tauri v2 shell: thin commands that call crab-core
    src/commands.rs, workspace.rs, session.rs, watcher.rs
  src/                       # React + TypeScript + Vite
    editor/http-language.ts  # CodeMirror 6 language and highlighting for .http
    editor/run-gutter.ts     # ▶ marker on each request line
    components/Sidebar, Tabs, ResponsePanel/*
    state/ (zustand stores: workspace, tabs, responses)
  .github/workflows/release.yml  # tauri-action → Windows MSI/NSIS (+ macOS/Linux artifacts)
```
Each unit has one job. The parser has no I/O. The executor only takes a resolved request and returns a response. Tauri commands are glue code. The UI never touches the network or filesystem directly.

## Components

**1. Parser (`crab-core::parser`)** — follows the JetBrains / VS Code REST Client format
- Requests are separated by `###` (optional name after it); `# @name foo` also names a request.
- Comments start with `#` or `//`. File variables use `@name = value`.
- Each request has a request line `METHOD URL [HTTP/x]` (method defaults to GET), then headers, then a blank line, then a body.
- A body line of `< ./path` includes a file. Multi-line query continuations (`  ?a=1` / `  &b=2`) are supported.
- Output: `RequestBlock { name, method, url, headers, body, span: {start_line, end_line} }`. The spans drive the run gutter and the "run request at cursor" action.
- Errors are tolerant: a malformed block produces a diagnostic and does not stop the other blocks from parsing.

**2. Variable resolver (`vars.rs`)** — resolves `{{x}}` in the URL, headers and body using file vars first, then dynamic vars. Unresolved variables are an error that lists their names. The resolver takes an `EnvProvider` trait so M2 can add environments without changing it.

**3. Executor (`exec.rs`)**
- Uses `reqwest` (rustls) with configurable timeout, redirect following and TLS verification.
- Returns `ResponseData { status, headers, body_bytes (capped e.g. 50 MB, flagged as truncated if larger), elapsed_total, ttfb, size, resolved_request }`.
- Cancellation: each run gets an id and a `tokio_util::CancellationToken`, which `cancel_request(id)` triggers.

**4. Tauri commands**
- `parse_file(path)`, `run_request(path, block_index, editor_text)` (the current buffer text, so unsaved edits run), `cancel_request(id)`.
- `read_file` / `write_file`, `workspace_get` / `workspace_set`, `session_get` / `session_set`.
- Event: `fs-changed` from a `notify` file watcher on the workspace roots.

**5. Workspace and session (persisted as JSON in the app data dir, e.g. `%APPDATA%\crab\`)**
- `workspace.json`: virtual folders (user-named groups), each holding root paths from any repo. The tree shows `*.http`/`*.rest` files only.
- `session.json`: open tabs, the active tab, cursor/scroll per tab, split sizes, and drafts of unsaved buffers so nothing is lost on crash. Session saves are debounced to every 1 s.
- Files remain the source of truth: Ctrl+S writes to disk. External changes reload clean tabs and prompt on dirty ones.

**6. UI (React + CodeMirror 6)**
- Layout: sidebar tree (virtual folders → files → requests); center editor tabs; response panel docked to the right (toggle to bottom), with resizable splits.
- Editor: .http highlighting, a ▶ gutter per request, Ctrl+Enter to run the request at the cursor, Esc to cancel.
- Response panel tabs:
  - **Body:** pretty-printed, foldable JSON (read-only CodeMirror); other types fall back to text, and images render inline.
  - **Raw**, **Headers**, **Timing** (total + TTFB + size), **Request** (exactly what was sent, resolved).
- Status bar: status code with color, time, size.
- Theme: light and dark following the OS.

## Data flow
Ctrl+Enter → the UI sends the buffer text and cursor line → `run_request` → the parser finds the block at that line → the resolver substitutes variables → the executor sends the request → `ResponseData` is returned → the zustand response store (keyed by tab + block) updates → the panel renders. Errors come back as typed `CrabError { kind: Parse | UnresolvedVars | Network | Timeout | Cancelled | Io, message }` and appear inline in the response panel.

## Testing
- `crab-core`: table-driven parser tests over fixture `.http` files (VS Code REST Client and JetBrains examples, plus edge cases); resolver unit tests; executor tests against `wiremock` (status, headers, body, redirects, timeout, cancellation).
- UI: `vitest` for stores and the "block at cursor" mapping.
- CI: `cargo test`, `cargo clippy`, `pnpm test` and `tauri build` on `windows-latest` (and macOS) per PR.

## v1 implementation order (each step is testable)
1. Initialize the repo: git init, MIT/Apache-2.0 license, README, Cargo workspace, `pnpm create tauri-app` (React-TS), CI skeleton.
2. `crab-core` parser + fixtures (TDD).
3. Variable resolver + dynamic vars (TDD).
4. Executor + wiremock tests, including cancellation.
5. Tauri commands + typed TS bindings (`src/api.ts`).
6. Workspace store + sidebar tree + file watcher.
7. Editor tabs + CodeMirror .http language + run gutter + save/dirty handling.
8. Response panel (Body/Raw/Headers/Timing/Request) + status bar.
9. Session restore (tabs, drafts, layout).
10. Release workflow → Windows installer artifact; smoke test on Windows.

## Verification
- `cargo test --workspace` and `pnpm test` pass.
- `pnpm tauri dev` on macOS:
  - Add a folder containing a sample `requests.http` (GET https://httpbin.org/get, a POST with a JSON body and `{{host}}` var, `{{$guid}}` header).
  - Run each request with ▶ and with Ctrl+Enter.
  - Check the Body/Headers/Timing/Request tabs. The Request tab should show resolved vars.
  - Cancel a request to `httpbin.org/delay/10`.
  - Quit and relaunch: tabs and unsaved drafts should be restored.
- Edit the file externally and confirm the tab reloads.
- The GitHub Actions `windows-latest` build produces an `.msi`/`.exe`. Install it on Windows and repeat the smoke test.

## Roadmap (after v1; this will become `ROADMAP.md` in the repo)
- **M2 — Environments and history:**
  - Support `http-client.env.json` + `http-client.private.env.json` and `.env`, with an env switcher per file or workspace.
  - Persistent history in SQLite (`rusqlite`): full-text search, re-run, and diff two responses.
  - Secrets stay out of tracked files.
- **M3 — Automation:**
  - `crab-cli` (`crab run file.http#name --env dev`) for CI.
  - Built-in MCP server (list, run, author requests). Agents see raw text with `{{placeholders}}` only, never resolved secrets or history.
- **M4 — Advanced .http:**
  - Request chaining (`{{login.response.body.$.token}}`, JSONPath/XPath).
  - JetBrains-style response handler scripts (`> {% %}`) and assertions/tests.
  - Multipart/form-data and file uploads, GraphQL requests.
  - Cookie jar, proxy settings, client certificates.
- **M5 — Productivity:**
  - Import from cURL, Postman and Insomnia; "copy as cURL"/code snippets.
  - Command palette and fuzzy search across workspaces.
  - Autocomplete for headers and variables.
  - Response search/filter (JSONPath) and saving responses to files.
- **M6 — Protocols and distribution:**
  - WebSocket/SSE/gRPC.
  - Auto-updater, code signing, winget/Homebrew/AUR packages, i18n.

## Process note
Once this design is approved, I'll save it as `docs/superpowers/specs/2026-10-07-crab-design.md` in the new repo, commit it, and write a step-by-step implementation plan (writing-plans) before any product code.
