"use strict";

const mariadb = require("mariadb");
const dbview = require("./dbview");
const logs = require("./logs");

const POLL_MS = 2000;

let pool = null;
let timer = null;
let seeded = false;
const known = new Map();

function getPool() {
  if (!pool) pool = mariadb.createPool({ ...dbview.poolOpts(), connectionLimit: 2 });
  return pool;
}

function homeOf(raw) {
  try {
    const parsed = JSON.parse(raw);
    const h = parsed && typeof parsed === "object" && parsed.Home && typeof parsed.Home === "object" ? parsed.Home : parsed;
    return { name: h.name || null, total: h.totalSessions || 0 };
  } catch (e) {
    return { name: null, total: 0 };
  }
}

function fmtDur(s) {
  s = Math.max(0, Math.round(s || 0));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s - m * 60}s`;
}

function lastSessionOf(raw) {
  try {
    const arr = JSON.parse(raw);
    const s = arr && arr.length ? arr[arr.length - 1] : null;
    return s ? { sessionId: s.sessionId, dur: s.duration } : null;
  } catch (e) {
    return null;
  }
}

async function scan() {
  let conn;
  try {
    conn = await getPool().getConnection();
    await conn.ping();
    const rows = await conn.query("SELECT Id, Home, Sessions FROM `player`");
    const seen = new Set();
    for (const r of rows) {
      const id = r.Id;
      seen.add(id);
      const home = homeOf(r.Home);
      const last = lastSessionOf(r.Sessions);
      const lastSessionId = last ? last.sessionId : null;
      const prev = known.get(id);
      if (!prev) {
        known.set(id, { name: home.name, lastSessionId, total: home.total });
        if (seeded) logs.log("activity", `Player "${home.name || id}" (id ${id}) registered.`);
        continue;
      }
      if (seeded) {
        if (home.total !== prev.total) {
          logs.log("activity", `Player "${home.name || id}" (id ${id}) logged in (#${home.total}).`);
        }
        if (prev.lastSessionId && lastSessionId && prev.lastSessionId !== lastSessionId) {
          const dur = fmtDur(last.dur);
          logs.log("activity", `Player "${home.name || id}" (id ${id}) disconnected (session lasted ${dur}).`);
        }
      }
      known.set(id, { name: home.name, lastSessionId, total: home.total });
    }
    for (const id of known.keys()) if (!seen.has(id)) known.delete(id);
    seeded = true;
  } catch (e) {
    // db unreachable mid-cycle (server stack being started/stopped); skip silently
  } finally {
    if (conn) {
      try {
        conn.release();
      } catch (e) {}
    }
  }
}

function start() {
  if (timer) return;
  seeded = false;
  known.clear();
  scan();
  timer = setInterval(scan, POLL_MS);
  if (timer.unref) timer.unref();
}

function stop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = { start, stop };