import { expect, test } from "vitest";
import { buildTree } from "./tree";

test("builds a sorted tree with folders first", () => {
  expect(buildTree(["b.http", "api/users.http", "api/admin/x.http", "a.http"])).toEqual([
    {
      name: "api",
      rel: "api",
      children: [
        { name: "admin", rel: "api/admin", children: [{ name: "x.http", rel: "api/admin/x.http", children: null }] },
        { name: "users.http", rel: "api/users.http", children: null },
      ],
    },
    { name: "a.http", rel: "a.http", children: null },
    { name: "b.http", rel: "b.http", children: null },
  ]);
});
