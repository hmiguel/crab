import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { readVersions, setVersion } from "./version.mjs";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "crab-version-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "crab", version: "0.1.0" }, null, 2) + "\n");
  writeFileSync(join(root, "Cargo.toml"), '[workspace]\nmembers = ["a"]\n\n[workspace.package]\nversion = "0.1.0"\nedition = "2021"\n\n[workspace.dependencies]\nfoo = { version = "1.2.3" }\n');
  mkdirSync(join(root, "src-tauri"));
  return root;
}

test("readVersions reports the version of every file that carries one", () => {
  expect(readVersions(fixture())).toEqual({ "package.json": "0.1.0", "Cargo.toml": "0.1.0" });
});

test("setVersion updates package.json and the workspace version only", () => {
  const root = fixture();
  setVersion(root, "0.2.0");
  expect(readVersions(root)).toEqual({ "package.json": "0.2.0", "Cargo.toml": "0.2.0" });
  expect(readFileSync(join(root, "Cargo.toml"), "utf8")).toContain('foo = { version = "1.2.3" }');
});

test("setVersion rejects something that is not semver", () => {
  expect(() => setVersion(fixture(), "v0.2")).toThrow(/semver/);
});
