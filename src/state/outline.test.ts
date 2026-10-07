import { beforeEach, describe, expect, it } from "vitest";
import type { RequestBlock } from "../api";
import { useOutline } from "./outline";

const req: RequestBlock = {
  name: "a", method: "GET", url: "http://x", headers: [], body: null, span: { startLine: 0, endLine: 1 }, requestLine: 0,
};

describe("outline store", () => {
  beforeEach(() => useOutline.setState({ byPath: {} }));

  it("stores the live request list of an open file and finds it by any spelling of the path", () => {
    useOutline.getState().set("C:\\Repo\\a.http", [req]);
    expect(useOutline.getState().get("c:/repo/a.http")).toEqual([req]);
  });

  it("returns undefined for files it has not seen", () => {
    expect(useOutline.getState().get("/nope.http")).toBeUndefined();
  });

  it("forgets a file", () => {
    useOutline.getState().set("/a.http", [req]);
    useOutline.getState().forget("/a.http");
    expect(useOutline.getState().get("/a.http")).toBeUndefined();
  });
});
