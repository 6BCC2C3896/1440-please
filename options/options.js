"use strict";
const Core = globalThis.YTBufferCore;
const KEY = "settings";
const checks = ["enabled"];
let rampProfile = "defensive";
let saveTimer = null;
let loaded = false;

function standardize(value) {
  return Core.applyStandardPolicy ? Core.applyStandardPolicy(value) : Core.mergeSettings(value);
}

function setRamp(profile) {
  rampProfile = profile === "aggressive" ? "aggressive" : "defensive";
  document.querySelectorAll("[data-ramp]").forEach((button) => {
    const active = button.dataset.ramp === rampProfile;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });
}

function fill(settings) {
  checks.forEach((id) => { document.getElementById(id).checked = Boolean(settings[id]); });
  setRamp(settings.rampProfile);
}

function collect() {
  const preferences = { rampProfile };
  checks.forEach((id) => { preferences[id] = document.getElementById(id).checked; });
  return standardize(preferences);
}

function flashSaved() {
  const el = document.getElementById("status");
  el.textContent = "Saved";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { el.textContent = "Changes save automatically."; }, 1200);
}

async function save() {
  if (!loaded) return;
  await browser.storage.local.set({ [KEY]: collect() });
  flashSaved();
}

async function load() {
  const value = await browser.storage.local.get(KEY);
  fill(standardize(value[KEY]));
  loaded = true;
}

document.querySelectorAll("[data-ramp]").forEach((button) => {
  button.addEventListener("click", () => {
    const next = button.dataset.ramp === "aggressive" ? "aggressive" : "defensive";
    if (next === rampProfile) return;
    setRamp(next);
    void save();
  });
});
checks.forEach((id) => document.getElementById(id).addEventListener("change", () => { void save(); }));

void load();
