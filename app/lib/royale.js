"use strict";

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { p, exists } = require("./paths");
const config = require("./config");
const logs = require("./logs");
const settings = require("./settings");
const { sleep, checkPortListening } = require("./util");

const PROC = {
  main: {
    name: "main",
    title: "Main Server (ClashRoyale)",
    dll: "ClashRoyale.dll",
    dir: () => p.mainServerDir,
    pidFile: () => path.join(p.appData, "main.pid"),
    dotnetBin: () => p.dotnetBin,
    port: () => config.readMain().server_port || 9339,
    readyOn: /Let's play ClashRoyale!/i,
  },
  battles: {
    name: "battles",
    title: "Battle Server (ClashRoyale.Battles)",
    dll: "ClashRoyale.Battles.dll",
    dir: () => p.battlesServerDir,
    pidFile: () => path.join(p.appData, "battles.pid"),
    dotnetBin: () => p.dotnetBin,
    port: () => 9449,
    // The battle server is only started when use_udp is enabled (Config tab →
    // Battle server). Its gameplay socket speaks UDP on 9449, so a TCP port probe
    // can never detect it; match the banner it prints once the socket is bound
    // instead. When use_udp is off the battles process is not needed at all —
    // matches run on the main server over the clients' existing TCP connection.
    readyOn: /Time to fight!/i,
  },
};

const procs = {
  main: { child: null, state: "stopped", ready: false },
  battles: { child: null, state: "stopped", ready: false },
};

// The battle server is only meaningful when the main server hands battles off to
// a UDP battle node (use_udp=true). With use_udp=false the main server simulates
// battles itself over the clients' existing TCP connection, so the battle server
// process is neither started nor waited on.
function battlesEnabled() {
  try {
    return !!config.readMain().use_udp;
  } catch (e) {
    return false;
  }
}

function treeKill(pid) {
  return new Promise((resolve) => {
    if (process.platform === "win32") {
      const { execFile } = require("child_process");
      execFile("taskkill", ["/pid", String(pid), "/t", "/f"], { windowsHide: true }, () => resolve());
    } else {
      try {
        process.kill(pid, "SIGTERM");
      } catch (e) {}
      setTimeout(() => {
        try {
          process.kill(pid, "SIGKILL");
        } catch (e) {}
        resolve();
      }, 2500);
    }
  });
}

function pidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}

function writePid(name, pid) {
  try {
    fs.writeFileSync(PROC[name].pidFile(), String(pid));
  } catch (e) {}
}

function readPid(name) {
  try {
    return parseInt(fs.readFileSync(PROC[name].pidFile(), "utf8"), 10);
  } catch (e) {
    return null;
  }
}

function spawnProc(name) {
  const info = PROC[name];
  const rec = procs[name];
  const dll = path.join(info.dir(), info.dll);
  const dotnet = p.dotnetBin;
  if (!exists(dll)) {
    logs.log(name, `${info.title}: binary not found (${dll}). Run the launcher Install step first.`);
    rec.state = "error";
    return { ok: false, error: "Missing server binary. Run Install first." };
  }
  if (!exists(dotnet)) {
    logs.log(name, `${info.title}: .NET not found (${dotnet}). Run Install first.`);
    rec.state = "error";
    return { ok: false, error: "Missing .NET runtime. Run Install first." };
  }
  rec.state = "starting";
  rec.ready = false;
  // Remember where the log history ends right now so waitReady only inspects
  // lines produced by THIS spawn (on restart the old instance's "ready" banner
  // is still in the buffer and would otherwise match instantly).
  rec.watchFrom = logs.history(name).length;
  const c = spawn(dotnet, [info.dll], {
    cwd: info.dir(),
    windowsHide: true,
  });
  rec.child = c;
  writePid(name, c.pid);
  logs.log(name, `-- ${info.title} starting (pid ${c.pid}) --`);
  logs.attachChild(name, c);
  c.once("error", (err) => {
    logs.log(name, `${info.title} failed to start: ${err.message}`);
    rec.state = "error";
    rec.child = null;
  });
  c.once("exit", (code, sig) => {
    if (rec.child === c) {
      rec.child = null;
      rec.ready = false;
      rec.state = "stopped";
      logs.log(name, `${info.title} exited (code ${code}${sig ? " " + sig : ""}).`);
    }
  });
  return { ok: true };
}

async function waitReady(name, timeoutMs = 30000) {
  const info = PROC[name];
  const rec = procs[name];
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (info.readyOn) {
      let matched = false;
      try {
        const buf = logs.history(name);
        const watch = typeof rec.watchFrom === "number" ? buf.slice(rec.watchFrom) : buf;
        const tail = watch.map((l) => l.text).slice(-40).join("\n");
        matched = info.readyOn.test(tail);
      } catch (e) {}
      if (matched) {
        rec.ready = true;
        return true;
      }
    } else {
      const listening = await checkPortListening(info.port(), "127.0.0.1", 300);
      if (listening) {
        rec.ready = true;
        return true;
      }
    }
    if (!rec.child) {
      // process died while waiting
      if (rec.state !== "error") rec.state = "stopped";
      return false;
    }
    await sleep(700);
  }
  return false;
}

