"use strict";
importScripts("../lib/core.js", "../lib/scheduler-core.js");

self.onmessage = (event) => {
  const message = event.data || {};
  if (message.type !== "tick") return;
  try {
    const actions = self.YTBufferSchedulerCore.planTick(
      message.sessions || [],
      message.settings || {},
      message.nowEpochMs || Date.now()
    );
    self.postMessage({
      type: "plan",
      requestId: message.requestId,
      nowEpochMs: message.nowEpochMs || Date.now(),
      actions
    });
  } catch (error) {
    self.postMessage({
      type: "worker-error",
      requestId: message.requestId,
      message: String(error && error.stack ? error.stack : error)
    });
  }
};
