import test from "node:test";
import assert from "node:assert/strict";
import { countNoun } from "@/lib/count-label";

test("Russian story counters agree with ones, teens and compound numbers", () => {
  for (const count of [1, 21, 101]) assert.equal(countNoun(count, "история", "истории", "историй"), "история");
  for (const count of [2, 3, 4, 22, 104]) assert.equal(countNoun(count, "история", "истории", "историй"), "истории");
  for (const count of [0, 5, 11, 12, 14, 25, 111]) assert.equal(countNoun(count, "история", "истории", "историй"), "историй");
});
