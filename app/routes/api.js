"use strict";

const express = require("express");
const { p } = require("../lib/paths");
const settings = require("../lib/settings");
const db = require("../lib/db");
const royale = require("../lib/royale");
const config = require("../lib/config");
const gamefiles = require("../lib/gamefiles");
const apk = require("../lib/apk");
const logs = require("../lib/logs");
const dbview = require("../lib/dbview");
const activity = require("../lib/activity");
const players = require("../lib/players");

const router = express.Router();
router.use(express.json({ limit: "50mb" }));

let stackState = "idle";

function wrap(fn) {
  return async (req, res) => {
    try {
      res.json(await fn(req, res));
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  };
}

router.get("/health", (req, res) => res.json({ ok: true }));

router.get("/status", wrap(async () => {
  const safe = (fn, def) => {
    try {
      return fn();
    } catch (e) {
      return def;
    }
  };
  const [dbStatus, servers, apkStatus] = await Promise.all([
    db.status(),
    royale.status(),
    apk.status().catch(() => null),
  ]);
  return {
    ok: true,
    stack: { state: stackState },
    db: dbStatus,
    servers,
    apk: apkStatus,
    installed: {
      dotnet: require("fs").existsSync(p.dotnetBin),
      jdk: require("fs").existsSync(p.jarsigner),
      mariadb: require("fs").existsSync(p.mariadbd),
      main: require("fs").existsSync(p.mainDll),
      battles: require("fs").existsSync(p.battlesDll),
      clone: require("fs").existsSync(p.cloneDir),
    },
    settings: { serverAddress: settings.get().serverAddress },
    configs: {
      main: safe(() => (config.existsMain() ? config.readMain() : null)),
      battles: safe(() => (config.existsBattles() ? config.readBattles() : null)),
    },
  };
}));

// ---- server address (baked into the client APK) ----
router.get("/settings/localip", wrap(async () => ({ ok: true, address: settings.localIp() })));

router.post("/settings/address", wrap(async (req) => {
  const { address } = req.body || {};
  const a = String(address || "").trim();
  if (a.length > 23) throw new Error("Address must be 24 characters or fewer.");
  const s = settings.get();
  s.serverAddress = a;
  settings.save(s);
  return { ok: true, serverAddress: a };
}));

// ---- main server config (game knobs like trophy rewards) ----
const CONFIG_NUMERIC = [
  "MinTrophies", "MaxTrophies", "DefaultGold", "DefaultGems", "DefaultLevel",
  "GemsToGiveAfterMatch", "GoldToGiveAfterMatch", "server_port", "cluster_server_port",
];

router.get("/config/main", wrap(async () => ({ ok: true, config: config.readMain() })));

router.post("/config/main", wrap(async (req) => {
  const body = req.body || {};
  const cfg = body.config;
  if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) throw new Error("config object required");
  const cur = config.readMain();
  const merged = { ...cur };
  for (const [k, v] of Object.entries(cfg)) {
    if (CONFIG_NUMERIC.includes(k)) {
      const n = typeof v === "number" ? v : Number(v);
      if (!Number.isFinite(n)) throw new Error(`"${k}" must be a number`);
      merged[k] = n;
    } else if (k in cur) {
      merged[k] = v;
    }
  }
config.writeMain(merged);
  return { ok: true, config: merged };
}));

// ---- player editor ----
router.get("/players", wrap(async () => ({ ok: true, players: await players.list() })));

router.post("/players/:id", wrap(async (req) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) throw new Error("invalid player id");
  const body = req.body || {};
  const out = { ok: true, requiresRestart: false, applied: [] };
  if (body.admin != null) {
    players.setAdmin(id, !!body.admin);
    out.requiresRestart = true;
    out.applied.push("admin");
  }
  if (body.banned != null) {
    players.setBanned(id, !!body.banned);
    out.requiresRestart = true;
    out.applied.push("banned");
  }
  if (body.patch && typeof body.patch === "object") {
    const r = await players.patch(id, body.patch);
    out.applied.push(...r.applied);
  }
  if (body.cards) {
    const r = await players.setCards(id, body.cards);
    out.applied.push(`cards:${body.cards} (${r.cards})`);
  }
out.player = await players.get(id);
  return out;
}));

