import { expect, test } from "vitest";
import { renderNotices } from "./third-party-licenses.mjs";

const MIT = "MIT License\n\nPermission is hereby granted...";

test("packages sharing an identical license text are listed under one copy of it", () => {
  const md = renderNotices([
    { ecosystem: "Rust", name: "serde", version: "1.0.0", license: "MIT OR Apache-2.0", texts: [MIT] },
    { ecosystem: "npm", name: "react", version: "19.0.0", license: "MIT", texts: [MIT] },
    { ecosystem: "npm", name: "zustand", version: "5.0.0", license: "MIT", texts: ["MIT License\n\nCopyright (c) Paul"] },
  ]);
  expect(md.match(/Permission is hereby granted/g)).toHaveLength(1);
  expect(md).toContain("- react 19.0.0 (npm, MIT)");
  expect(md).toContain("- serde 1.0.0 (Rust, MIT OR Apache-2.0)");
  expect(md).toContain("Copyright (c) Paul");
  expect(md.indexOf("react 19.0.0")).toBeLessThan(md.indexOf("serde 1.0.0"));
});

test("a package without a license file is still listed with its SPDX id", () => {
  const md = renderNotices([{ ecosystem: "Rust", name: "tiny", version: "0.1.0", license: "MIT", texts: [] }]);
  expect(md).toContain("- tiny 0.1.0 (Rust, MIT)");
  expect(md).toContain("No license file was shipped with these packages");
});

test("license texts that differ only in whitespace are printed once", () => {
  const md = renderNotices([
    { ecosystem: "Rust", name: "a", version: "1.0.0", license: "Apache-2.0", texts: ["Apache License\n   Version 2.0"] },
    { ecosystem: "Rust", name: "b", version: "1.0.0", license: "Apache-2.0", texts: ["Apache License\n\tVersion 2.0\n\n"] },
  ]);
  expect(md.match(/Apache License/g)).toHaveLength(1);
});
