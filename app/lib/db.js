"use strict";

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { p, exists } = require("./paths");
const settings = require("./settings");
const logs = require("./logs");
const { sleep, execFile, checkPortListening } = require("./util");

let child = null;
let state = "unknown";

function installed() {
  return exists(p.mariadbd) && exists(p.mariadbInstallDb);
}

function bin() {
  return {
    mariadbd: p.mariadbd,
    installDb: p.mariadbInstallDb,
    client: p.mariadbClient,
  };
}

function dataInitialized() {
  const sys = path.join(p.mariadbData, process.platform === "win32" ? "mysql" : "mysql");
  return exists(sys);
}

function _spawnMariadbd() {
  return new Promise((resolve, reject) => {
    const db = settings.get().db;
    const args = [
      `--datadir=${p.mariadbData}`,
      `--port=${db.port}`,
      "--bind-address=127.0.0.1",
      "--skip-networking=0",
      "--console",
      `--socket=${path.join(p.mariadbData, "mysql.sock")}`,
      `--pid-file=${path.join(p.mariadbData, "mariadb.pid")}`,
      `--log-error=${path.join(p.mariadbData, "error.log")}`,
    ];
    const c = spawn(p.mariadbd, args, {
      cwd: p.mariadbData,
      windowsHide: true,
    });
    child = c;
    logs.log("db", `-- mariadbd starting (pid ${c.pid}, port ${db.port}) --`);
    logs.attachChild("db", c);
    let settled = false;
    c.stdout && c.stdout.once("data", () => settle(true));
    c.once("error", (err) => {
      logs.log("db", `mariadbd failed to launch: ${err.message}`);
      settle(false, err);
    });
    c.once("exit", (code) => {
      if (child === c) child = null;
      logs.log("db", `mariadbd exited (code ${code})`);
      if (!settled) settle(false, new Error("mariadbd exited early"));
    });
    function settle(ok, err) {
      if (settled) return;
      settled = true;
      if (ok) resolve();
      else reject(err);
    }
    setTimeout(() => settle(true), 5000);
  });
}

async function waitReady(dbPort, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await checkPortListening(dbPort, "127.0.0.1", 500)) return true;
    await sleep(700);
  }
  return false;
}

async function runClient(args, stdin) {
  const opts = settings.get().db;
  const clientArgs = ["-h127.0.0.1", `-P${opts.port}`, "-u", opts.user];
  if (opts.password) clientArgs.push(`-p${opts.password}`);
  clientArgs.push("--binary-mode=1");
  clientArgs.push(...args);
  return new Promise((resolve, reject) => {
    const c = spawn(p.mariadbClient, clientArgs, { windowsHide: true });
    let out = "";
    let err = "";
    c.stdout.on("data", (d) => (out += d.toString()));
    c.stderr.on("data", (d) => (err += d.toString()));
    if (stdin) stdin.pipe(c.stdin);
    else c.stdin.end();
    c.once("error", (e) => reject(e));
    c.once("close", (code) => {
      if (code === 0) resolve({ out, err });
      else {
        const e = new Error("mysql client exited " + code);
        e.stdout = out;
        e.stderr = err;
        reject(e);
      }
    });
  });
}

async function bootstrapDb() {
  // Windows requires bootstrapping the data directory directly (mariadb-install-db
  // needs Service Control Manager access, i.e. an elevated shell). This mirrors
  // what mariadb-install-db.sh does under the hood: it feeds the system table
  // DDL/DML scripts to `mariadbd --bootstrap` via stdin, in a fixed order.
  const names = [
    "mysql_system_tables.sql",
    "mysql_system_tables_data.sql",
    "mysql_performance_tables.sql",
    "maria_add_gis_sp_bootstrap.sql",
    "mysql_test_data_timezone.sql",
    "fill_help_tables.sql",
  ];
  const chunks = [
    "CREATE DATABASE IF NOT EXISTS mysql CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;",
    "USE mysql;",
  ];
  for (const n of names) {
    const f = path.join(p.mariadbDir, "share", n);
    if (!exists(f)) {
      logs.log("db", `bootstrap: missing ${f}`);
      continue;
    }
    chunks.push(fs.readFileSync(f, "utf8"));
  }
  logs.log("db", "Bootstrapping MariaDB data directory (mariadbd --bootstrap)...");
  return new Promise((resolve, reject) => {
    const c = spawn(
      p.mariadbd,
      [
        "--no-defaults",
        "--bootstrap",
        `--basedir=${p.mariadbDir}`,
        `--datadir=${p.mariadbData}`,
      ],
      { cwd: p.mariadbDir, windowsHide: true }
    );
    let err = "";
    c.stderr.on("data", (d) => (err += d.toString()));
    c.once("error", (e) => reject(e));
    c.once("close", (code) => {
      if (code === 0) resolve();
      else {
        logs.log("db", `mariadbd --bootstrap failed (code ${code}): ${err.slice(-1000)}`);
        reject(new Error("mariadb bootstrap failed"));
      }
    });
    c.stdin.end(chunks.join("\n"));
  });
}