// ---- one-click stack: database -> main server -> battle server ----
router.post("/stack/start", wrap(async () => {
  if (["starting", "stopping"].includes(stackState)) throw new Error("A stack operation is already in progress.");
  stackState = "starting";
  logs.clear();
  try {
    logs.log("app", "=== Starting server stack (database -> main -> battles) ===");
    const r = {};
    r.db = await db.start();
    logs.log("app", "Database ready.");
    r.main = await royale.start("main");
    r.battles = await royale.start("battles");
    stackState = "running";
    logs.log("app", "=== Server stack is up ===");
    activity.start();
    return { ok: true, stack: stackState, ...r };
  } catch (e) {
    stackState = "error";
    activity.stop();
    logs.log("app", `Stack start failed: ${e.message}`);
    return { ok: false, error: e.message };
  }
}));

router.post("/stack/stop", wrap(async () => {
  if (["starting", "stopping"].includes(stackState)) throw new Error("A stack operation is already in progress.");
  stackState = "stopping";
  try {
    logs.log("app", "=== Stopping server stack (battles -> main -> database) ===");
    await royale.stop("battles");
    await royale.stop("main");
    await db.stop();
    activity.stop();
    stackState = "stopped";
    logs.log("app", "=== Server stack stopped ===");
    return { ok: true, stack: stackState };
  } catch (e) {
    stackState = "error";
    logs.log("app", `Stack stop failed: ${e.message}`);
    return { ok: false, error: e.message };
  }
}));

router.post("/stack/restart", wrap(async () => {
  if (["starting", "stopping"].includes(stackState)) throw new Error("A stack operation is already in progress.");
  stackState = "starting";
  try {
    logs.log("app", "=== Restarting server stack (stop all, then database -> main -> battles) ===");
    await royale.stop("battles");
    await royale.stop("main");
    await db.stop();
    activity.stop();
    logs.log("app", "=== Bringing the stack back up ===");
    await db.start();
    await royale.start("main");
    await royale.start("battles");
    stackState = "running";
    logs.log("app", "=== Server stack restarted ===");
    activity.start();
    return { ok: true, stack: stackState };
  } catch (e) {
    stackState = "error";
    activity.stop();
    logs.log("app", `Stack restart failed: ${e.message}`);
    return { ok: false, error: e.message };
  }
}));

router.get("/stack/status", wrap(async () => {
  const s = await royale.status();
  const d = await db.status();
  return { ok: true, stack: stackState, db: d, servers: s };
}));

// ---- low-level endpoints (used by the stack; also available for scripting) ----
router.post("/db/start", wrap(async () => {
  const r = await db.start();
  return { ok: true, ...r };
}));
router.post("/db/stop", wrap(async () => {
  const r = await db.stop();
  return { ok: true, ...r };
}));
router.get("/db/status", wrap(async () => ({ ok: true, ...(await db.status()) })));

router.post("/server/:name/:action", wrap(async (req) => {
  const name = req.params.name;
  const action = req.params.action;
  if (!["main", "battles"].includes(name)) throw new Error("unknown server");
  let r;
  if (action === "start") r = await royale.start(name);
  else if (action === "stop") r = await royale.stop(name);
  else if (action === "restart") r = await royale.restart(name);
  else throw new Error("unknown action");
  return { ok: true, name, action, ...r };
}));

// ---- database browser / editor ----
router.get("/dbview/tables", wrap(async () => {
  try {
    const list = await dbview.tables();
    return { ok: true, tables: list };
  } catch (e) {
    return { ok: false, tables: [], error: dbview.dbError(e) };
  }
}));

