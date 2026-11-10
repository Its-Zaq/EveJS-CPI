"use strict";

// Server half: scales what planetStaticData reports for the command center, links, storage pins
// and schematic cycles. Every EveJS consumer calls these through the module object
// (planetStaticData.getCommandCenterInfo(...)), so replacing the exports reaches all of them.
// Calls inside planetStaticData itself keep the retail values; the one that matters,
// getCommandCenterUpgradeCost, must keep them, because upgrade costs are not scaled.

const { DURATION_SETTING_BY_TIER, scaleOutput, scaleCapacity, scaleDuration } = require("./multiplier");

const TARGET_SUFFIX = "/server/src/services/planet/planetStaticData.js";
const STORAGE_ENTITY_TYPES = new Set(["command", "spaceport", "storage"]);
const REQUIRED_EXPORTS = Object.freeze([
  "getCommandCenterInfo",
  "getUsageParametersForLinkType",
  "getPITypeInfo",
  "getSchematicByID",
  "getCommodityTier",
]);
const PATCHED = Symbol.for("evejs.cpi.planetStaticDataPatched");

function isTarget(resolvedFilename) {
  return String(resolvedFilename).replace(/\\/g, "/").endsWith(TARGET_SUFFIX);
}

function missingExports(exports) {
  return REQUIRED_EXPORTS.filter((name) => !exports || typeof exports[name] !== "function");
}

// A schematic's tier is its product's: P1 to P4 by item group, as on the client. The highest
// output decides, so a schematic with a P1 input next to its P3 inputs still counts as P4.
function getSchematicTier(schematic, getCommodityTier) {
  let tier = null;
  for (const output of schematic.outputs || []) {
    const outputTier = getCommodityTier(output.typeID);
    if (DURATION_SETTING_BY_TIER[outputTier] && (tier === null || outputTier > tier)) {
      tier = outputTier;
    }
  }
  return tier;
}

// getSettings is read on every call, so the login-delivery half can switch the server back
// to retail if it cannot reach the client (see install.js).
function patchPlanetStaticData(planetStaticData, getSettings) {
  const missing = missingExports(planetStaticData);
  if (missing.length > 0) {
    throw new Error(`planetStaticData no longer exports ${missing.join(", ")}.`);
  }
  if (planetStaticData[PATCHED]) {
    return false;
  }

  const originalCommandCenterInfo = planetStaticData.getCommandCenterInfo;
  const originalLinkParameters = planetStaticData.getUsageParametersForLinkType;
  const originalTypeInfo = planetStaticData.getPITypeInfo;
  const originalSchematic = planetStaticData.getSchematicByID;
  const getCommodityTier = planetStaticData.getCommodityTier;
  const tierBySchematic = new WeakMap();

  planetStaticData.getCommandCenterInfo = function getCommandCenterInfo(...args) {
    const info = originalCommandCenterInfo.apply(this, args);
    const multiplier = getSettings().piCommandCenterFittingMultiplier;
    if (!info || multiplier === 1) {
      return info;
    }
    return Object.freeze({
      ...info,
      powerOutput: scaleOutput(info.powerOutput, multiplier),
      cpuOutput: scaleOutput(info.cpuOutput, multiplier),
    });
  };

  planetStaticData.getUsageParametersForLinkType = function getUsageParametersForLinkType(...args) {
    const parameters = originalLinkParameters.apply(this, args);
    const multiplier = getSettings().piConnectionBandwidthMultiplier;
    if (!parameters || multiplier === 1 || !Number.isFinite(Number(parameters.logisticalCapacity))) {
      return parameters;
    }
    return {
      ...parameters,
      logisticalCapacity: scaleCapacity(parameters.logisticalCapacity, multiplier),
    };
  };

  planetStaticData.getPITypeInfo = function getPITypeInfo(...args) {
    const info = originalTypeInfo.apply(this, args);
    const multiplier = getSettings().piStorageCapacityMultiplier;
    if (
      !info ||
      multiplier === 1 ||
      !STORAGE_ENTITY_TYPES.has(info.pinEntityType) ||
      info.capacity === null ||
      info.capacity === undefined ||
      !Number.isFinite(Number(info.capacity))
    ) {
      return info;
    }
    return { ...info, capacity: scaleCapacity(info.capacity, multiplier) };
  };

  // EveJS returns its cached schematic object, so a scaled schematic is always a new copy:
  // changing the cached one would scale it again on every call.
  planetStaticData.getSchematicByID = function getSchematicByID(...args) {
    const schematic = originalSchematic.apply(this, args);
    if (!schematic || typeof schematic !== "object") {
      return schematic;
    }
    if (!tierBySchematic.has(schematic)) {
      tierBySchematic.set(schematic, getSchematicTier(schematic, getCommodityTier));
    }
    const tier = tierBySchematic.get(schematic);
    const multiplier = tier === null ? 1 : getSettings()[DURATION_SETTING_BY_TIER[tier]];
    if (multiplier === 1 || !Number.isFinite(Number(schematic.cycleTime))) {
      return schematic;
    }
    return { ...schematic, cycleTime: scaleDuration(schematic.cycleTime, multiplier) };
  };

  Object.defineProperty(planetStaticData, PATCHED, { value: true });
  return true;
}

module.exports = {
  TARGET_SUFFIX,
  isTarget,
  patchPlanetStaticData,
};
