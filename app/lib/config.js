"use strict";

const fs = require("fs");
const path = require("path");
const { p, exists } = require("./paths");
const settings = require("./settings");
const { readJson } = require("./util");

const MAIN_DEFAULTS = {
  cluster_encryption_key: "15uvmi8qnyuj9tm53ipaavvytltm582yatecyjzb",
  cluster_encryption_nonce: "nonce",
  cluster_server_port: 9876,
  encryption_key: "fhsd6f86f67rt8fw78fw789we78r9789wer6re",
  mysql_database: "rrdb",
  mysql_password: "",
  mysql_server: "127.0.0.1",
  mysql_user: "root",
  patch_url: "",
  sentry_api: "",
  server_port: 9339,
  server_address: "",
  update_url: "",
  use_content_patch: false,
  MinTrophies: 0,
  MaxTrophies: 0,
  DefaultGold: 0,
  DefaultGems: 0,
  DefaultLevel: 1,
  // On by default: matches run on the separate battle server (see scripts/publish.js).
  use_udp: true,
  GemsToGiveAfterMatch: 0,
  GoldToGiveAfterMatch: 0,
  admins: [],
  banned_ids: [],
};

const BATTLES_DEFAULTS = {
  battle_nonce: "nonce",
  cluster_encryption_key: "15uvmi8qnyuj9tm53ipaavvytltm582yatecyjzb",
  cluster_encryption_nonce: "nonce",
  max_sessions: 100,
  sentry_api: "",
  server_port: 9449,
};

function mainFile() {
  return path.join(p.mainServerDir, "config.json");
}

function battlesFile() {
  return path.join(p.battlesServerDir, "config.json");
}

function buildMain() {
  const s = settings.get();
  const cfg = {
    ...MAIN_DEFAULTS,
    mysql_server: s.db.host,
    mysql_user: s.db.user,
    mysql_password: s.db.password,
    mysql_database: s.db.database,
    server_address: s.serverAddress,
  };
  const prev = readJson(mainFile(), {});
  for (const [k, v] of Object.entries(prev)) {
    if (k in cfg && (Array.isArray(v) || v !== cfg[k])) cfg[k] = v;
  }
  return cfg;
}

function buildBattles() {
  const s = settings.get();
  const prev = readJson(battlesFile(), {});
  return {
    ...BATTLES_DEFAULTS,
    cluster_encryption_key: prev.cluster_encryption_key || "15uvmi8qnyuj9tm53ipaavvytltm582yatecyjzb",
    cluster_encryption_nonce: prev.cluster_encryption_nonce || "nonce",
    battle_nonce: prev.battle_nonce || "nonce",
    server_port: prev.server_port || 9449,
    max_sessions: prev.max_sessions || 100,
  };
}

function ensureMainConfig() {
  if (!exists(mainFile())) {
    fs.writeFileSync(mainFile(), JSON.stringify(buildMain(), null, 2));
  }
  const cfg = readJson(mainFile(), buildMain());
  // Backfill the client-reachable host so the UDP battle path never advertises a
  // loopback/empty host on configs that predate the server_address field.
  if (!cfg.server_address) {
    cfg.server_address = settings.get().serverAddress;
    fs.writeFileSync(mainFile(), JSON.stringify(cfg, null, 2));
  }
  return cfg;
}

function ensureBattlesConfig() {
  if (!exists(battlesFile())) {
    fs.writeFileSync(battlesFile(), JSON.stringify(buildBattles(), null, 2));
  }
  return readJson(battlesFile(), buildBattles());
}

function readMain() {
  const cfg = readJson(mainFile(), buildMain());
  // The client-reachable host lives in the panel settings; keep it in the main
  // server config so the UDP battle path advertises a reachable host (falling
  // back to the node's own address when the key is missing).
  if (!cfg.server_address) cfg.server_address = settings.get().serverAddress;
  return cfg;
}

function readBattles() {
  return readJson(battlesFile(), buildBattles());
}

function writeMain(cfg) {
  fs.writeFileSync(mainFile(), JSON.stringify(cfg, null, 2));
  return cfg;
}

function writeBattles(cfg) {
  fs.writeFileSync(battlesFile(), JSON.stringify(cfg, null, 2));
  return cfg;
}

const existsMain = () => exists(mainFile());
const existsBattles = () => exists(battlesFile());
const ensureMain = () => ensureMainConfig();
const ensureBattles = () => ensureBattlesConfig();

module.exports = {
  mainFile,
  battlesFile,
  MAIN_DEFAULTS,
  BATTLES_DEFAULTS,
  buildMain,
  buildBattles,
  ensureMainConfig,
  ensureBattlesConfig,
  existsMain,
  existsBattles,
  ensureMain,
  ensureBattles,
  readMain,
  readBattles,
  writeMain,
  writeBattles,
};