router.get("/dbview/table/:table", wrap(async (req) => {
  const { table } = req.params;
  const limit = Number(req.query.limit) || 100;
  const offset = Number(req.query.offset) || 0;
  try {
    const data = await dbview.page(table, limit, offset);
    return { ok: true, ...data };
  } catch (e) {
    return { ok: false, error: dbview.dbError(e) };
  }
}));

router.post("/dbview/query", wrap(async (req) => {
  const { sql } = req.body || {};
  try {
    const r = await dbview.runSql(sql);
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, error: dbview.dbError(e) };
  }
}));

router.post("/dbview/update", wrap(async (req) => {
  const { table, pk, set } = req.body || {};
  try {
    const r = await dbview.updateRow(table, pk, set);
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, error: dbview.dbError(e) };
  }
}));

// ---- game data ----
router.get("/gamefiles", (req, res) => {
  const logic = gamefiles.csvList("csv_logic");
  const client = gamefiles.csvList("csv_client");
  res.json({ ok: true, csv_logic: logic, csv_client: client });
});

router.post("/gamefiles/restore", wrap(async () => {
  gamefiles.restoreAll();
  return { ok: true };
}));

router.get("/gamefiles/diff", (req, res) => {
  const changed = gamefiles.pristineVsPublishDiff();
  res.json({ ok: true, changed });
});

router.get("/gamefiles/:file(*)", wrap(async (req) => {
  const rel = req.params.file + (req.params.file.toLowerCase().endsWith(".csv") ? "" : ".csv");
  const data = gamefiles.readCsv(rel);
  return { ok: true, file: rel, ...data };
}));

router.post("/gamefiles/:file(*)", wrap(async (req) => {
  const rel = req.params.file + (req.params.file.toLowerCase().endsWith(".csv") ? "" : ".csv");
  const payload = req.body || {};
  if (!payload.headers || !Array.isArray(payload.headers)) throw new Error("missing headers");
  gamefiles.writeCsv(rel, payload);
  return { ok: true, file: rel };
}));

// ---- APK builder ----
router.post("/apk/build", wrap(async (req) => {
  const body = req.body || {};
  return await apk.build(body);
}));

router.post("/apk/original", wrap(async (req) => {
  const body = req.body || {};
  return await apk.restoreOriginal({ outputPath: body.outputPath });
}));

router.get("/apk/status", wrap(async () => ({ ok: true, ...(await apk.status()) })));

// ---- logs ----
router.get("/logs", (req, res) => {
  const out = {};
  for (const name of logs.names()) out[name] = logs.history(name);
  res.json({ ok: true, logs: out });
});

// NOTE: /logs/all/stream MUST be registered before /logs/:proc/stream,
// otherwise "all" is captured as the :proc parameter.
router.get("/logs/all/stream", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  for (const name of logs.names()) {
    for (const line of logs.history(name)) send({ type: "line", source: name, line });
  }
  const onLine = (name, line) => send({ type: "line", source: name, line });
  const onClear = () => send({ type: "clear" });
  logs.on("line", onLine);
  logs.on("clear", onClear);
  const heartbeat = setInterval(() => send({ type: "ping" }), 25000);
  req.on("close", () => {
    clearInterval(heartbeat);
    logs.removeListener("line", onLine);
    logs.removeListener("clear", onClear);
  });
});

// single-process stream: only lines emitted under the requested source name
router.get("/logs/:proc/stream", (req, res) => {
  const name = req.params.proc;
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  for (const line of logs.history(name)) send({ type: "line", source: name, line });
  const onLine = (n, line) => {
    if (n === name) send({ type: "line", source: name, line });
  };
  const onClear = () => {
    if (name === "all") {
      send({ type: "clear" });
    } else {
      send({ type: "clear", source: name });
    }
  };
  logs.on("line", onLine);
  logs.on("clear", onClear);
  const heartbeat = setInterval(() => send({ type: "ping" }), 25000);
  req.on("close", () => {
    clearInterval(heartbeat);
    logs.removeListener("line", onLine);
    logs.removeListener("clear", onClear);
  });
});

module.exports = router;