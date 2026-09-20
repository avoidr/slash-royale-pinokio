"use strict";

const fs = require("fs");
const path = require("path");
const mariadb = require("mariadb");
const dbview = require("./dbview");
const config = require("./config");
const gamefiles = require("./gamefiles");
const logs = require("./logs");
const { p } = require("./paths");

let pool = null;
function getPool() {
  if (!pool) pool = mariadb.createPool({ ...dbview.poolOpts(), connectionLimit: 3 });
  return pool;
}

/* ---- helpers ---- */

function unwrapHome(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && parsed.Home && typeof parsed.Home === "object") return parsed.Home;
    return parsed;
  } catch (e) {
    return null;
  }
}

function wrapHome(home) {
  return JSON.stringify({ Home: home });
}

function num(v, def) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : def;
}

function intSafe(v, def) {
  return Math.max(0, Math.round(num(v, def)));
}

function sessionsList(raw) {
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

// Asks the running main server to drop this player from memory so the next login
// reloads from the database, instead of serving the stale in-memory copy. The
// main server polls the "reloads" folder in its working directory every 500ms.
function requestReload(id) {
  try {
    const dir = path.join(p.mainServerDir, "reloads");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${Number(id)}.pol`), "", "utf8");
  } catch (e) {
    logs.log("app", `Player ${id}: reload marker failed (${e.message}).`);
  }
}

function catalogOf() {
  if (catalogOf.cache) return catalogOf.cache;
  const files = [
    { file: "spells_characters", classId: 26 },
    { file: "spells_buildings", classId: 27 },
    { file: "spells_other", classId: 28 },
  ];
  const out = [];
  for (const { file, classId } of files) {
    let data = [];
    try {
      data = gamefiles.readCsv(`csv_logic/${file}.csv`).data;
    } catch (e) {}
    let inst = 0;
    for (const r of data) {
      if (!r[0] || !String(r[0]).trim()) continue;
      out.push({ ClassId: classId, InstanceId: inst, Name: String(r[0]).trim() });
      inst++;
    }
  }
  catalogOf.cache = out;
  return out;
}

function arenasOf() {
  if (arenasOf.cache) return arenasOf.cache;
  const out = [];
  try {
    const { headers, data } = gamefiles.readCsv("csv_logic/arenas.csv");
    const a = headers.indexOf("Arena");
    const tl = headers.indexOf("TrophyLimit");
    if (a > -1 && tl > -1) {
      for (const r of data) {
        const arena = parseInt(r[a], 10);
        const limit = parseInt(r[tl], 10);
        if (Number.isInteger(arena)) out.push({ arena, limit: Number.isInteger(limit) ? limit : 0 });
      }
    }
  } catch (e) {}
  arenasOf.cache = out.sort((x, y) => x.limit - y.limit);
  return out;
}

function arenaForTrophies(t) {
  let best = { arena: 1 };
  for (const a of arenasOf()) if (a.limit <= t) best = a;
  return best.arena;
}

function adminSet() {
  const c = config.readMain();
  return new Set((Array.isArray(c.admins) ? c.admins : []).map(Number));
}

function bannedSet() {
  const c = config.readMain();
  return new Set((Array.isArray(c.banned_ids) ? c.banned_ids : []).map(Number));
}

/* ---- queries ---- */

function summarize(row) {
  const id = Number(row.Id);
  const home = unwrapHome(row.Home);
  if (!home) return { id, name: "(unparseable Home)" };
  return {
    id,
    name: home.name || `#${id}`,
    level: num(home.exp_level, 1),
    trophies: (home.arena && num(home.arena.trophies, 0)) || 0,
    gold: num(home.gold, 0),
    gems: num(home.diamonds, 0),
    sessions: sessionsList(row.Sessions).length,
    admin: adminSet().has(id),
    banned: bannedSet().has(id),
  };
}

async function list() {
  const conn = await getPool().getConnection();
  try {
    const rows = await conn.query("SELECT Id, Home, Sessions FROM `player` ORDER BY Id");
    return rows.map(summarize);
  } finally {
    conn.release();
  }
}

async function get(id) {
  const conn = await getPool().getConnection();
  try {
    const rows = await conn.query("SELECT Id, Home, Sessions FROM `player` WHERE Id = ?", [Number(id)]);
    if (!rows.length) throw Object.assign(new Error("Player not found"), { code: "NOT_FOUND" });
    return summarize(rows[0]);
  } finally {
    conn.release();
  }
}

async function patch(id, p) {
  p = p || {};
  const conn = await getPool().getConnection();
  try {
    const rows = await conn.query("SELECT Id, Home FROM `player` WHERE Id = ?", [Number(id)]);
    if (!rows.length) throw Object.assign(new Error("Player not found"), { code: "NOT_FOUND" });
    const home = unwrapHome(rows[0].Home);
    if (!home) throw new Error("Home JSON for this player could not be parsed");

    const applied = [];
    if ("name" in p) {
      const name = String(p.name).trim().slice(0, 30);
      if (name) {
        home.name = name;
        applied.push("name");
      }
    }
    if ("level" in p) {
      home.exp_level = Math.min(13, Math.max(1, Math.round(num(p.level, 1))));
      applied.push("level");
    }
    if ("gold" in p) {
      home.gold = intSafe(p.gold, 0);
      applied.push("gold");
    }
    if ("gems" in p) {
      home.diamonds = intSafe(p.gems, 0);
      applied.push("gems");
    }
    if ("trophies" in p) {
      const trophies = intSafe(p.trophies, 0);
      if (!home.arena || typeof home.arena !== "object") home.arena = {};
      home.arena.trophies = trophies;
      home.arena.arena = arenaForTrophies(trophies);
      applied.push("trophies");
    }

    const setParts = ["`Home` = ?"];
    const vals = [wrapHome(home)];
    if (applied.includes("trophies")) {
      setParts.push("`Trophies` = ?");
      vals.push(num(home.arena.trophies, 0));
    }
    vals.push(Number(id));
    await conn.query(`UPDATE \`player\` SET ${setParts.join(", ")} WHERE \`Id\` = ?`, vals);
    logs.log("app", `Player ${id}: applied ${applied.join(", ")}.`);
    requestReload(id);
    return { id: Number(id), applied };
  } finally {
    conn.release();
  }
}

async function setCards(id, action) {
  if (action !== "unlock" && action !== "max") throw new Error(`Unknown action: ${action}`);
  const conn = await getPool().getConnection();
  try {
    const rows = await conn.query("SELECT Id, Home FROM `player` WHERE Id = ?", [Number(id)]);
    if (!rows.length) throw Object.assign(new Error("Player not found"), { code: "NOT_FOUND" });
    const home = unwrapHome(rows[0].Home);
    if (!home) throw new Error("Home JSON for this player could not be parsed");
    const deck = Array.isArray(home.deck) ? home.deck : [];
    const catalog = catalogOf();
    for (const c of catalog) {
      let card = deck.find((d) => num(d.ClassId, -1) === c.ClassId && num(d.InstanceId, -1) === c.InstanceId);
      if (!card) {
        card = { ClassId: c.ClassId, InstanceId: c.InstanceId, Count: 0, Level: 0, IsNew: false };
        deck.push(card);
      }
      if (action === "max") card.Level = 13;
    }
    home.deck = deck;
    await conn.query("UPDATE `player` SET `Home` = ? WHERE `Id` = ?", [wrapHome(home), Number(id)]);
    logs.log("app", `Player ${id}: ${action === "max" ? "maxed" : "unlocked"} all ${catalog.length} cards.`);
    requestReload(id);
    return { id: Number(id), cards: catalog.length };
  } finally {
    conn.release();
  }
}

function setAdmin(id, admin) {
  const c = config.readMain();
  const set = adminSet();
  const n = Number(id);
  if (admin) set.add(n);
  else set.delete(n);
  c.admins = [...set];
  config.writeMain(c);
  logs.log("app", `Player ${id} is ${admin ? "now an admin" : "no longer an admin"} (config.json; restart main to apply).`);
  return { requiresRestart: true };
}

function setBanned(id, banned) {
  const c = config.readMain();
  const set = bannedSet();
  const n = Number(id);
  if (banned) set.add(n);
  else set.delete(n);
  c.banned_ids = [...set];
  config.writeMain(c);
  logs.log("app", `Player ${id} ${banned ? "banned" : "unbanned"} (config.json; restart main to apply).`);
  return { requiresRestart: true };
}

module.exports = { list, get, patch, setCards, setAdmin, setBanned };