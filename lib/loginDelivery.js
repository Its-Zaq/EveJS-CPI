"use strict";

// Sends client/cpi.py to the EVE client in the login handshake.
//
// EveJS builds the handshake's signedFunc in buildTidiSignedFunc, a function declared inside
// server/src/network/tcp/handshake.js and called there by name. It is not exported in a way a
// loader can replace, so this module appends one statement to that file's source as Node
// compiles it, rebinding the name to a wrapper. The wrapper keeps EveJS's payload, runs it
// first, then runs cpi.py in a private namespace and returns EveJS's result.

const fs = require("fs");
const path = require("path");

const TARGET_SUFFIX = "/server/src/network/tcp/handshake.js";
const ANCHOR = "function buildTidiSignedFunc(";
const WRAP_KEY = Symbol.for("evejs.cpi.wrapSignedFunc");
const CLIENT_SOURCE_FILE = path.join(__dirname, "..", "client", "cpi.py");
const MULTIPLIER_TOKEN = "__CPI_MULTIPLIER__";
const MAX_CLIENT_SOURCE_BYTES = 64 * 1024;
const MARSHAL_STRING = 0x74;

// The wrapped builder, kept for diagnostics and tests: EveJS's own copy is module-private.
let wrappedBuilder = null;

function isTarget(filename) {
  return String(filename).replace(/\\/g, "/").endsWith(TARGET_SUFFIX);
}

function countOccurrences(text, needle) {
  let count = 0;
  for (let index = text.indexOf(needle); index !== -1; index = text.indexOf(needle, index + 1)) {
    count += 1;
  }
  return count;
}

// The handshake.js source with the rebinding statement appended, or an Error saying why the
// source is not one this mod knows how to extend.
function extendHandshakeSource(source) {
  const count = countOccurrences(String(source), ANCHOR);
  if (count !== 1) {
    return new Error(`expected "${ANCHOR}" once in handshake.js, found it ${count} times`);
  }
  return `${source}\n;buildTidiSignedFunc = globalThis[Symbol.for("evejs.cpi.wrapSignedFunc")](buildTidiSignedFunc);\n`;
}

function buildClientSource(multiplier, template = fs.readFileSync(CLIENT_SOURCE_FILE, "utf8")) {
  if (countOccurrences(template, MULTIPLIER_TOKEN) !== 1) {
    throw new Error(`client/cpi.py must contain ${MULTIPLIER_TOKEN} exactly once.`);
  }
  const source = template.replace(MULTIPLIER_TOKEN, String(multiplier));
  if (!/^[\x00-\x7f]*$/.test(source)) {
    throw new Error("client/cpi.py must be ASCII.");
  }
  if (Buffer.byteLength(source, "ascii") > MAX_CLIENT_SOURCE_BYTES) {
    throw new Error(`client/cpi.py is larger than ${MAX_CLIENT_SOURCE_BYTES} bytes.`);
  }
  return source;
}

// A Python 2.7 marshal string: 0x74, a little-endian int32 length, then ASCII bytes.
function readMarshaledString(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 5 || buffer[0] !== MARSHAL_STRING) {
    throw new Error("signedFunc is not a marshaled string.");
  }
  const length = buffer.readInt32LE(1);
  if (length !== buffer.length - 5) {
    throw new Error("signedFunc length does not match its envelope.");
  }
  return buffer.subarray(5).toString("ascii");
}

function writeMarshaledString(text) {
  const buffer = Buffer.alloc(5 + text.length);
  buffer[0] = MARSHAL_STRING;
  buffer.writeInt32LE(text.length, 1);
  buffer.write(text, 5, "ascii");
  return buffer;
}

// EveJS's expression runs first, as the lambda's argument; cpi.py runs after it and the
// lambda returns EveJS's result unchanged.
function composeSignedFunc(original, clientSource) {
  const expression = readMarshaledString(original);
  const encoded = Buffer.from(clientSource, "ascii").toString("base64");
  const composed =
    "(lambda _evejs_result: (eval(compile(__import__('base64').b64decode('" + encoded + "'), " +
    "'<evejs-cpi>', 'exec'), {'__builtins__': __builtins__, '__name__': 'evejs_cpi'}), " +
    "_evejs_result)[1])(" + expression + ")";
  return writeMarshaledString(composed);
}

// Installs the compile hook. onReady() is called once EveJS's payload builder has been
// wrapped and its output checked; onFailure(reason) when the client half cannot be delivered.
// The loader keeps the server half at retail until onReady, so the two never disagree.
function installLoginDelivery({ Module, multiplier, onReady, onFailure, log = console }) {
  if (Object.keys(Module._cache).some(isTarget)) {
    onFailure("handshake.js was loaded before CPI's preload ran");
    return;
  }

  let clientSource;
  try {
    clientSource = buildClientSource(multiplier);
  } catch (error) {
    onFailure(error.message);
    return;
  }

  globalThis[WRAP_KEY] = function wrapSignedFunc(originalBuilder) {
    try {
      composeSignedFunc(originalBuilder(0), clientSource);
    } catch (error) {
      onFailure(`EveJS's signedFunc has an unexpected shape: ${error.message}`);
      return originalBuilder;
    }
    onReady();
    wrappedBuilder = function buildTidiSignedFuncWithCpi(...args) {
      const original = originalBuilder.apply(this, args);
      try {
        return composeSignedFunc(original, clientSource);
      } catch (error) {
        log.error("[CPI] could not add the client half to this login:", error);
        return original;
      }
    };
    return wrappedBuilder;
  };

  const originalCompile = Module.prototype._compile;
  let extended = false;
  Module.prototype._compile = function compileWithCpi(content, filename) {
    if (!extended && isTarget(filename)) {
      extended = true;
      const result = extendHandshakeSource(content);
      if (result instanceof Error) {
        onFailure(result.message);
      } else {
        content = result;
      }
    }
    return originalCompile.call(this, content, filename);
  };
}

module.exports = {
  ANCHOR,
  TARGET_SUFFIX,
  extendHandshakeSource,
  buildClientSource,
  readMarshaledString,
  writeMarshaledString,
  composeSignedFunc,
  installLoginDelivery,
  getWrappedBuilder: () => wrappedBuilder,
};
