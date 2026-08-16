import assert from "node:assert/strict";
import test from "node:test";

import { mergeModelHistory } from "./model-history.ts";

test("matches historical models by stable id across slug changes", () => {
  const previous = {
    id: "stable-id",
    slug: "old-slug",
    value: "historical",
  };
  const fresh = {
    id: "stable-id",
    slug: "new-slug",
    value: "fresh",
  };

  const result = mergeModelHistory([fresh], [previous]);

  assert.deepEqual(result.models, [fresh]);
  assert.equal(result.retainedCount, 0);
});

test("merges matched history and retains genuinely missing models", () => {
  const previous = [
    { id: "same", slug: "same", current: null, historical: 42 },
    { id: "removed", slug: "removed", current: null, historical: 7 },
  ];
  const fresh = [{ id: "same", slug: "same", current: 10, historical: null }];

  const result = mergeModelHistory(
    fresh,
    previous,
    (current, historical) => ({
      ...current,
      historical: current.historical ?? historical.historical,
    }),
  );

  assert.deepEqual(result.models, [
    { id: "same", slug: "same", current: 10, historical: 42 },
    previous[1],
  ]);
  assert.equal(result.retainedCount, 1);
});

test("folds data from every historical duplicate into the surviving model", () => {
  const previous = [
    { id: "same", slug: "old-a", math: 88, coding: null },
    { id: "same", slug: "old-b", math: null, coding: 73 },
  ];
  const fresh = [{ id: "same", slug: "canonical", math: null, coding: null }];

  const result = mergeModelHistory(
    fresh,
    previous,
    (current, historical) => ({
      ...current,
      math: current.math ?? historical.math,
      coding: current.coding ?? historical.coding,
    }),
  );

  assert.deepEqual(result.models, [
    { id: "same", slug: "canonical", math: 88, coding: 73 },
  ]);
  assert.equal(result.retainedCount, 0);
});
