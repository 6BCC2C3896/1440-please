"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const Network = require("../lib/network-core.js");

test("googlevideo classifier recognizes classic videoplayback", () => {
  const c = Network.classifyUrl("https://rr1---sn-test.googlevideo.com/videoplayback?itag=248&source=youtube&cpn=ABC123&range=0-999");
  assert.equal(c.kind, "media");
  assert.equal(c.cpn, "ABC123");
  assert.equal(c.origin, "https://rr1---sn-test.googlevideo.com");
  assert.ok(c.confidence >= 0.9);
});

test("googlevideo classifier recognizes live/post-live videoplayback path variants", () => {
  const c = Network.classifyUrl("https://rr2---sn-test.googlevideo.com/videoplayback/sabr/segment?expire=1&source=youtube");
  assert.equal(c.kind, "media");
});

test("our generate_204 pulse is never counted as media", () => {
  const c = Network.classifyUrl("https://rr1---sn-test.googlevideo.com/generate_204?conn2&ytbg=3.1.token");
  assert.equal(c.kind, "pulse");
});

test("UMP response header confirms SABR media", () => {
  const urlClass = Network.classifyUrl("https://rr1---sn-test.googlevideo.com/videoplayback?sabr=1&source=youtube");
  const r = Network.classifyResponse([{ name: "Content-Type", value: "application/vnd.yt-ump; charset=binary" }], urlClass);
  assert.equal(r.kind, "media");
  assert.equal(r.mediaKind, "sabr-ump");
  assert.equal(r.confidence, 1);
});

test("video/audio response content types confirm media", () => {
  const c = Network.classifyUrl("https://rr1---sn-test.googlevideo.com/foo?ump=1");
  assert.equal(Network.classifyResponse([{ name: "content-type", value: "video/webm" }], c).kind, "media");
  assert.equal(Network.classifyResponse([{ name: "content-type", value: "audio/mp4" }], c).kind, "media");
});

test("unrelated googlevideo request is not promoted to media or CDN truth", () => {
  const c = Network.classifyUrl("https://rr1---sn-test.googlevideo.com/some-control-endpoint?x=1");
  assert.equal(c.kind, "unknown");
  assert.equal(c.confidence, 0);
});

test("CPN resolves tabId=-1 request ownership", () => {
  const request = Network.classifyUrl("https://rr1---sn-test.googlevideo.com/videoplayback?source=youtube&cpn=CPN_X");
  const owner = Network.resolveOwner({ tabId: -1 }, request, [
    { tabId: 4, playback: { playing: true, cpn: "OTHER" } },
    { tabId: 9, playback: { playing: true, cpn: "CPN_X" } }
  ]);
  assert.equal(owner.tabId, 9);
  assert.equal(owner.method, "cpn");
});

test("single-playing fallback only applies to high-confidence media", () => {
  const media = Network.classifyUrl("https://rr1---sn-test.googlevideo.com/videoplayback?source=youtube");
  const unknown = Network.classifyUrl("https://rr1---sn-test.googlevideo.com/foo");
  const sessions = [{ tabId: 7, playback: { playing: true } }];
  assert.equal(Network.resolveOwner({ tabId: -1 }, media, sessions).tabId, 7);
  assert.equal(Network.resolveOwner({ tabId: -1 }, unknown, sessions).tabId, null);
});

test("transport and media health are separate", () => {
  assert.equal(Network.transportHealth({ hasOrigin: true, mediaAgeMs: 20000, deliveryAgeMs: 20000, pulseAgeMs: 1000, pulseRttMs: 35 }, {}), "warm");
  assert.equal(Network.mediaHealth({ mediaAgeMs: Infinity, deliveryAgeMs: Infinity, bufferAhead: 12 }, {}), "buffer-observed");
});

test("fresh in-flight SABR request remains media-active", () => {
  assert.equal(Network.transportHealth({ hasOrigin: true, inflightMedia: 1, mediaAgeMs: 1000, deliveryAgeMs: 1000, pulseAgeMs: 30000 }, {}), "media-streaming");
  assert.equal(Network.mediaHealth({ inflightMedia: 1, mediaAgeMs: 1000, deliveryAgeMs: 1000 }, {}), "streaming");
});

test("stale in-flight request is diagnosed instead of suppressing recovery forever", () => {
  assert.equal(Network.transportHealth({ hasOrigin: true, inflightMedia: 1, mediaAgeMs: 30000, deliveryAgeMs: 30000, pulseAgeMs: 30000 }, {}), "media-request-stale");
  assert.equal(Network.mediaHealth({ inflightMedia: 1, mediaAgeMs: 30000, deliveryAgeMs: 30000 }, {}), "stalled-request");
});

test("response payload bytes parse content-length and content-range", () => {
  assert.equal(Network.responsePayloadBytes([{ name: "Content-Length", value: "1250000" }]), 1_250_000);
  assert.equal(Network.responsePayloadBytes([{ name: "Content-Range", value: "bytes 1000-1999/9000000" }]), 1000);
  assert.equal(Network.responsePayloadBytes([]), 0);
});

test("bandwidth EWMA uses fast and slow estimates conservatively", () => {
  let state = {};
  state = Network.updateBandwidthEstimate(state, 12_000_000, 1000, { fastHalfLifeSeconds: 3, slowHalfLifeSeconds: 9, sampleBytes: 1_500_000 });
  state = Network.updateBandwidthEstimate(state, 6_000_000, 1000, { fastHalfLifeSeconds: 3, slowHalfLifeSeconds: 9, sampleBytes: 750_000 });
  assert.equal(state.bandwidthSampleCount, 2);
  assert.ok(state.bandwidthEstimateBps > 0);
  assert.equal(state.bandwidthEstimateBps, Math.min(state.bandwidthFastBps, state.bandwidthSlowBps));
  assert.ok(state.bandwidthFastBps < state.bandwidthSlowBps, "fast EWMA should learn the drop faster");
  assert.ok(state.bandwidthInstability > 0);
});
