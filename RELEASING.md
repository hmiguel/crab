# Releasing Crab

1. **Update the changelog.** Move the **Unreleased** entries in [CHANGELOG.md](CHANGELOG.md) under a new `## [X.Y.Z] - YYYY-MM-DD` heading and update the compare links at the bottom.
2. **Bump the version** everywhere at once:

   ```bash
   pnpm version:set X.Y.Z    # package.json and the Cargo workspace (Tauri reads it from Cargo)
   cargo check               # refreshes Cargo.lock
   pnpm version:check
   ```

3. **Refresh the license notices** if dependencies changed: `pnpm notices`.
4. **Commit and tag:**

   ```bash
   git commit -am "chore: release vX.Y.Z"
   git tag vX.Y.Z
   git push origin main vX.Y.Z
   ```

5. The **Release** workflow:
   - checks that the tag matches the version;
   - regenerates the third-party notices for each platform;
   - builds a universal macOS `.dmg` and the Windows `.msi`/`.exe`;
   - creates a GitHub release for the tag with them attached, as a draft while the builds run;
   - publishes the release once every platform has built (a tag with `-`, like `v0.2.0-beta.1`, is published as a **pre-release**).
6. If a build fails, the release stays a draft: fix the problem, delete the tag (`git push --delete origin vX.Y.Z && git tag -d vX.Y.Z`) and tag again.

**Betas:** use a pre-release version such as `0.2.0-beta.1` (tag `v0.2.0-beta.1`). The workflow marks the release as a pre-release and, because WiX rejects such versions, builds only the NSIS `-setup.exe` on Windows. The website's download button offers the newest stable release, or the newest beta while there is no stable one.

To build installers without a release, run the workflow manually with `gh workflow run Release`. The installers are attached to the run as artifacts.

## Code signing (not set up yet)

Builds are currently unsigned. To sign them later, add these repository secrets and pass them as `env` to `tauri-action` in `.github/workflows/release.yml`:

- **macOS** (needs an Apple Developer account):
  - `APPLE_CERTIFICATE` and `APPLE_CERTIFICATE_PASSWORD`: a base64-encoded `.p12` and its password.
  - `APPLE_SIGNING_IDENTITY`.
  - `APPLE_ID`, `APPLE_PASSWORD` (an app-specific password) and `APPLE_TEAM_ID`, for notarization.
- **Windows:** a code-signing certificate configured through `bundle.windows` in `src-tauri/tauri.conf.json`. See the [Tauri signing guide](https://v2.tauri.app/distribute/sign/windows/).
