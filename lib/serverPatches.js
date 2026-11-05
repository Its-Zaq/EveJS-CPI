"use strict";

// Server half: scales what planetStaticData reports for the command center, links and storage
// pins. Every EveJS consumer calls these through the module object
// (planetStaticData.getCommandCenterInfo(...)), so replacing the exports reaches all of them.
// Calls inside planetStaticData itself keep the retail values; the one that matters,
// getCommandCenterUpgradeCost, must keep them, because upgrade costs are not scaled.

const { scaleOutput, scaleCapacity } = require("./multiplier");

const TARGET_SUFFIX = "/server/src/services/planet/planetStaticData.js";
const STORAGE_ENTITY_TYPES = new Set(["command", "spaceport", "storage"]);
const PATCHED = Symbol.for("evejs.cpi.planetStaticDataPatched");

function isTarget(resolvedFilename) {
  return String(resolvedFilename).replace(/\\/g, "/").endsWith(TARGET_SUFFIX);
}

function hasExpectedShape(exports) {
  return Boolean(exports) &&
    typeof exports.getCommandCenterInfo === "function" &&
    typeof exports.getUsageParametersForLinkType === "function" &&
    typeof exports.getPITypeInfo === "function";
}

// getMultiplier is read on every call, so the login-delivery half can switch the server back
// to retail if it cannot reach the client (see loader.js).
function patchPlanetStaticData(planetStaticData, getMultiplier) {
  if (!hasExpectedShape(planetStaticData)) {
    throw new Error("planetStaticData no longer exports getCommandCenterInfo, getUsageParametersForLinkType and getPITypeInfo.");
  }
  if (planetStaticData[PATCHED]) {
    return false;
  }

  const originalCommandCenterInfo = planetStaticData.getCommandCenterInfo;
  const originalLinkParameters = planetStaticData.getUsageParametersForLinkType;
  const originalTypeInfo = planetStaticData.getPITypeInfo;

  planetStaticData.getCommandCenterInfo = function getCommandCenterInfo(...args) {
    const info = originalCommandCenterInfo.apply(this, args);
    const multiplier = getMultiplier();
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
    const multiplier = getMultiplier();
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
    const multiplier = getMultiplier();
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

  Object.defineProperty(planetStaticData, PATCHED, { value: true });
  return true;
}

module.exports = {
  TARGET_SUFFIX,
  isTarget,
  patchPlanetStaticData,
};
