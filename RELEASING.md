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
   - creates a **draft** GitHub release with them attached.
6. Test the installers, then publish the draft on GitHub.

To build installers without a release, run the workflow manually with `gh workflow run Release`. The installers are attached to the run as artifacts.

## Code signing (not set up yet)

Builds are currently unsigned. To sign them later, add these repository secrets and pass them as `env` to `tauri-action` in `.github/workflows/release.yml`:

- **macOS** (needs an Apple Developer account):
  - `APPLE_CERTIFICATE` and `APPLE_CERTIFICATE_PASSWORD`: a base64-encoded `.p12` and its password.
  - `APPLE_SIGNING_IDENTITY`.
  - `APPLE_ID`, `APPLE_PASSWORD` (an app-specific password) and `APPLE_TEAM_ID`, for notarization.
- **Windows:** a code-signing certificate configured through `bundle.windows` in `src-tauri/tauri.conf.json`. See the [Tauri signing guide](https://v2.tauri.app/distribute/sign/windows/).
