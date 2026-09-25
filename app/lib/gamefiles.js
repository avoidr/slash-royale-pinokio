"use strict";

const fs = require("fs");
const path = require("path");
const { p, exists } = require("./paths");
const logs = require("./logs");

function csvList(sub = "csv_logic") {
  const dir = path.join(p.gameAssets, sub);
  if (!exists(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(".csv"))
    .sort()
    .map((f) => ({ file: `${sub}/${f}`, name: f.replace(/\.csv$/i, "") }));
}

function csvPath(rel) {
  const safe = String(rel).replace(/^[\\/]+/, "").replace(/\.\./g, "");
  const abs = path.join(p.gameAssets, safe);
  const norm = path.resolve(p.gameAssets);
  if (!path.resolve(abs).startsWith(norm)) throw new Error("invalid path");
  return abs;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      pushField();
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      pushRow();
    } else field += c;
  }
  if (field !== "" || row.length > 0) pushRow();
  while (rows.length && rows[rows.length - 1].every((c) => c === "")) {
    rows.pop();
  }
  return rows;
}

function serializeCsv(rows) {
  const esc = (cell) => {
    const s = String(cell === null || cell === undefined ? "" : cell);
    if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  };
  return rows.map((r) => r.map(esc).join(",")).join("\r\n") + "\r\n";
}

function readCsv(rel) {
  const abs = csvPath(rel);
  if (!exists(abs)) throw new Error(`File not found: ${rel}`);
  const text = fs.readFileSync(abs, "utf8");
  const rows = parseCsv(text);
  const headers = rows.length > 0 ? rows[0] : [];
  const types = rows.length > 1 ? rows[1] : [];
  const data = rows.slice(2);
  return { headers, types, rows, data };
}

function writeCsv(rel, payload) {
  const { headers, types, data } = payload;
  if (!Array.isArray(headers) || !Array.isArray(types)) {
    throw new Error("Headers and type rows are required");
  }
  const normHeaders = headers.map((h, i) => (h === undefined || h === null ? "" : String(h)));
  const normTypes = types.map((t, i) => (t === undefined || t === null ? "" : String(t)));
  const rows = [normHeaders, normTypes];
  for (const entry of data || []) {
    if (Array.isArray(entry)) {
      rows.push(entry.map((v) => (v === undefined || v === null ? "" : String(v))));
    } else if (entry && typeof entry === "object") {
      const out = normHeaders.map((h) => (h in entry ? String(entry[h] ?? "") : ""));
      // support numeric keys too
      for (const k of Object.keys(entry)) {
        const idx = parseInt(k, 10);
        if (Number.isInteger(idx) && idx >= 0 && out[idx] === undefined) out[idx] = String(entry[k] ?? "");
      }
      rows.push(out);
    } else {
      rows.push([String(entry ?? "")]);
    }
  }
  const max = normHeaders.length;
  for (const r of rows) {
    while (r.length < max) r.push("");
  }
  const abs = csvPath(rel);
  fs.writeFileSync(abs, serializeCsv(rows), "utf8");
  logs.log("gamefiles", `Saved ${rel}`);
  return { ok: true, file: rel };
}

function restoreAll() {
  const src = p.pristineGameAssets;
  const dst = p.gameAssets;
  if (!exists(src)) throw new Error("Pristine GameAssets not found (server clone missing). Run Install.");
  fs.mkdirSync(dst, { recursive: true });
  const copyDir = (from, to) => {
    if (!exists(from)) return;
    fs.mkdirSync(to, { recursive: true });
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      const s = path.join(from, entry.name);
      const d = path.join(to, entry.name);
      if (entry.isDirectory()) copyDir(s, d);
      else fs.copyFileSync(s, d);
    }
  };
  copyDir(src, dst);
  logs.log("gamefiles", "Restored pristine GameAssets from the SlashRoyale source.");
  return { ok: true };
}

function pristineVsPublishDiff() {
  const diffFiles = [];
  const walk = (from, to) => {
    if (!exists(from)) return;
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      const s = path.join(from, entry.name);
      const d = path.join(to, entry.name);
      if (entry.isDirectory()) {
        walk(s, d);
      } else {
        if (!exists(d)) diffFiles.push(path.relative(p.pristineGameAssets, s));
        else if (!fs.readFileSync(s).equals(fs.readFileSync(d))) {
          diffFiles.push(path.relative(p.pristineGameAssets, s));
        }
      }
    }
  };
  walk(p.pristineGameAssets, p.gameAssets);
  return diffFiles;
}

module.exports = { csvList, readCsv, writeCsv, restoreAll, pristineVsPublishDiff, parseCsv, serializeCsv };