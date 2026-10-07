import { expect, test } from "vitest";
import { pickDownload, pickRelease } from "../website/download.js";

const assets = [
  { name: "Crab_0.1.0_universal.dmg", browser_download_url: "https://x/dmg" },
  { name: "Crab_0.1.0_x64_en-US.msi", browser_download_url: "https://x/msi" },
  { name: "Crab_0.1.0_x64-setup.exe", browser_download_url: "https://x/exe" },
  { name: "Crab_universal.app.tar.gz", browser_download_url: "https://x/tgz" },
];
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15";
const WIN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
const LINUX = "Mozilla/5.0 (X11; Linux x86_64)";

test("macOS visitors get the .dmg", () => {
  expect(pickDownload(assets, MAC, "v0.1.0")).toEqual({ url: "https://x/dmg", label: "Download for macOS", note: "v0.1.0 · Apple Silicon & Intel" });
});

test("Windows visitors get the setup .exe", () => {
  expect(pickDownload(assets, WIN, "v0.1.0")).toEqual({ url: "https://x/exe", label: "Download for Windows", note: "v0.1.0 · 64-bit installer" });
});

test("other platforms, or a release without a matching asset, get null", () => {
  expect(pickDownload(assets, LINUX, "v0.1.0")).toBeNull();
  expect(pickDownload([], MAC, "v0.1.0")).toBeNull();
});

test("pickRelease prefers the newest stable release, then the newest pre-release, never a draft", () => {
  const beta = { tag_name: "v0.2.0-beta.1", draft: false, prerelease: true };
  const stable = { tag_name: "v0.1.0", draft: false, prerelease: false };
  const draft = { tag_name: "v0.3.0", draft: true, prerelease: false };
  expect(pickRelease([draft, beta, stable])).toBe(stable);
  expect(pickRelease([draft, beta])).toBe(beta);
  expect(pickRelease([draft])).toBeNull();
  expect(pickRelease([])).toBeNull();
});
