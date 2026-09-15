"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const Core = require("../lib/core.js");

function runTrajectory(points, initialHeight = 1440) {
  let height = initialHeight;
  const actions = [];
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i];
    const d = Core.qualityDecision({
      nowMs: i * 1000, currentHeight: height, targetHeight: height,
      effectiveBuffer: p.buffer, bufferTrend: p.trend, playing: true,
      riskEvent: Boolean(p.risk), availableHeights: [720,1080,1440,2160]
    });
    if (d.action !== "hold") actions.push(d);
  }
  return { height, actions };
}

test("violent buffer sawtooth produces zero Guardian quality actions", () => {
  const r = runTrajectory([
    {buffer: 2, trend: -3, risk: true}, {buffer: 35, trend: 4},
    {buffer: 28, trend: -2}, {buffer: 82, trend: 5}, {buffer: 60, trend: -3}
  ]);
  assert.equal(r.actions.length, 0);
  assert.equal(r.height, 1440);
});

test("high buffer recovery does not cause Guardian to chase higher tiers", () => {
  const r = runTrajectory([{buffer: 65, trend: 1}, {buffer: 80, trend: 1}, {buffer: 95, trend: 0.2}], 720);
  assert.equal(r.actions.length, 0);
  assert.equal(r.height, 720);
});
