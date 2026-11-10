"use strict";

// Wires the two halves together. The server half scales only while the client half is
// confirmed deliverable: until EveJS's handshake payload builder has been wrapped, and for
// good if delivery fails, every planetStaticData wrapper reports retail values.

const { RETAIL, SETTING_KEYS, LEGACY_SETTING_KEY, readSettings, migrateLegacyPreferences } = require("./multiplier");
const serverPatches = require("./serverPatches");
const loginDelivery = require("./loginDelivery");

const TAG = "[CPI]";

// The settings that differ from retail, for the log: "piStorageCapacityMultiplier x2, ...".
function describeSettings(settings) {
  return SETTING_KEYS.filter((key) => settings[key] !== 1).map((key) => `${key} x${settings[key]}`).join(", ");
}

function install({ Module, settings, log = console }) {
  if (SETTING_KEYS.every((key) => settings[key] === 1)) {
    log.log(`${TAG} every setting is 1; nothing to change.`);
    return { getSettings: () => RETAIL };
  }

  const state = { delivered: false, failed: false };
  const getSettings = () => (state.delivered && !state.failed ? settings : RETAIL);

  loginDelivery.installLoginDelivery({
    Module,
    settings,
    log,
    onReady() {
      state.delivered = true;
      log.log(`${TAG} on the server and at client login: ${describeSettings(settings)}.`);
    },
    onFailure(reason) {
      if (!state.failed) {
        state.failed = true;
        log.error(`${TAG} disabled, PI stays at retail: ${reason}.`);
      }
    },
  });

  const originalLoad = Module._load;
  let patched = false;
  Module._load = function loadWithCpi(request, parent, isMain) {
    const result = originalLoad.apply(this, arguments);
    if (!patched) {
      let resolved = "";
      try {
        resolved = Module._resolveFilename(request, parent, isMain);
      } catch (error) {
        return result;
      }
      if (serverPatches.isTarget(resolved)) {
        patched = true;
        try {
          serverPatches.patchPlanetStaticData(result, getSettings);
        } catch (error) {
          state.failed = true;
          log.error(`${TAG} disabled, PI stays at retail: ${error.message}`);
        }
      }
    }
    return result;
  };

  return { getSettings, state };
}

function installFromPreferences({ Module, log = console, file } = {}) {
  // A failed rewrite costs nothing but the log line: readSettings applies the old setting itself.
  try {
    if (migrateLegacyPreferences(file)) {
      log.log(`${TAG} preferences.json: replaced ${LEGACY_SETTING_KEY} with the three capacity settings.`);
    }
  } catch (error) {
    log.error(`${TAG} could not replace ${LEGACY_SETTING_KEY} in preferences.json: ${error.message}`);
  }
  let settings;
  try {
    settings = readSettings(file);
  } catch (error) {
    log.error(`${TAG} disabled, PI stays at retail: ${error.message}`);
    return null;
  }
  return install({ Module, settings, log });
}

module.exports = {
  install,
  installFromPreferences,
};
