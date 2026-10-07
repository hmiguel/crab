# Security policy

## Supported versions

Only the latest release receives security fixes.

## Reporting a vulnerability

Please **do not** open a public issue. Report it privately through GitHub instead:
[**Report a vulnerability**](https://github.com/hmiguel/crab/security/advisories/new).

Include the affected version, your OS, steps to reproduce and the impact you expect. You should get a reply within a week. Once a fix is released, we'll credit you in the advisory unless you'd rather stay anonymous.

## Scope

Crab runs requests you write and reads and writes only the files you open, plus its own state in the app data folder. Issues of particular interest:
- A response, file or workspace that can run code in the app or read files outside what you opened.
- Secrets leaking into places they shouldn't, such as logs or state files.
- A TLS verification bypass.
