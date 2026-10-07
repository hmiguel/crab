// Keeps the app version in sync across package.json and the Cargo workspace
// (tauri.conf.json has no version, so Tauri takes it from Cargo).
//
//   node scripts/version.mjs              print the versions
//   node scripts/version.mjs check [X]    fail unless every file agrees (and equals X, if given)
//   node scripts/version.mjs set X        write X everywhere
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
const CARGO_VERSION = /(\[workspace\.package\][^[]*?\nversion\s*=\s*")([^"]+)(")/;

export function readVersions(root) {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const cargo = readFileSync(join(root, "Cargo.toml"), "utf8").match(CARGO_VERSION);
  return { "package.json": pkg.version, "Cargo.toml": cargo ? cargo[2] : null };
}

export function setVersion(root, version) {
  if (!SEMVER.test(version)) throw new Error(`"${version}" is not semver (expected e.g. 1.2.3)`);
  const pkgPath = join(root, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  pkg.version = version;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  const cargoPath = join(root, "Cargo.toml");
  const cargo = readFileSync(cargoPath, "utf8");
  if (!CARGO_VERSION.test(cargo)) throw new Error("Cargo.toml has no [workspace.package] version");
  writeFileSync(cargoPath, cargo.replace(CARGO_VERSION, `$1${version}$3`));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(fileURLToPath(import.meta.url), "../..");
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === "set") {
    setVersion(root, arg ?? "");
    console.log(`Version set to ${arg}. Run cargo check to refresh Cargo.lock.`);
  } else {
    const versions = readVersions(root);
    console.log(versions);
    const values = new Set(Object.values(versions));
    const expected = arg?.replace(/^v/, "");
    if (cmd === "check" && (values.size !== 1 || (expected && !values.has(expected)))) {
      console.error(`Version mismatch${expected ? ` (expected ${expected})` : ""}`);
      process.exit(1);
    }
  }
}
