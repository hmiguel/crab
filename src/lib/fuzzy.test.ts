import { expect, test } from "vitest";
import { containsScore, fuzzyScore, rankItems, snippet } from "./fuzzy";

test("matches a case-insensitive subsequence and rejects the rest", () => {
  expect(fuzzyScore("usr", "Users.http")).not.toBeNull();
  expect(fuzzyScore("USERS", "users.http")).not.toBeNull();
  expect(fuzzyScore("xyz", "users.http")).toBeNull();
  expect(fuzzyScore("sru", "users")).toBeNull();
});

test("an empty query matches everything with score 0", () => {
  expect(fuzzyScore("", "anything")).toBe(0);
});

test("consecutive matches beat scattered ones", () => {
  expect(fuzzyScore("user", "user-list")!).toBeGreaterThan(fuzzyScore("user", "u-s-e-r")!);
});

test("word-boundary and camelCase matches beat mid-word ones", () => {
  expect(fuzzyScore("cu", "create-user")!).toBeGreaterThan(fuzzyScore("cu", "acutely")!);
  expect(fuzzyScore("cu", "createUser")!).toBeGreaterThan(fuzzyScore("cu", "acutely")!);
});

test("earlier matches beat later ones", () => {
  expect(fuzzyScore("api", "api/users")!).toBeGreaterThan(fuzzyScore("api", "old/api")!);
});

test("rankItems scores by best field, drops misses, breaks ties by shorter label and caps results", () => {
  const items = [
    { label: "Delete order", file: "orders.http" },
    { label: "List users", file: "api/users.http" },
    { label: "users", file: "x.http" },
    { label: "nothing", file: "nope.http" },
  ];
  const opts = { fields: (i: (typeof items)[number]) => [i.label, i.file], label: (i: (typeof items)[number]) => i.label };
  expect(rankItems("users", items, opts).map((r) => r.item.label)).toEqual(["users", "List users"]);
  expect(rankItems("", items, { ...opts, limit: 2 })).toHaveLength(2);
});

test("containsScore is a case-insensitive substring match for 3+ characters", () => {
  expect(containsScore("auth", "Authorization: Bearer x")).not.toBeNull();
  expect(containsScore("ath", "Authorization")).toBeNull();
  expect(containsScore("ab", "abc")).toBeNull();
});

test("content-only matches rank below every name match and are flagged", () => {
  const items = [
    { label: "Get order", content: "X-Customer-Id: 42" },
    { label: "Customer list", content: "" },
  ];
  const ranked = rankItems("customer", items, { fields: (i) => [i.label], label: (i) => i.label, content: (i) => i.content });
  expect(ranked).toEqual([
    { item: items[1], viaContent: false },
    { item: items[0], viaContent: true },
  ]);
});

test("snippet returns the matching line, trimmed around the match", () => {
  expect(snippet("token", "Accept: */*\nAuthorization: Bearer {{token}}")).toBe("Authorization: Bearer {{token}}");
  const long = "x".repeat(100) + "needle" + "y".repeat(100);
  const s = snippet("needle", long);
  expect(s).toContain("needle");
  expect(s.length).toBeLessThanOrEqual(82);
  expect(s.startsWith("…") && s.endsWith("…")).toBe(true);
});
