# Crab Roadmap

v1: core .http runner + multi-repo workspace with tabs (see docs/superpowers/specs/2026-10-07-crab-design.md).

- **M3 — Automation:**
  - `crab-cli` (`crab run file.http#name --env dev`) for CI.
  - Built-in MCP server (list, run, author requests). Agents see raw text with `{{placeholders}}` only, never resolved secrets or history.
- **M4 — Advanced .http:**
  - Request chaining (`{{login.response.body.$.token}}`, JSONPath/XPath).
  - JetBrains-style response handler scripts (`> {% %}`) and assertions/tests.
  - Multipart/form-data and file uploads, GraphQL requests.
  - Cookie jar, proxy settings, client certificates.
- **M5 — Productivity:**
  - Diff two responses from history.
  - Import from cURL, Postman and Insomnia; "copy as cURL"/code snippets.
  - Autocomplete for headers and variables.
  - Response search/filter (JSONPath) and saving responses to files.
- **M6 — Protocols and distribution:**
  - WebSocket/SSE/gRPC.
  - Auto-updater, code signing, winget/Homebrew/AUR packages, i18n.

