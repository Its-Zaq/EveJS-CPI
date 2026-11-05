"use strict";

// The one setting this mod has, and the scaling rules the server and the client share.
// client/cpi.py repeats scaleOutput and scaleCapacity in Python; the two must stay identical,
// because the client checks a colony against its own numbers before the server sees it.

const fs = require("fs");
const path = require("path");

const SETTING_KEY = "planetaryInfrastructureCapacityMultiplier";
const PREFERENCES_FILE = path.join(__dirname, "..", "preferences.json");
const DEFAULT_MULTIPLIER = 1;

// Accepts a finite number above zero. Anything else is refused rather than replaced, so a
// hand-edited preferences.json with a bad value is reported instead of silently ignored.
function parseMultiplier(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || !(value > 0)) {
    throw new Error(
      `${SETTING_KEY} must be a number greater than 0, such as 0.5, 2 or 50; got ${JSON.stringify(value)}.`,
    );
  }
  return value;
}

// The Launcher writes preferences.json on the first Save of the Configure form. Until then
// the mod runs with the default, which changes nothing.
function readMultiplier(file = PREFERENCES_FILE) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return DEFAULT_MULTIPLIER;
    }
    throw error;
  }
  const preferences = JSON.parse(text);
  if (!preferences || typeof preferences !== "object" || !(SETTING_KEY in preferences)) {
    return DEFAULT_MULTIPLIER;
  }
  return parseMultiplier(preferences[SETTING_KEY]);
}

// CPU and powergrid output are whole numbers on both sides; round half up.
function scaleOutput(value, multiplier) {
  return Math.floor(Number(value) * multiplier + 0.5);
}

// Link bandwidth and storage capacity are floats (m3/h and m3) on both sides.
function scaleCapacity(value, multiplier) {
  return Number(value) * multiplier;
}

module.exports = {
  SETTING_KEY,
  PREFERENCES_FILE,
  DEFAULT_MULTIPLIER,
  parseMultiplier,
  readMultiplier,
  scaleOutput,
  scaleCapacity,
};
