import { expect, test } from "vitest";
import { basename, isHttpFile, isUnder, joinPath, samePath } from "./paths";

test("joinPath uses the root's separator", () => {
  expect(joinPath("C:\\repo", "api/a.http")).toBe("C:\\repo\\api\\a.http");
  expect(joinPath("/home/u/repo/", "a.http")).toBe("/home/u/repo/a.http");
});

test("samePath ignores separators, and case only for Windows drive paths", () => {
  expect(samePath("C:\\Repo\\a.http", "c:/repo/a.http")).toBe(true);
  expect(samePath("/a/B.http", "/a/b.http")).toBe(false);
});

test("basename, isUnder, isHttpFile", () => {
  expect(basename("C:\\repo\\api\\a.http")).toBe("a.http");
  expect(basename("/home/u/repo/")).toBe("repo");
  expect(isUnder("C:\\repo\\x\\a.http", "c:/repo")).toBe(true);
  expect(isUnder("/repo2/a.http", "/repo")).toBe(false);
  expect(isHttpFile("x/a.REST")).toBe(true);
  expect(isHttpFile("x/a.json")).toBe(false);
});
