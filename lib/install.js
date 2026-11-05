"use strict";

// Wires the two halves together. The server half scales only while the client half is
// confirmed deliverable: until EveJS's handshake payload builder has been wrapped, and for
// good if delivery fails, every planetStaticData wrapper reports retail values.

const { readMultiplier } = require("./multiplier");
const serverPatches = require("./serverPatches");
const loginDelivery = require("./loginDelivery");

const TAG = "[CPI]";

function install({ Module, multiplier, log = console }) {
  if (multiplier === 1) {
    log.log(`${TAG} multiplier is 1; nothing to change.`);
    return { getMultiplier: () => 1 };
  }

  const state = { delivered: false, failed: false };
  const getMultiplier = () => (state.delivered && !state.failed ? multiplier : 1);

  loginDelivery.installLoginDelivery({
    Module,
    multiplier,
    log,
    onReady() {
      state.delivered = true;
      log.log(`${TAG} planetary infrastructure capacity x${multiplier} on the server and at client login.`);
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
          serverPatches.patchPlanetStaticData(result, getMultiplier);
        } catch (error) {
          state.failed = true;
          log.error(`${TAG} disabled, PI stays at retail: ${error.message}`);
        }
      }
    }
    return result;
  };

  return { getMultiplier, state };
}

function installFromPreferences({ Module, log = console }) {
  let multiplier;
  try {
    multiplier = readMultiplier();
  } catch (error) {
    log.error(`${TAG} disabled, PI stays at retail: ${error.message}`);
    return null;
  }
  return install({ Module, multiplier, log });
}

module.exports = {
  install,
  installFromPreferences,
};
