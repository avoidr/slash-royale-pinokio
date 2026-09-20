"use strict";

const { execFile: ef, spawn } = require("child_process");
const crypto = require("crypto");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function execFile(file, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = ef(file, args, { windowsHide: true, ...opts }, (err, stdout, stderr) => {
      if (err) {
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
      } else {
        resolve({ stdout, stderr });
      }
    });
    child.on("error", reject);
  });
}

function parseJson(text, fallback) {
  try {
    return JSON.parse(text);
  } catch (e) {
    return fallback;
  }
}

function readJson(file, fallback) {
  try {
    return JSON.parse(require("fs").readFileSync(file, "utf8"));
  } catch (e) {
    return fallback;
  }
}

function nowStamp() {
  return new Date().toISOString();
}

function ts() {
  const d = new Date();
  return (
    d.toISOString().slice(0, 19).replace("T", " ") +
    "." +
    String(d.getMilliseconds()).padStart(3, "0")
  );
}

function formatBytes(n) {
  if (!Number.isFinite(n)) return "?";
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + " MB";
  return (n / 1024 / 1024 / 1024).toFixed(2) + " GB";
}

function generatePassword(len = 16) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let out = "";
  const buf = crypto.randomBytes(len);
  for (let i = 0; i < len; i++) out += chars[buf[i] % chars.length];
  return out;
}

function indexOfBytes(haystack, needle) {
  if (!needle.length) return -1;
  const first = needle[0];
  for (let i = 0; i <= haystack.length - needle.length; i++) {
    if (haystack[i] !== first) continue;
    let ok = true;
    for (let j = 1; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return i;
  }
  return -1;
}

function asciiBytes(str) {
  return Buffer.from(str, "ascii");
}

async function checkPortListening(port, host = "127.0.0.1", timeoutMs = 800) {
  const net = require("net");
  return new Promise((resolve) => {
    const sock = net.connect({ port, host });
    const done = (ok) => {
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(timeoutMs);
    sock.once("connect", () => done(true));
    sock.once("timeout", () => done(false));
    sock.once("error", () => done(false));
  });
}

function freePort(start) {
  const net = require("net");
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", () => {
      resolve(freePort(start + 1));
    });
    server.listen(start, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

module.exports = {
  sleep,
  execFile,
  parseJson,
  readJson,
  nowStamp,
  ts,
  formatBytes,
  generatePassword,
  indexOfBytes,
  asciiBytes,
  checkPortListening,
  freePort,
};