async function initDb() {
  const db = settings.get().db;
  fs.mkdirSync(p.mariadbData, { recursive: true });
  if (!dataInitialized()) {
    logs.log("db", "Initializing MariaDB data directory...");
    const installArgs = [`--datadir=${p.mariadbData}`];
    try {
      if (process.platform === "win32") {
        await bootstrapDb();
      } else {
        await execFile(
          p.mariadbInstallDb,
          [...installArgs, "--auth-root-authentication-method=normal"],
          {}
        );
      }
    } catch (e) {
      logs.log("db", `mariadb-install-db failed: ${e.message || e}`);
      throw new Error("Unable to initialize MariaDB data directory");
    }
  }
  if (child) {
    // already running after install? no
  }
  await _spawnMariadbd();
  if (!(await waitReady(db.port))) {
    throw new Error(`MariaDB did not become ready on port ${db.port}`);
  }
  try {
    // set root password and create database
    const sql = [];
    sql.push(`SET PASSWORD FOR 'root'@'localhost' = PASSWORD('${db.password.replace(/'/g, "''")}');`);
    sql.push(`CREATE DATABASE IF NOT EXISTS \`${db.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;`);
    await runClient(["-e", sql.join("")]).catch((e) => {
      logs.log("db", `setup statements failed: ${e.stderr || e.message}`);
      throw e;
    });
    const sqlPath = p.databaseSql;
    if (sqlPath && exists(sqlPath)) {
      logs.log("db", `Importing schema (${path.basename(sqlPath)})...`);
      await runClient([`-D${db.database}`], fs.createReadStream(sqlPath));
      logs.log("db", "Database schema imported.");
    }
  } catch (e) {
    logs.log("db", `Database setup failed: ${e.message}`);
    throw e;
  }
}

async function start() {
  if (state === "running") return { ok: true, state };
  if (!installed()) {
    state = "uninstalled";
    return { ok: false, error: "MariaDB is not installed. Run the launcher Install step first." };
  }
  state = "starting";
  const db = settings.get().db;
  const busy = await checkPortListening(db.port, "127.0.0.1", 500);
  if (busy && !child) {
    state = "running";
    const err = new Error(
      `Port ${db.port} is already in use by another MySQL/MariaDB instance. We did not start our own.`
    );
    logs.log("db", err.message);
    err.external = true;
    throw err;
  }
  try {
    if (!dataInitialized()) {
      await initDb();
    } else {
      await _spawnMariadbd();
      if (!(await waitReady(db.port))) {
        throw new Error(`MariaDB did not become ready on port ${db.port}`);
      }
    }
    state = "running";
    logs.log("db", `MariaDB is ready on 127.0.0.1:${db.port} (database "${db.database}").`);
    return { ok: true, state };
  } catch (e) {
    state = "failed";
    throw e;
  }
}

async function stop() {
  if (!child) {
    state = "stopped";
    return { ok: true, state };
  }
  return new Promise((resolve) => {
    const c = child;
    child = null;
    c.once("exit", () => {
      state = "stopped";
      logs.log("db", "MariaDB stopped.");
      resolve({ ok: true, state });
    });
    c.kill();
    setTimeout(() => {
      if (state !== "stopped") {
        try {
          c.kill("SIGKILL");
        } catch (e) {}
      }
    }, 4000);
  });
}

async function status() {
  if (child) {
    state = "running";
    return {
      installed: installed(),
      state,
      ready: true,
      running: true,
      polling: false,
      pid: child.pid,
      port: settings.get().db.port,
    };
  }
  const db = settings.get().db;
  const listening = await checkPortListening(db.port, "127.0.0.1", 500);
  const runningFx = listening;
  state = runningFx ? "running-external" : installed() ? "stopped" : "uninstalled";
  return {
    installed: installed(),
    state,
    ready: runningFx,
    running: runningFx,
    polling: false,
    pid: null,
    port: db.port,
  };
}

function shutdown() {
  if (child) {
    try {
      child.kill();
    } catch (e) {}
  }
}

module.exports = { start, stop, status, initDb, installed, bin, shutdown, dataInitialized };