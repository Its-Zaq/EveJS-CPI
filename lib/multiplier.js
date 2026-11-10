"use strict";

// This mod's settings, and the scaling rules the server and the client share.
// client/cpi.py repeats scaleOutput, scaleCapacity and scaleDuration in Python; the two must stay
// identical, because the client checks a colony against its own numbers before the server sees it.

const fs = require("fs");
const path = require("path");

const CAPACITY_SETTING_KEYS = Object.freeze([
  "piCommandCenterFittingMultiplier",
  "piConnectionBandwidthMultiplier",
  "piStorageCapacityMultiplier",
]);
// The duration setting for each commodity tier, P1 to P4.
const DURATION_SETTING_BY_TIER = Object.freeze({
  1: "piP1SchematicDurationMultiplier",
  2: "piP2SchematicDurationMultiplier",
  3: "piP3SchematicDurationMultiplier",
  4: "piP4SchematicDurationMultiplier",
});
const SETTING_KEYS = Object.freeze([...CAPACITY_SETTING_KEYS, ...Object.values(DURATION_SETTING_BY_TIER)]);
// CPI 1.0's one setting, which stood for all three capacity settings.
const LEGACY_SETTING_KEY = "planetaryInfrastructureCapacityMultiplier";
const PREFERENCES_FILE = path.join(__dirname, "..", "preferences.json");
const DEFAULT_MULTIPLIER = 1;
const RETAIL = Object.freeze(Object.fromEntries(SETTING_KEYS.map((key) => [key, DEFAULT_MULTIPLIER])));

// Accepts a finite number above zero. Anything else is refused rather than replaced, so a
// hand-edited preferences.json with a bad value is reported instead of silently ignored.
function parseMultiplier(key, value) {
  if (typeof value !== "number" || !Number.isFinite(value) || !(value > 0)) {
    throw new Error(
      `${key} must be a number greater than 0, such as 0.5, 2 or 50; got ${JSON.stringify(value)}.`,
    );
  }
  return value;
}

// preferences.json as an object, or null when there is none. The Launcher writes it on the first
// Save of the Configure form; until then every setting is the default, which changes nothing.
function readPreferences(file) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
  const preferences = JSON.parse(text);
  if (!preferences || typeof preferences !== "object" || Array.isArray(preferences)) {
    throw new Error("preferences.json must hold a JSON object.");
  }
  return preferences;
}

// A capacity setting missing from preferences.json takes CPI 1.0's value when that is still
// there, so the settings are right even if migrateLegacyPreferences could not rewrite the file.
function readSettings(file = PREFERENCES_FILE) {
  const preferences = readPreferences(file) || {};
  const legacy = LEGACY_SETTING_KEY in preferences
    ? parseMultiplier(LEGACY_SETTING_KEY, preferences[LEGACY_SETTING_KEY])
    : DEFAULT_MULTIPLIER;
  const settings = {};
  for (const key of SETTING_KEYS) {
    if (key in preferences) {
      settings[key] = parseMultiplier(key, preferences[key]);
    } else {
      settings[key] = CAPACITY_SETTING_KEYS.includes(key) ? legacy : DEFAULT_MULTIPLIER;
    }
  }
  return settings;
}

// On the first start after an update from CPI 1.0, its setting is replaced, in its place in
// preferences.json, by the three capacity settings it stood for; a capacity setting already
// there keeps its own value. Returns whether the file was rewritten.
function migrateLegacyPreferences(file = PREFERENCES_FILE) {
  const preferences = readPreferences(file);
  if (!preferences || !(LEGACY_SETTING_KEY in preferences)) {
    return false;
  }
  const value = parseMultiplier(LEGACY_SETTING_KEY, preferences[LEGACY_SETTING_KEY]);
  const migrated = {};
  for (const [key, existing] of Object.entries(preferences)) {
    if (key !== LEGACY_SETTING_KEY) {
      migrated[key] = existing;
      continue;
    }
    for (const capacityKey of CAPACITY_SETTING_KEYS) {
      if (!(capacityKey in preferences)) {
        migrated[capacityKey] = value;
      }
    }
  }
  // Write beside the file and rename over it, so a failed write never leaves half a file.
  const temporary = `${file}.cpi-migrate`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(migrated, null, 2)}\n`, "utf8");
    fs.renameSync(temporary, file);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
  return true;
}

// CPU and powergrid output are whole numbers on both sides; round half up.
function scaleOutput(value, multiplier) {
  return Math.floor(Number(value) * multiplier + 0.5);
}

// Link bandwidth and storage capacity are floats (m3/h and m3) on both sides.
function scaleCapacity(value, multiplier) {
  return Number(value) * multiplier;
}

// Schematic cycles are whole seconds on both sides: EveJS turns them into BigInt ticks, which
// refuses a fraction. Round half up, and never below one second.
function scaleDuration(seconds, multiplier) {
  return Math.max(1, Math.floor(Number(seconds) * multiplier + 0.5));
}

module.exports = {
  SETTING_KEYS,
  DURATION_SETTING_BY_TIER,
  LEGACY_SETTING_KEY,
  PREFERENCES_FILE,
  DEFAULT_MULTIPLIER,
  RETAIL,
  parseMultiplier,
  readSettings,
  migrateLegacyPreferences,
  scaleOutput,
  scaleCapacity,
  scaleDuration,
};
