import { expect, test, vi } from "vitest";
import { debounce } from "./debounce";

test("debounce calls once after the quiet period and can be cancelled", () => {
  vi.useFakeTimers();
  const fn = vi.fn();
  const d = debounce(fn, 100);
  d(); d(); d();
  vi.advanceTimersByTime(99);
  expect(fn).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(fn).toHaveBeenCalledTimes(1);
  d();
  d.cancel();
  vi.advanceTimersByTime(200);
  expect(fn).toHaveBeenCalledTimes(1);
  vi.useRealTimers();
});
