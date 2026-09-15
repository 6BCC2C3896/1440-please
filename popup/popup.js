"use strict";

const Core = globalThis.YTBufferCore;
const STORAGE_KEY = "settings";
const REFRESH_MS = 500;
let refreshBusy = false;
let lastProfile = "defensive";

async function activeYoutubeTab() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab?.id || !tab.url?.startsWith("https://www.youtube.com/")) return null;
  return tab;
}

async function status() {
  const tab = await activeYoutubeTab();
  if (!tab) throw new Error("Open YouTube first.");
  return browser.runtime.sendMessage({ type: "YTBG_BG_GET_STATUS", tabId: tab.id });
}

function text(selector, value) {
  const el = document.querySelector(selector);
  if (el) el.textContent = value;
}

function stageFor(playback) {
  const mode = String(playback?.quality?.controller?.mode || "");
  const labels = {
    bootstrap: "Starting",
    "range-preferred": "Warming 1440p",
    "transition-preferred": "Testing 1440p",
    preferred: "Settling 1440p",
    cruise: "Stable 1440p",
    "transition-fallback": "Stepping down",
    fallback: "Holding lower"
  };
  return labels[mode] || (playback?.playing ? "Playing" : "Idle");
}

function activityFor(value) {
  const settings = value?.settings || {};
  if (settings.enabled === false) return { label: "Disabled", className: "is-off" };
  if (!value?.installed || value?.state === "no-session") return { label: "Idle", className: "is-idle" };

  const health = String(value?.network?.mediaHealth || "");
  if (health === "stalled-request") return { label: "Stalled", className: "is-alert" };
  if (["streaming", "delivering", "request-active"].includes(health)) {
    return { label: "Streaming", className: "is-active" };
  }
  if (health === "buffer-observed") return { label: "Buffered", className: "is-idle" };
  return { label: "Idle", className: "is-idle" };
}

function setActivity(state) {
  const el = document.querySelector("#liveState");
  if (!el) return;
  el.classList.remove("is-active", "is-idle", "is-alert", "is-off");
  el.classList.add(state.className);
  const label = el.querySelector("span");
  if (label) label.textContent = state.label;
}

function setRampProfile(profile) {
  const normalized = profile === "aggressive" ? "aggressive" : "defensive";
  lastProfile = normalized;
  document.querySelectorAll("[data-ramp]").forEach((button) => {
    const active = button.dataset.ramp === normalized;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });
}

function show(value) {
  const playback = value?.playback || {};
  const settings = value?.settings || {};
  const effective = Number(playback.effectiveBufferAhead || 0);
  const quality = playback.quality || {};
  const actualHeight = Number(quality.currentHeight || quality.selectedHeight || 0);

  text("#effective", effective.toFixed(1));
  text("#quality", actualHeight ? `${actualHeight}p` : "Auto");
  text("#stage", stageFor(playback));
  if (settings.rampProfile) setRampProfile(settings.rampProfile);
  setActivity(activityFor(value));
}

async function refresh() {
  if (refreshBusy) return;
  refreshBusy = true;
  try {
    show(await status());
  } catch (_) {
    text("#effective", "—");
    text("#quality", "—");
    text("#stage", "Open YouTube");
    setActivity({ label: "Idle", className: "is-idle" });
  } finally {
    refreshBusy = false;
  }
}

async function loadRampProfile() {
  try {
    const stored = await browser.storage.local.get(STORAGE_KEY);
    const settings = Core?.applyStandardPolicy
      ? Core.applyStandardPolicy(stored[STORAGE_KEY])
      : (stored[STORAGE_KEY] || {});
    setRampProfile(settings.rampProfile || "defensive");
  } catch (_) {
    setRampProfile("defensive");
  }
}

async function saveRampProfile(profile) {
  const normalized = profile === "aggressive" ? "aggressive" : "defensive";
  if (normalized === lastProfile) return;
  setRampProfile(normalized);
  const stored = await browser.storage.local.get(STORAGE_KEY);
  const next = Core?.applyStandardPolicy
    ? Core.applyStandardPolicy({ ...(stored[STORAGE_KEY] || {}), rampProfile: normalized })
    : { ...(stored[STORAGE_KEY] || {}), rampProfile: normalized };
  await browser.storage.local.set({ [STORAGE_KEY]: next });
  void refresh();
}

document.querySelectorAll("[data-ramp]").forEach((button) => {
  button.addEventListener("click", () => { void saveRampProfile(button.dataset.ramp); });
});
document.querySelector("#options").addEventListener("click", () => browser.runtime.openOptionsPage());

browser.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes[STORAGE_KEY]) return;
  const next = changes[STORAGE_KEY].newValue || {};
  setRampProfile(next.rampProfile || "defensive");
});

void loadRampProfile();
void refresh();
setInterval(() => { void refresh(); }, REFRESH_MS);
