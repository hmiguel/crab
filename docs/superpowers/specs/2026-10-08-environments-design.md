# Environments — Design

## Context
Crab can't switch between dev, staging and prod today. Requests only see `@var` file variables, and `run_request` passes the `NoEnv` placeholder (`src-tauri/src/commands.rs:34`). Environments are part of milestone M2 in `ROADMAP.md`.

**Agreed brief**
- **What you said:**
  - Support JetBrains `http-client.env.json` + `http-client.private.env.json` and `.env`.
  - One environment is selected for the whole workspace.
  - Each environment can have a colour and a visible indicator, which matters most for production.
  - A confirmation before sending changes to production, with a setting to turn it off.
  - Secrets are masked, with a click to reveal.
- **Assumptions:**
  - Env files stay compatible with the JetBrains and VS Code clients, so Crab-only settings (colours, the confirmation setting) live in Crab's workspace state, never in the repo.
  - Request chaining and `{{$processEnv}}` are out of scope.
- **Success:**
  - Pick `prod` in the status bar, and `{{host}}` resolves to the prod value.
  - The window shows a red bar.
  - A POST asks for confirmation first.
  - Tokens from the private file show as `••••••` in the Request tab and in history.

## 1. Engine (`crates/crab-core`)

### Discovery: `src/env.rs` (new)
- `EnvFiles::discover(http_file: &Path, root: &Path) -> EnvFiles`
  - Walks up from the `.http` file's folder to `root`, inclusive, and takes the **nearest** `http-client.env.json`, `http-client.private.env.json` and `.env`. The three are found independently.
  - It never goes above `root`. If the file isn't under `root`, only the file's own folder is checked.
- `EnvFiles::names(&self) -> Vec<String>` returns the top-level keys of the public and private files, except `$shared`, merged and sorted.
- `find_env_names(root) -> Vec<String>` walks `root` like `find_http_files` (`src/files.rs:19`), with the same skipped folders, and merges `names()` from every `http-client.env.json` / `http-client.private.env.json` it finds.

### Lookup: `FileEnv`
- `FileEnv { name: Option<String>, files: EnvFiles }` implements `EnvProvider`.
- The trait changes to `fn get(&self, name: &str) -> Option<EnvValue>`, where `EnvValue { value: String, secret: bool }`. `NoEnv` is updated to match.
- Lookup order for `{{x}}`. File variables still come first, inside `Resolver`.
  1. `private[env][x]` (secret)
  2. `public[env][x]`
  3. `private["$shared"][x]` (secret)
  4. `public["$shared"][x]`
  5. `.env` `x`
- With no environment selected, steps 1–2 are skipped and `$shared` and `.env` still apply.
- JSON strings are used as-is. Numbers and booleans become their JSON text. `null`, objects and arrays are **skipped**, so JetBrains-only settings such as `"Security": {"Auth": …}` don't break the file. Referencing a skipped key gives the normal `unresolvedVars` error.
- A UTF-8 BOM at the start of an env file is ignored.
- `{{$dotenv NAME}}` reads `.env` only. If the name is missing, it produces `unresolvedVars`.

### `.env` parser
- One `KEY=VALUE` per line. Blank lines and lines starting with `#` are skipped, and an optional `export ` prefix is allowed.
- Values may be wrapped in `'…'` or `"…"`, and only the double-quoted form unescapes `\n` and `\"`. An inline ` #` comment after an unquoted value is stripped.
- Malformed lines are ignored, with no error.

### Masking
- `Resolver` records the value of every secret substitution.
- `ResolvedRequest` gains `#[serde(skip)] secrets: Vec<String>`.
- `ResolvedRequest::masked(&self) -> ResolvedRequest` replaces every occurrence of each secret of **4 or more characters** in the URL, header values and body with `••••••`. Shorter secrets are left visible, so a value like `1` doesn't mask every `1`.
- The request is resolved only once, so dynamic values (`$guid`, `$timestamp`) are the same in the sent request and the masked copy.

### Errors
- `ErrorKind::Env` is new. Its message is `<file>: <reason>`, for example invalid JSON with its line and column, or an unsupported value type.
- `unresolvedVars` messages add ` (environment: <name>)` when an environment is selected.

### Tests (`crates/crab-core/tests/env.rs`, using `tempfile`)
- Discovery: the nearest file wins, the walk stops at the root, the three files are found independently, and a file outside the root only checks its own folder.
- Lookup order, all five steps.
- `$shared` applies with no environment selected.
- Value conversion, skipped objects and arrays, and a file with a BOM.
- `.env` parsing: comments, `export`, quotes, escapes, inline comments, malformed lines.
- `$dotenv`.
- `masked()`: secrets in the URL, headers and body. Short secrets stay visible. A `$guid` is the same in both copies.
- A wiremock test: running with `FileEnv` sends the env value, and the response carries the masked request.

## 2. Commands and app state

### Tauri (`src-tauri/src/commands.rs`)
- `list_environments(roots: Vec<String>) -> Vec<String>`: the sorted union of `find_env_names` over all roots.
- `run_request(run_id, path, text, line, env: Option<String>, root: Option<String>)`:
  - Builds `FileEnv` from `EnvFiles::discover(path, root)`. With no `path` (an unsaved file), it uses `NoEnv`.
  - Env files are read fresh on every run, so there's no cache to clear.
  - `runAt` passes `root` as the workspace root that contains the file (`allRoots().find((r) => isUnder(path, r))`), and passes `null` when there isn't one.
