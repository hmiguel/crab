# Crab

An open-source, cross-platform API client for plain `.http` / `.rest` files. Your requests stay as files in your repos.

- Workspace of virtual folders spanning any number of repositories
- Tabs with session restore (including unsaved drafts)
- Run the request under the cursor with **Ctrl+Enter** or the ▶ gutter
- Response viewer: pretty JSON, raw, headers, timing and the exact resolved request

## Download

Grab the latest Windows installer (`.msi` or `-setup.exe`) or macOS `.dmg` from the [Releases](../../releases) page. Builds are currently unsigned, so Windows SmartScreen will ask you to confirm ("More info → Run anyway").

See [ROADMAP.md](ROADMAP.md) for what comes next.

## Development

Requirements: Rust (stable), Node ≥ 20, pnpm 10. On Windows also the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) (WebView2 + MSVC build tools).

```bash
pnpm install
pnpm tauri dev        # run the app
pnpm build            # build the frontend (required once before `cargo test`/`cargo build`)
pnpm test             # frontend unit tests
cargo test --workspace
```

## License

Dual-licensed under MIT or Apache-2.0, at your option.
