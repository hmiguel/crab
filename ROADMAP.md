# Crab Roadmap

v1: core .http runner + multi-repo workspace with tabs (see docs/superpowers/specs/2026-10-07-crab-design.md).

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

