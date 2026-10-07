# crab website

A static landing page with no build step. Cloudflare Pages deploys this folder from `main`.

- Preview locally with `python3 -m http.server -d website 8080`, then open <http://localhost:8080>.
- `download.js` points the download button at the right installer from the latest GitHub release. Its tests live in `scripts/website-download.test.mjs`.
- `_headers` sets the security headers on Cloudflare Pages.

## Cloudflare Pages settings

| Setting | Value |
|---|---|
| Production branch | `main` |
| Framework preset | None |
| Build command | *(empty)* |
| Build output directory | `website` |