- `ResponseData.request` is now the **masked** request. `ResponseData` also gains `has_secrets: bool` and `env: Option<String>`, the environment the run used, so the Request tab shows the right one even after the selection changes.
- `AppState` keeps the real resolved request for the last 20 runs, in memory only. `reveal_request(run_id) -> Option<ResolvedRequest>` returns it.

### `src/state/environments.ts` (new)
- State: `names: string[]`, `selected: string | null`, `colors: Record<string, EnvColor>`, `confirmDanger: boolean` (default `true`). `EnvColor = "none" | "green" | "blue" | "amber" | "red"`.
- Saved in the workspace state file as an optional `environments: { selected, colors, confirmDanger }` field. The version stays `1`, and older files load with the defaults.
- `colorOf(name)` returns the explicit colour when set, otherwise `"red"` when the name matches `/prod|production|live/i`, otherwise `"none"`.
- `isDanger(name)` is true when `colorOf(name) === "red"`.
- `refresh()` calls `list_environments(allRoots())`. It runs on workspace load, when roots are added or removed, and on env-file changes.
- If the selected environment no longer exists, the selection stays, so it comes back when the file does. The status bar shows it with a "not found" mark.

### File watching
In `src/state/fs-events.ts`, `isIrrelevant` keeps `http-client.env.json`, `http-client.private.env.json` and `.env` paths. A change to any of them calls `useEnvironments.getState().refresh()`, debounced together with the root rescans.

### Production check
In `runAt` (`src/state/run.ts`), before calling the backend:
1. Find the request's method with `requestIndexAt` on the tab's outline (`src/lib/outline.ts`, `src/state/outline.ts`).
2. If an environment is selected, `isDanger` is true, `confirmDanger` is on, and the method isn't `GET`, `HEAD` or `OPTIONS`:
   - Show `ask("Send <METHOD> <url> to <env>?", { kind: "warning", okLabel: "Send", cancelLabel: "Cancel" })` from `@tauri-apps/plugin-dialog`.
   - Cancel returns without starting a run.

### Tests (vitest)
- `environments.test.ts`: saving and loading, defaults for older files, `colorOf` and `isDanger` with and without an explicit colour, and `refresh`.
- `run.test.ts`: the check asks for a POST to `prod`, skips GETs, is skipped when `confirmDanger` is off or no environment is selected, and Cancel doesn't call `runRequest`.
- `fs-events.test.ts`: changing an env file calls `refresh`.

## 3. UI

### Status bar environment menu (`src/components/EnvMenu.tsx`, new)
- Placed in `StatusBar.tsx`, before the "Response: …" button. The button shows `●` in the environment's colour and its name, or `No environment` in grey.
- The menu contains:
  - the environment names, with a check mark next to the selected one,
  - `No environment`,
  - a separator, then `Colour of <selected>`, a row of five swatches (none, green, blue, amber, red), shown only when an environment is selected,
  - a separator, then a check box: `Confirm before sending changes to red environments`.
- With an empty list, the menu says `No http-client.env.json found in the workspace. See "Environments" in the README.` The app has no plugin for opening links in the browser, so this is plain text, not a link.

### Making the environment visible (`src/components/EnvAccent.tsx`, new)
- Sets `--env-color` on `.app`, using `transparent` for `none` or no environment.
- A 3px bar across the top of `.app` in `--env-color`.
- Red environments also get a faint red tint on the status bar background, so the warning doesn't depend on colour alone.
- The ▶ run markers (`src/editor/run-gutter.ts` styles) use `var(--env-color, var(--accent))`.

### Request tab (`src/components/ResponsePanel.tsx`)
- A header line: `Environment: ● <name>`, taken from `ResponseData.env`.
- When `hasSecrets` is true, a `Reveal secrets` button calls `reveal_request`. The view goes back to masked when the tab or the response changes.

### Colours (`src/styles.css`)
`--env-green: var(--ok)`, `--env-blue: var(--redirect)`, `--env-amber: var(--client-error)`, `--env-red: var(--server-error)`. All four already have light and dark values.

## 4. Docs
- README:
  - a feature line,
  - an **Environments** section: file names, lookup order, `$shared`, `.env` / `$dotenv`, colours, the production check, and adding `http-client.private.env.json` to `.gitignore`.
- CHANGELOG under Unreleased. Run `pnpm site:llms` afterwards.
- `ROADMAP.md`: remove the environments item from M2.

## Out of scope
- An environment per file or per repo.
- Editing env files from a Crab UI.
- `{{$processEnv}}`, and the JetBrains `X-` auth / client-certificate env options.
- A per-session "don't ask again" option for the production check.

## Verification
- `cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace`
- `pnpm build && pnpm test`
- Manual checks in `pnpm tauri dev`, with a repo that has `http-client.env.json` (`dev`, `prod`), a private file holding a `token`, and a `.env`:
  1. Switch dev → prod. The bar, the dot and the ▶ markers change colour. The Request tab shows the prod host.
  2. A POST to prod asks first, and a GET doesn't. Turning the check off stops the prompt.
  3. `Authorization: Bearer {{token}}` shows `••••••`, and Reveal shows the real token.
  4. Edit the env file, and the next run uses the new value without a restart.
  5. Restart Crab. The selected environment and its colour are kept.
