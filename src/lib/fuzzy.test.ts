import { expect, test } from "vitest";
import { fuzzyScore, rankItems } from "./fuzzy";

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
  const ranked = rankItems("users", items, (i) => [i.label, i.file], (i) => i.label);
  expect(ranked.map((i) => i.label)).toEqual(["users", "List users"]);
  expect(rankItems("", items, (i) => [i.label], (i) => i.label, 2)).toHaveLength(2);
});
