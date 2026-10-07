// Points the hero download button at the right installer from the newest GitHub release
// (stable if there is one, otherwise the newest beta).
// Without JS, or if the API call fails, the button keeps linking to the releases page.

const RULES = [
  { os: /Mac/, file: /\.dmg$/, label: "Download for macOS", note: "Apple Silicon & Intel" },
  { os: /Windows/, file: /-setup\.exe$/, label: "Download for Windows", note: "64-bit installer" },
];

export function pickDownload(assets, userAgent, tag) {
  const rule = RULES.find((r) => r.os.test(userAgent));
  const asset = rule && assets.find((a) => rule.file.test(a.name));
  if (!asset) return null;
  return { url: asset.browser_download_url, label: rule.label, note: `${tag} · ${rule.note}` };
}

/** Releases come newest first from the API. */
export function pickRelease(releases) {
  const published = releases.filter((r) => !r.draft);
  return published.find((r) => !r.prerelease) ?? published[0] ?? null;
}

async function wireButton() {
  const button = document.getElementById("download");
  const note = document.getElementById("download-note");
  if (!button) return;
  try {
    const res = await fetch("https://api.github.com/repos/hmiguel/crab/releases?per_page=20", {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) return;
    const release = pickRelease(await res.json());
    if (!release) return;
    const pick = pickDownload(release.assets ?? [], navigator.userAgent, release.tag_name);
    if (!pick) return;
    button.href = pick.url;
    button.textContent = pick.label;
    if (note) note.textContent = `${pick.note} · MIT OR Apache-2.0`;
  } catch {
    // offline or rate-limited: keep the releases-page link
  }
}

if (typeof document !== "undefined") void wireButton();
