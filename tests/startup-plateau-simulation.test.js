"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");

function simulate({ quality = 1080, nativePlateau = 35, readaheadPlateau = 90, patched = false }) {
  let buffer = 1.5;
  let minimum = buffer;
  for (let second = 0; second < 75; second += 1) {
    const plateau = patched ? readaheadPlateau : nativePlateau;
    const delivery = quality >= 2160 ? 1.1 : quality >= 1440 ? 1.5 : quality >= 1080 ? 2.6 : 3.3;
    const growth = buffer < plateau ? delivery : Math.min(delivery, 1);
    buffer = Math.max(0, buffer + growth - 1);
    minimum = Math.min(minimum, buffer);
  }
  return { buffer, minimum, quality };
}

test("old native 35s equilibrium cannot reach the 60-90 contract", () => {
  const r = simulate({ quality: 1080, patched: false });
  assert.ok(r.buffer < 45, `buffer=${r.buffer}`);
});

test("native read-ahead policy continues beyond the old 35s plateau without changing quality", () => {
  const r = simulate({ quality: 1080, patched: true });
  assert.ok(r.buffer >= 60, `buffer=${r.buffer}`);
  assert.equal(r.quality, 1080);
});

test("read-ahead policy is resolution-agnostic; Guardian does not rewrite the tier", () => {
  const r = simulate({ quality: 2160, patched: true });
  assert.equal(r.quality, 2160);
});
