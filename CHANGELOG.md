# Changelog

All notable changes to Crab are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Request history: every sent request is saved with its response (last 1,000 runs) and is searchable from the History tab and ⌘P. The response panel lists earlier runs of the current request, and past runs open read-only. Requests are stored masked.
- Quick open (<kbd>⌘P</kbd> / <kbd>Ctrl</kbd><kbd>P</kbd>, or ⌕ in the sidebar): fuzzy-search every file and request in the workspace by name, URL or path, or find text inside headers and bodies, and jump straight to it.
- Environments from `crab.env.json` / `crab.private.env.json` (the JetBrains `http-client.env.json` names work too) and `.env`, picked in the status bar. Each environment can have a colour, red environments ask before sending changes, and private values are masked in the Request tab.

## [0.1.0-beta.1] - 2026-10-07

First public beta.

### Added
- `.http` / `.rest` parser compatible with the JetBrains HTTP Client and VS Code REST Client formats:
  - `###` separators, `# @name`, comments, multi-line query strings, headers and bodies.
  - `< file` bodies.
  - JetBrains response handlers are skipped and never sent.
- Variables: `@name = value` file variables, nested references, `{{$guid}}`, `{{$uuid}}`, `{{$timestamp}}` and `{{$randomInt}}`. Circular references produce an error.
- Requests run with timing (total, time to first byte), a redirect limit, a 30 s timeout, a 50 MB body cap and cancellation (<kbd>Esc</kbd>).
- Workspace of virtual folders spanning several repositories, with a live file tree.
- Editor tabs with `.http` highlighting, ▶ run markers, inline warnings and session restore, including unsaved drafts.
- Response panel: pretty JSON (big integers preserved), raw, headers, timing, the resolved request, and inline images.
- macOS menu: <kbd>⌘W</kbd> closes the tab and <kbd>⌘Q</kbd> saves the session before quitting.
- Windows line endings and a UTF-8 BOM are preserved on save.
- Sand and coral light and dark themes, following the OS.
- The Workspace sidebar follows the editor: it reveals the open file and highlights the request under the cursor.
- Installers for macOS (universal `.dmg`) and Windows (NSIS `-setup.exe`; the `.msi` comes with stable releases).

[Unreleased]: https://github.com/hmiguel/crab/compare/v0.1.0-beta.1...HEAD
[0.1.0-beta.1]: https://github.com/hmiguel/crab/releases/tag/v0.1.0-beta.1
