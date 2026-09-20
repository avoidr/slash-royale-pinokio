"use strict";

const fs = require("fs");
const os = require("os");
const { p } = require("./paths");
const { readJson } = require("./util");

const DEFAULTS = {
  serverAddress: "",
  autoStartServices: false,
  db: {
    host: "127.0.0.1",
    port: 3306,
    user: "root",
    password: "",
    database: "rrdb",
  },
  apk: {
    patchAddress: true,
    patchBattles: true,
    bakeGamefiles: true,
    lastOutput: "",
    lastBuild: null,
  },
  panelPort: 3000,
};

function localIp() {
  // The address is never "unset" — a private server is always reachable on some
  // address of the machine running it. Prefer a real LAN (RFC1918) IP on a
  // physical adapter: VPN/virtual adapters (Tailscale, Docker, WSL, …) often
  // enumerate first and report link-local or CGNAT addresses that no friend can
  // reach. Fall back to any routable address, then loopback.
  const VIRTUAL_RE = /tailscale|utun|wintun|wireguard|zerotier|docker|veth|br-|vmware|virtualbox|hyper-v|hyperv|wsl|loopback|teredo|isatap|bluetooth|vpn|ppp/i;

  function classify(name, address) {
    const [a, b] = address.split(".").map(Number);
    const rfc1918 = a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
    const linkLocal = a === 169 && b === 254;
    const cgnat = a === 100 && b >= 64 && b <= 127;
    return { rfc1918, linkLocal, cgnat, virtual: VIRTUAL_RE.test(name || "") };
  }

  const candidates = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family !== "IPv4" || ni.internal) continue;
      const c = classify(name, ni.address);
      if (c.linkLocal) continue;
      c.name = name;
      c.address = ni.address;
      candidates.push(c);
    }
  }
  if (!candidates.length) return "127.0.0.1";
  candidates.sort((x, y) => {
    const sx = (x.rfc1918 ? 2 : 0) + (x.virtual ? 0 : 4);
    const sy = (y.rfc1918 ? 2 : 0) + (y.virtual ? 0 : 4);
    return sy - sx;
  });
  return candidates[0].address;
}

let current = null;

function load() {
  if (current) return current;
  const saved = readJson(p.settingsFile, {});
  current = mergeDefaults(DEFAULTS, saved);
  if (!current.serverAddress) current.serverAddress = localIp();
  return current;
}

function mergeDefaults(base, saved) {
  const out = {};
  for (const [k, v] of Object.entries(base)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      out[k] = mergeDefaults(v, saved && typeof saved[k] === "object" ? saved[k] : {});
    } else {
      out[k] = saved && k in saved && saved[k] !== undefined && saved[k] !== null ? saved[k] : v;
    }
  }
  return out;
}

function save(next) {
  current = next;
  fs.writeFileSync(p.settingsFile, JSON.stringify(current, null, 2));
  return current;
}

module.exports = { load, save, get: () => load(), localIp, defaults: DEFAULTS };