const LANG_DEFAULTS = {
  PlayerJoined: "Player %PlayerName joined the server",
  PlayerDisconnected: "Player %PlayerName disconnected",
  StartingServer: "Server is starting, please wait",
  ShuttingDownServer: "Server is shutting down, sorry for inconvenience",
  BattleStarted: "Battle with id %id started",
  BattleEnded: "Battle with id %id ended",
  PlayerJoinedBattle: "Player %username joined battle with id %id",
};

function ensureLang() {
  // The main server exits on first run when lang.json is missing (it tries to
  // block on a console keypress). Pre-create it so first boot is clean.
  const f = path.join(p.mainServerDir, "lang.json");
  if (!exists(f)) {
    try {
      fs.writeFileSync(f, JSON.stringify(LANG_DEFAULTS, null, 2));
    } catch (e) {}
  }
}

async function start(name) {
  const rec = procs[name];
  if (name === "battles" && !battlesEnabled()) {
    // Matches run on the main server when the battle server is disabled; never
    // spawn a process that would just sit retrying the cluster connection.
    rec.state = "disabled";
    rec.ready = false;
    logs.log("battles", "Battle server is disabled (use_udp=false) — matches run on the main server. Process not started.");
    return { ok: true, state: "disabled", enabled: false };
  }
  if (rec.child && rec.child.exitCode === null) {
    return { ok: true, state: rec.state };
  }
  if (name === "main") config.ensureMainConfig();
  if (name === "battles") config.ensureBattlesConfig();
  if (name === "main") ensureLang();
  const r = spawnProc(name);
  if (!r.ok) return r;
  await waitReady(name, 45000);
  rec.state = rec.ready ? "running" : "starting";
  return { ok: true, state: rec.state, ready: rec.ready };
}

async function stop(name) {
  const rec = procs[name];
  const pid = rec.child ? rec.child.pid : readPid(name);
  if (rec.child) {
    rec.child.removeAllListeners("exit");
    rec.child = null;
  }
  if (pid && pidAlive(pid)) {
    logs.log(name, `Stopping ${PROC[name].title} (pid ${pid})...`);
    await treeKill(pid);
  }
  rec.state = "stopped";
  rec.ready = false;
  try {
    fs.unlinkSync(PROC[name].pidFile());
  } catch (e) {}
  return { ok: true, state: rec.state };
}

async function restart(name) {
  await stop(name);
  await sleep(600);
  return start(name);
}

async function status() {
  const out = {};
  for (const name of ["main", "battles"]) {
    const rec = procs[name];
    const enabled = name === "battles" ? battlesEnabled() : true;
    const pid = rec.child ? rec.child.pid : readPid(name);
    const alive = rec.child ? rec.child.exitCode === null : pidAlive(pid);
    let running = !!(rec.child && rec.child.exitCode === null);
    if (!running && alive && !rec.child) {
      // adopted an orphaned pid; mark as external-running (unknown)
      running = true;
      rec.state = "orphan";
    }
    let state = running ? (rec.ready ? "running" : "starting") : rec.state;
    if (name === "battles" && !enabled && !running) state = "disabled";
    out[name] = {
      state,
      running,
      ready: running ? rec.ready : false,
      pid: running ? pid : null,
      port: PROC[name].port(),
      installed: exists(path.join(PROC[name].dir(), PROC[name].dll)),
      enabled,
    };
  }
  return out;
}

function running(name) {
  const rec = procs[name];
  return !!(rec && rec.child && rec.child.exitCode === null);
}

function shutdown() {
  for (const name of ["main", "battles"]) {
    const rec = procs[name];
    if (rec.child && rec.child.exitCode === null) {
      try {
        rec.child.kill();
      } catch (e) {}
    }
  }
}

async function autoStart() {
  const s = settings.get();
  if (!s.autoStartServices) return;
  logs.log("app", "auto-start: ensuring database...");
  const db = require("./db");
  try {
    await db.start();
  } catch (e) {
    logs.log("app", `auto-start database error: ${e.message}`);
    return;
  }
  logs.log("app", "auto-start: starting game servers...");
  await start("main").catch((e) => logs.log("main", `start error: ${e.message}`));
  await sleep(800);
  await start("battles").catch((e) => logs.log("battles", `start error: ${e.message}`));
}

module.exports = { start, stop, restart, status, running, shutdown, autoStart, battlesEnabled, procs };