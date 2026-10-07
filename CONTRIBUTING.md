# Contributing to Crab

Thanks for helping! Bug reports, ideas and pull requests are all welcome.

## Before you start

- **Bugs:** open an issue using the bug report template. Include a minimal `.http` snippet that reproduces it.
- **Features:** check [ROADMAP.md](ROADMAP.md) first, then open a feature request so we can agree on the shape before you write code.
- **Security issues:** don't open a public issue. See [SECURITY.md](SECURITY.md).

## Development setup

See [Build from source](README.md#build-from-source) in the README. In short:

```bash
pnpm install
pnpm tauri dev
```

## Making a change

1. Fork the repo and create a branch from `main`.
2. Write a test that fails without your change.
   - Parser, resolver and executor logic lives in `crates/crab-core` and is tested with `cargo test`.
   - UI logic (stores, formatting, editor helpers) is tested with Vitest.
3. Keep `crates/crab-core` free of any Tauri dependency. It is shared with the planned CLI and MCP server.
4. Run the full check before pushing:

   ```bash
   pnpm build && pnpm test
   cargo clippy --workspace --all-targets -- -D warnings
   cargo test --workspace
   ```

5. Add a line under **Unreleased** in [CHANGELOG.md](CHANGELOG.md) if users will notice the change.
6. Open a pull request. CI runs the same checks on macOS and Windows.

## Conventions

- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/), for example `feat(core): …`, `fix(ui): …` or `docs: …`.
- Line numbers are 0-based everywhere in Rust and IPC payloads. CodeMirror is 1-based, so convert only at the editor boundary.
- IPC types use camelCase via `#[serde(rename_all = "camelCase")]` and must match `src/api.ts` exactly.
- If you add or upgrade a dependency, run `pnpm notices` to refresh `THIRD_PARTY_LICENSES.md`.

## License

By contributing, you agree that your contributions are dual-licensed under MIT OR Apache-2.0, the same as the project, without any additional terms or conditions.

Everyone taking part is expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
