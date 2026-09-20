"use strict";

const $ = (id) => document.getElementById(id);

async function getJSON(url) {
  const r = await fetch(url);
  const j = await r.json();
  if (!r.ok || (j && j.ok === false)) throw new Error((j && j.error) || r.statusText);
  return j;
}
async function postJSON(url, body, timeoutMs) {
  const ctrl = new AbortController();
  const timer = timeoutMs ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
      signal: ctrl.signal,
    });
    const j = await r.json();
    if (!r.ok || (j && j.ok === false)) throw new Error((j && j.error) || r.statusText);
    return j;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function toast(msg) {
  let t = $("toast");
  if (!t) {
    t = document.createElement("div");
    t.id = "toast";
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), 4000);
}

const state = {
  status: null,
  csv: null,
  apkRunning: false,
};

/* ---------------- tabs ---------------- */
document.querySelectorAll("#tabs .tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#tabs .tab").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    document.querySelectorAll("main .panel").forEach((p) => p.classList.remove("active"));
    $("tab-" + btn.dataset.tab).classList.add("active");
  });
});

/* ---------------- server tab ---------------- */
function pill(name, ok, label) {
  const el = $("pill-" + name);
  const dot = el.querySelector(".dot");
  dot.className = "dot " + (ok ? "on" : "off");
  el.textContent = "";
  el.appendChild(dot);
  el.appendChild(document.createTextNode(" " + label));
}

function renderStatus() {
  const st = state.status;
  if (!st) return;
  const { servers, db } = st;
  const mainRunning = !!(servers && servers.main && servers.main.running);
  const battlesRunning = !!(servers && servers.battles && servers.battles.running);
  const dbUp = !!(db && (db.ready || db.running));
  const anyUp = mainRunning || battlesRunning || dbUp;

  pill("db", dbUp, "Database");
  pill("main", mainRunning, "Main server");
  pill("battles", battlesRunning, "Battle server");

  const btn = $("btn-stack");
  btn.textContent = anyUp ? "Stop server" : "Start server";
  btn.classList.toggle("danger", anyUp);

  const conn = st.settings && st.settings.serverAddress;
  const addrInput = $("conn-address");
  if (document.activeElement !== addrInput) addrInput.value = conn || "";

  const inst = st.installed || {};
  const missing = [];
  if (!inst.dotnet) missing.push(".NET");
  if (!inst.mariadb) missing.push("MariaDB");
  if (!inst.jdk) missing.push("JDK");
  if (!inst.main || !inst.battles) missing.push("server binaries");
  $("install-note").textContent =
    missing.length
      ? "Missing: " + missing.join(", ") + ". Run the launcher Install step first."
      : "All components installed.";

  $("head-status").textContent =
    mainRunning && battlesRunning ? "running" : anyUp ? "starting…" : "stopped";
  $("head-status").className = "head-status " + (mainRunning && battlesRunning ? "on" : "off");
}

async function refreshStatus() {
  try {
    state.status = await getJSON("/api/status");
    renderStatus();
  } catch (e) {
    $("head-status").textContent = "offline";
  }
}

let stackBusy = false;

$("btn-stack").addEventListener("click", async () => {
  const btn = $("btn-stack");
  const st = state.status;
  const anyUp = !!(st && (
    (st.servers && st.servers.main.running) ||
    (st.servers && st.servers.battles.running) ||
    (st.db && (st.db.ready || st.db.running))
  ));
  const action = anyUp ? "stop" : "start";
  if (stackBusy) return;
  stackBusy = true;
  btn.classList.add("busy");
  btn.textContent = action === "start" ? "Starting…" : "Stopping…";
  try {
    const j = await postJSON("/api/stack/" + action, {}, 120000);
    if (j && j.ok === false) toast(j.error);
  } catch (e) {
    toast(e.name === "AbortError" ? "The operation timed out; check the Logs tab." : e.message);
  } finally {
    stackBusy = false;
    btn.classList.remove("busy");
    await refreshStatus();
  }
});

async function saveServerAddress() {
  const input = $("conn-address");
  const a = input.value.trim();
  if (input.value !== a) input.value = a;
  if (a.length > 23) return toast("Keep the address under 24 characters.");
  try {
    const j = await postJSON("/api/settings/address", { address: a });
    if (j.ok === false) return toast(j.error || "failed");
    toast("Server address saved.");
    await refreshStatus();
  } catch (e) {
    toast(e.message);
  }
}

$("conn-address").addEventListener("change", saveServerAddress);
$("conn-address").addEventListener("keydown", (e) => {
  if (e.key === "Enter") e.target.blur();
});

$("btn-local-ip").addEventListener("click", async () => {
  try {
    const j = await getJSON("/api/settings/localip");
    $("conn-address").value = j.address;
    await saveServerAddress();
  } catch (e) {
    toast(e.message);
  }
});

/* ---------------- csv tab ---------------- */
async function loadFileList() {
  const j = await getJSON("/api/gamefiles");
  $("cfiles").innerHTML = "";
  const groups = [
    ["csv_logic", "Game data (csv_logic)"],
    ["csv_client", "Client data (csv_client)"],
  ];
  for (const [key, label] of groups) {
    const list = j[key] || [];
    if (!list.length) continue;
    const g = document.createElement("optgroup");
    g.label = label;
    for (const f of list) {
      const opt = document.createElement("option");
      opt.value = f.file;
      opt.textContent = f.name;
      g.appendChild(opt);
    }
    $("cfiles").appendChild(g);
  }
  if (j.csv_logic.some((f) => f.file === "csv_logic/characters.csv")) {
    $("cfiles").value = "csv_logic/characters.csv";
  }
}

function updateCsvMeta() {
  const c = state.csv;
  if (!c) return;
  let t = `${c.file} — ${c.headers.length} columns, ${c.data.length} rows`;
  if (typeof c.sel === "number" && c.sel >= 0 && c.sel < c.data.length) {
    t += ` · editing row ${c.sel + 1} of ${c.data.length}`;
  }
  $("csv-meta").textContent = t;
}

function selectCsvRow(ri) {
  if (!state.csv) return;
  state.csv.sel = ri;
  const rows = $("cvtable").querySelectorAll("tbody tr");
  for (const r of rows) {
    r.classList.toggle("sel", Number(r.getAttribute("data-r")) === ri);
  }
  updateCsvMeta();
}

function renderCsv() {
  const c = state.csv;
  if (!c) return;
  updateCsvMeta();
  const thead = $("cvtable").querySelector("thead");
  const tbody = $("cvtable").querySelector("tbody");
  thead.innerHTML = "";
  const tr = document.createElement("tr");
  for (const h of c.headers) {
    const th = document.createElement("th");
    th.textContent = h;
    tr.appendChild(th);
  }
  thead.appendChild(tr);
  tbody.innerHTML = "";
  for (let ri = 0; ri < c.data.length; ri++) {
    const row = c.data[ri];
    const r = document.createElement("tr");
    r.setAttribute("data-r", ri);
    for (let ci = 0; ci < c.headers.length; ci++) {
      const v = row[ci];
      const td = document.createElement("td");
      td.textContent = v == null ? "" : String(v);
      td.setAttribute("contenteditable", "true");
      td.addEventListener("input", () => (row[ci] = td.textContent === "" ? "" : td.textContent));
      td.addEventListener("focus", () => selectCsvRow(ri));
      r.appendChild(td);
    }
    tbody.appendChild(r);
  }
  $("cfilter").value = "";
  if (typeof c.sel === "number" && c.sel >= 0 && c.sel < c.data.length) {
    const rows = tbody.children;
    if (rows[c.sel]) rows[c.sel].classList.add("sel");
  }
}

$("btn-load").addEventListener("click", async () => {
  const file = $("cfiles").value;
  if (!file) return alert("Nothing selected.");
  try {
    const j = await getJSON("/api/gamefiles/" + file);
    state.csv = { file: j.file, headers: j.headers || [], types: j.types || [], data: j.data || [] };
    renderCsv();
  } catch (e) {
    alert(e.message);
  }
});

$("cfilter").addEventListener("input", (e) => {
  const q = e.target.value.toLowerCase();
  for (const r of $("cvtable").querySelectorAll("tbody tr")) {
    r.style.display = r.textContent.toLowerCase().includes(q) ? "" : "none";
  }
});

$("btn-save").addEventListener("click", async () => {
  if (!state.csv) return;
  try {
    await postJSON("/api/gamefiles/" + state.csv.file, {
      headers: state.csv.headers,
      types: state.csv.types,
      data: state.csv.data,
    });
    alert("Saved " + state.csv.file + ". Restart the server for changes to take effect.");
  } catch (e) {
    alert(e.message);
  }
});

$("btn-restore").addEventListener("click", async () => {
  if (!confirm("Restore all pristine game data on the server? This reverts every edited CSV file to the original.")) return;
  try {
    await postJSON("/api/gamefiles/restore");
    alert("Pristine data restored.");
    if (state.csv) {
      const j = await getJSON("/api/gamefiles/" + state.csv.file);
      state.csv = { file: j.file, headers: j.headers || [], types: j.types || [], data: j.data || [] };
      renderCsv();
    }
  } catch (e) {
    alert(e.message);
  }
});

/* ---------------- database tab ---------------- */
const dbState = {
  tables: [],
  table: null,
  headers: [],
  columns: [],
  pk: [],
  rows: [],
  orig: [],
  offset: 0,
  limit: 100,
  total: 0,
};

const WRITE_RE = /^\s*(insert|update|delete|alter|drop|truncate|create|replace|rename|grant|revoke|flush|lock|unlock|set)\b/i;

function fmtSize(n) {
  if (n == null) return "-";
  const b = Number(n);
  if (b < 1024) return b + " B";
  if (b < 1048576) return (b / 1024).toFixed(1) + " KiB";
  return (b / 1048576).toFixed(1) + " MiB";
}

function escCell(v) {
  if (v === null) return '<span class="dbnull">NULL</span>';
  return esc(String(v));
}

async function loadTables() {
  const j = await getJSON("/api/dbview/tables");
  if (j.ok === false) {
    toast(j.error || "Database not available");
    $("dbtable").querySelector("tbody").innerHTML = '<tr><td colspan="3" class="muted">Database not running — start the server stack.</td></tr>';
    return;
  }
  dbState.tables = j.tables || [];
  renderTables();
}

function renderTables() {
  const q = ($("dbfilter").value || "").toLowerCase();
  const tbody = $("dbtable").querySelector("tbody");
  tbody.innerHTML = "";
  for (const t of dbState.tables) {
    if (q && !String(t.name).toLowerCase().includes(q)) continue;
    const tr = document.createElement("tr");
    tr.className = "dbtable-row" + (dbState.table === t.name ? " sel" : "");
    tr.innerHTML =
      `<td><code>${esc(t.name)}</code></td>` +
      `<td>${esc(String(t.rows))}</td>` +
      `<td>${esc(fmtSize(t.size_bytes))}</td>`;
    tr.addEventListener("click", () => openTable(t.name));
    tbody.appendChild(tr);
  }
}

async function openTable(name) {
  $("dbfilter").value = "";
  dbState.table = name;
  dbState.offset = 0;
  renderTables();
  await fetchPage();
}

async function fetchPage() {
  const j = await getJSON(
    `/api/dbview/table/${encodeURIComponent(dbState.table)}?limit=${dbState.limit}&offset=${dbState.offset}`
  );
  if (j.ok === false) {
    toast(j.error || "failed to load table");
    return;
  }
  dbState.headers = j.headers || [];
  dbState.columns = j.columns || [];
  dbState.pk = j.pk || [];
  dbState.rows = j.rows || [];
  dbState.orig = (j.rows || []).map((r) => r.slice());
  dbState.total = j.total || 0;
  $("dbmeta").textContent = dbState.table;
  $("dbpage").textContent = dbState.total
    ? `${dbState.offset + 1}–${Math.min(dbState.offset + dbState.rows.length, dbState.total)} of ${dbState.total}`
    : "0 rows";
  $("db-prev").disabled = dbState.offset <= 0;
  $("db-next").disabled = dbState.offset + dbState.rows.length >= dbState.total;
  renderView();
}

function renderView() {
  const table = dbState;
  const readonly = !table.pk.length;
  const thead = $("dbview").querySelector("thead");
  thead.innerHTML = "";
  const tr = document.createElement("tr");
  tr.appendChild(document.createElement("th"));
  for (const h of table.headers) {
    const th = document.createElement("th");
    th.textContent = h;
    const col = table.columns.find((c) => c.name === h);
    th.title = col ? col.fullType : h;
    tr.appendChild(th);
  }
  if (!readonly) tr.appendChild(document.createElement("th"));
  thead.appendChild(tr);
  const tbody = $("dbview").querySelector("tbody");
  tbody.innerHTML = "";
  if (!table.table) {
    tbody.innerHTML = '<tr><td colspan="20" class="muted">Select a table on the left.</td></tr>';
    return;
  }
  table.rows.forEach((row, ri) => {
    const r = document.createElement("tr");
    r.dataset.ri = String(ri);
    const num = document.createElement("td");
    num.className = "dbrowno";
    num.textContent = String(table.offset + ri + 1);
    r.appendChild(num);
    row.forEach((v, ci) => {
      const td = document.createElement("td");
      td.className = "dbcell";
      td.innerHTML = escCell(v);
      const full = v === null ? "NULL" : String(v);
      td.title = table.headers[ci] + (full.length > 80 ? "\n\n" + full : "");
      td.dataset.ci = String(ci);
      td.setAttribute("contenteditable", "true");
      td.addEventListener("input", () => markDirty(r));
      r.appendChild(td);
    });
    if (!readonly) {
      const ax = document.createElement("td");
      ax.className = "dbacts";
      const save = document.createElement("button");
      save.className = "btn";
      save.textContent = "Save row";
      save.addEventListener("click", () => saveRow(ri));
      ax.appendChild(save);
      const del = document.createElement("button");
      del.className = "btn danger";
      del.textContent = "Delete";
      del.addEventListener("click", () => deleteRow(ri));
      ax.appendChild(del);
      r.appendChild(ax);
    }
    tbody.appendChild(r);
  });
  const hint = $("db-hint");
  if (table.table === "player" && table.headers.includes("Trophies")) {
    hint.textContent = "Note: the Trophies column is mirrored from the Home JSON (arena.trophies) and is overwritten by the server on every save. Edit the Home cell instead, or grant trophies via the Config tab (Min/Max trophies per battle).";
  } else {
    hint.textContent = "";
  }
}

function markDirty(r) {
  if (r.dataset.dirty) return;
  r.dataset.dirty = "1";
  r.classList.add("dirty");
}

async function saveRow(ri) {
  const table = dbState;
  if (!table.pk.length) return toast("This table has no primary key; edit via the SQL console instead.");
  if ($("db-check-write").checked && !confirm("Save changes to this row?")) return;
  const r = $("dbview").querySelector(`tbody tr[data-ri="${ri}"]`);
  if (!r) return;
  const pk = {};
  const set = {};
  table.headers.forEach((h, ci) => {
    const td = r.children[1 + ci];
    const cur = td.textContent === "" ? null : td.textContent;
    const orig = table.orig[ri][ci];
    const same = (orig === null && cur === null) || (orig !== null && String(orig) === cur);
    if (table.pk.includes(h)) pk[h] = cur;
    else if (!same) set[h] = cur;
  });
  if (!Object.keys(set).length) return toast("No changes in this row.");
  try {
    const j = await postJSON("/api/dbview/update", { table: table.table, pk, set });
    if (j.ok === false) return toast(j.error);
    toast(`Updated ${j.affectedRows} row(s).`);
    await fetchPage();
  } catch (e) {
    toast(e.message);
  }
}

async function deleteRow(ri) {
  const table = dbState;
  if (!confirm(`Delete row ${table.offset + ri + 1} from ${table.table}? This cannot be undone.`)) return;
  const where = table.pk.map((h) => {
    const ci = table.headers.indexOf(h);
    const v = table.rows[ri][ci];
    const lit = v === null ? "NULL" : typeof v === "number" ? String(v) : "'" + String(v).replace(/'/g, "''") + "'";
    return `\`${h}\` = ${lit}`;
  }).join(" AND ");
  const sql = `DELETE FROM \`${table.table}\` WHERE ${where} LIMIT 1`;
  try {
    const j = await postJSON("/api/dbview/query", { sql });
    if (j.ok === false) return toast(j.error);
    toast(`Deleted ${j.affectedRows} row(s).`);
    await fetchPage();
  } catch (e) {
    toast(e.message);
  }
}

$("db-refresh").addEventListener("click", loadTables);
$("dbfilter").addEventListener("input", renderTables);
$("db-prev").addEventListener("click", () => {
  dbState.offset = Math.max(0, dbState.offset - dbState.limit);
  fetchPage();
});
$("db-next").addEventListener("click", () => {
  if (dbState.offset + dbState.rows.length < dbState.total) {
    dbState.offset += dbState.limit;
    fetchPage();
  }
});
$("db-limit").addEventListener("change", (e) => {
  dbState.limit = Number(e.target.value);
  dbState.offset = 0;
  if (dbState.table) fetchPage();
});

/* ---- sql console ---- */
function renderSqlResult(j) {
  const thead = $("sqlres").querySelector("thead");
  const tbody = $("sqlres").querySelector("tbody");
  thead.innerHTML = "";
  tbody.innerHTML = "";
  $("sql-meta").textContent = j.write
    ? `write statement — affected ${j.affectedRows} row(s) in ${j.ms}ms`
    : j.columns.length
      ? `${j.columns.length} columns, ${j.rows.length} rows in ${j.ms}ms${j.truncated ? " (truncated — add a LIMIT)" : ""}`
      : `statement ran in ${j.ms}ms`;
  if (!j.columns.length) return;
  const tr = document.createElement("tr");
  for (const c of j.columns) {
    const th = document.createElement("th");
    th.textContent = c;
    tr.appendChild(th);
  }
  thead.appendChild(tr);
  for (const row of j.rows) {
    const r = document.createElement("tr");
    for (const v of row) {
      const td = document.createElement("td");
      td.innerHTML = escCell(v);
      r.appendChild(td);
    }
    tbody.appendChild(r);
  }
}

$("sql-run").addEventListener("click", async () => {
  const sql = $("sql-input").value;
  if (!sql.trim()) return;
  if (WRITE_RE.test(sql) && $("db-check-write").checked) {
    if (!confirm(`Run write statement?\n\n${sql.slice(0, 400)}`)) return;
  }
  try {
    const j = await postJSON("/api/dbview/query", { sql });
    if (j.ok === false) return toast(j.error);
    renderSqlResult(j);
  } catch (e) {
    toast(e.message);
  }
});

/* ---------------- players tab ---------------- */
const plState = { players: [], current: null };

async function loadPlayers() {
  const j = await getJSON("/api/players");
  plState.players = j.players || [];
  renderPlayers();
  if (plState.current) {
    const cur = plState.players.find((p) => p.id === plState.current.id);
    if (cur) selectPlayer(cur.id);
  }
}

function renderPlayers() {
  const tbody = $("pltable").querySelector("tbody");
  const q = ($("plfilter").value || "").toLowerCase();
  const list = plState.players.filter(
    (p) => !q || String(p.name).toLowerCase().includes(q) || String(p.id).includes(q)
  );
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="muted">No players yet.</td></tr>';
    return;
  }
  tbody.innerHTML = list
    .map(
      (p) =>
        `<tr class="prow${plState.current && plState.current.id === p.id ? " sel" : ""}" data-pid="${esc(p.id)}">` +
        `<td>${esc(p.id)}</td><td>${esc(p.name)}</td><td>${esc(p.level)}</td><td>${esc(p.trophies)}</td>` +
        `<td>${esc(p.gold)}</td><td>${esc(p.gems)}</td><td>${esc(p.sessions)}</td>` +
        `<td>${p.admin ? "✔" : ""}</td><td>${p.banned ? "✖" : ""}</td></tr>`
    )
    .join("");
  for (const tr of tbody.querySelectorAll(".prow")) {
    tr.addEventListener("click", () => selectPlayer(Number(tr.dataset.pid)));
  }
}

function selectPlayer(id) {
  const p = plState.players.find((x) => x.id === id);
  plState.current = p;
  renderPlayers();
  renderEditor(p);
}

function renderEditor(p) {
  const box = $("pledit");
  $("pledit-id").textContent = `#${p.id}`;
  box.innerHTML = `
    <div class="frow"><label for="pe-name">Name</label><input id="pe-name" type="text" maxlength="30" value="${esc(p.name)}"></div>
    <div class="frow"><label for="pe-level">Level</label><input id="pe-level" type="number" min="1" max="13" value="${esc(p.level)}"></div>
    <div class="frow"><label for="pe-trophies">Trophies</label><input id="pe-trophies" type="number" min="0" value="${esc(p.trophies)}"></div>
    <div class="frow"><label for="pe-gold">Gold</label><input id="pe-gold" type="number" min="0" value="${esc(p.gold)}"></div>
    <div class="frow"><label for="pe-gems">Gems</label><input id="pe-gems" type="number" min="0" value="${esc(p.gems)}"></div>
    <div class="frow">
      <button id="pe-save" class="btn">Save changes</button>
      <button id="pe-unlock" class="btn">Unlock all cards</button>
      <button id="pe-max" class="btn">Max all cards</button>
    </div>
    <div class="frow">
      <button id="pe-admin" class="btn ${p.admin ? "danger" : ""}">${p.admin ? "Remove admin" : "Make admin"}</button>
      <button id="pe-ban" class="btn ${p.banned ? "" : "danger"}">${p.banned ? "Unban" : "Ban"}</button>
      <span class="muted" id="pe-restart-note"></span>
    </div>`;
  $("pe-save").addEventListener("click", () => savePlayer());
  $("pe-unlock").addEventListener("click", () => playerAction("cards", "unlock"));
  $("pe-max").addEventListener("click", () => playerAction("cards", "max"));
  $("pe-admin").addEventListener("click", () => playerAction("admin", !p.admin));
  $("pe-ban").addEventListener("click", () => playerAction("banned", !p.banned));
}

async function savePlayer() {
  const p = plState.current;
  if (!p) return;
  const patch = {};
  const fields = [
    ["name", "pe-name"],
    ["level", "pe-level"],
    ["trophies", "pe-trophies"],
    ["gold", "pe-gold"],
    ["gems", "pe-gems"],
  ];
  for (const [key, id] of fields) {
    const el = $(id);
    const raw = el.value.trim();
    if (raw === "") continue;
    const n = key === "name" ? raw : Number(raw);
    if (key !== "name" && !Number.isFinite(n)) {
      toast(`${key} must be a number`);
      return;
    }
    if (key !== "name" && n !== p[key]) patch[key] = n;
    if (key === "name" && n !== p.name) patch[key] = n;
  }
  if (!Object.keys(patch).length) {
    toast("No changes");
    return;
  }
  await playerPost({ patch });
}

async function playerAction(kind, val) {
  await playerPost({ [kind]: val });
}

async function playerPost(body) {
  const p = plState.current;
  if (!p) return;
  try {
    const j = await postJSON(`/api/players/${p.id}`, body);
    if (j.ok === false) return toast(j.error || "failed");
    if (j.applied && j.applied.length) toast(`Applied: ${j.applied.join(", ")}${j.requiresRestart ? " — restart the main server" : ""}`);
    else toast(j.requiresRestart ? "Restart the main server to apply." : "Saved.");
    await loadPlayers();
  } catch (e) {
    toast(e.message);
  }
}

$("pl-refresh").addEventListener("click", loadPlayers);
$("plfilter").addEventListener("input", renderPlayers);

/* ---------------- apk tab ---------------- */
function showApkOutput(path, size, entries, signed) {
  const box = $("apk-output");
  box.innerHTML = "";
  const code = document.createElement("code");
  code.textContent = `${path}${size ? `  (${(size / 1048576).toFixed(1)} MB, ${entries} entries${signed ? ", signed" : ""})` : ""}`;
  box.appendChild(code);
}

async function loadApk() {
  const j = await getJSON("/api/apk/status");
  if (j.settings && j.settings.serverAddress) $("apk-address").value = j.settings.serverAddress;
  $("apk-patch-address").checked = !(j.settings && j.settings.apk && j.settings.apk.patchAddress === false);
  $("apk-patch-battles").checked = !(j.settings && j.settings.apk && j.settings.apk.patchBattles === false);
  $("apk-bake-csv").checked = !(j.settings && j.settings.apk && j.settings.apk.bakeGamefiles === false);
  if (j.abis && j.abis.length) {
    $("apk-abis").textContent = j.abis.join(", ");
    const has64 = j.abis.some((a) => a === "arm64-v8a" || a === "x86_64");
    $("apk-abis-warn").style.display = has64 ? "none" : "block";
  }
  if (j.building) {
    $("btn-build").disabled = true;
    $("btn-orig").disabled = true;
  }
}

function setApkLog(line) {
  const box = $("apk-log");
  box.textContent += line + "\n";
  box.scrollTop = box.scrollHeight;
}

$("btn-build").addEventListener("click", async () => {
  $("btn-build").disabled = true;
  $("btn-orig").disabled = true;
  setApkLog("— build started —");
  try {
    const j = await postJSON("/api/apk/build", {
      patchAddress: $("apk-patch-address").checked,
      patchBattles: $("apk-patch-battles").checked,
      bakeGamefiles: $("apk-bake-csv").checked,
    });
    showApkOutput(j.path, j.size, j.entries, j.signed);
    setApkLog(`Output: ${j.path}`);
    if (j.csv && j.csv.baked && j.csv.baked.length) setApkLog(`Baked ${j.csv.baked.length} edited game CSVs into the APK.`);
    await loadApk();
  } catch (e) {
    setApkLog("error: " + e.message);
  }
  $("btn-build").disabled = false;
  $("btn-orig").disabled = false;
});

$("btn-orig").addEventListener("click", async () => {
  $("btn-build").disabled = true;
  $("btn-orig").disabled = true;
  setApkLog("— rebuilding original client —");
  try {
    const j = await postJSON("/api/apk/original", {});
    showApkOutput(j.path, j.size, j.entries, j.signed);
    setApkLog(`Output: ${j.path}`);
    await loadApk();
  } catch (e) {
    setApkLog("error: " + e.message);
  }
  $("btn-build").disabled = false;
  $("btn-orig").disabled = false;
});

$("btn-revert").addEventListener("click", async () => {
  if (!confirm("Replace the patched server data with pristine defaults? This makes the card files identical to the original game.")) return;
  try {
    await postJSON("/api/gamefiles/restore");
    alert("Server data reverted to default.");
  } catch (e) {
    alert(e.message);
  }
});

/* ---------------- config tab ---------------- */
const CFG_FIELDS = ["MinTrophies", "MaxTrophies", "DefaultGold", "DefaultGems", "DefaultLevel", "GemsToGiveAfterMatch", "GoldToGiveAfterMatch"];

async function loadConfig() {
  const j = await getJSON("/api/config/main");
  if (j.ok === false) {
    toast(j.error || "failed to load config");
    return;
  }
  for (const k of CFG_FIELDS) {
    const el = $("cfg-" + k);
    if (el) el.value = j.config[k] != null ? j.config[k] : "";
  }
  const up = $("cfg-meta");
  if (up) up.textContent = j.config.update_url ? `Auto-update URL: ${j.config.update_url}` : "No auto-update URL configured.";
}

async function saveConfig() {
  const config = {};
  for (const k of CFG_FIELDS) {
    const el = $("cfg-" + k);
    if (!el) continue;
    const raw = el.value.trim();
    if (raw === "") continue;
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      toast(`${k} must be a number`);
      return;
    }
    config[k] = n;
  }
  const j = await postJSON("/api/config/main", { config });
  if (j.ok === false) {
    toast(j.error || "failed to save config");
    return;
  }
  toast("Config saved — restart the server stack to apply.");
  loadConfig();
}

$("cfg-load").addEventListener("click", loadConfig);
$("cfg-save").addEventListener("click", saveConfig);

/* ---------------- logs tab ---------------- */
const logCap = new Map();
let logFilter = "all";
const logSeen = new Map();
let logTick = 0;

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderLogs() {
  const box = $("logbox");
  const build = (src, entry) =>
    `<div class="log-line${entry.err ? " err" : ""}">${
      logFilter === "all" ? `<span class="log-src">${esc(src)}</span>` : ""
    }<span class="log-ts">${esc(entry.ts)}</span> ${esc(entry.text)}</div>`;
  const html = [];
  if (logFilter === "all") {
    for (const [src, arr] of logCap) for (const e of arr) html.push(build(src, e));
  } else {
    for (const e of logCap.get(logFilter) || []) html.push(build(logFilter, e));
  }
  box.innerHTML = html.join("\n");
  box.scrollTop = box.scrollHeight;
}

$("logfilter").addEventListener("change", (e) => {
  logFilter = e.target.value;
  renderLogs();
});

function connectLogs() {
  const es = new EventSource("/api/logs/all/stream");
  es.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.type === "clear") {
      logCap.clear();
      logSeen.clear();
      setApkLog("");
      renderLogs();
      return;
    }
    if (m.type !== "line") return;
    const src = m.source || "app";
    const entry = {
      ts: m.line && m.line.ts ? m.line.ts.slice(11, 19) : "",
      text: (m.line && m.line.text != null ? String(m.line.text) : "").trimEnd(),
      err: !!(m.line && m.line.stream === "err"),
    };
    if (entry.text === "" && !entry.err) return;
    // The stream replays the full history on every (re)connect, so skip any
    // line that this tab has already seen for the source.
    const sig = (m.line && m.line.ts || "") + "|" + entry.text + "|" + entry.err;
    if (!logSeen.has(src)) logSeen.set(src, new Set());
    if (logSeen.get(src).has(sig)) return;
    logSeen.get(src).add(sig);
    if (!logCap.has(src)) logCap.set(src, []);
    const arr = logCap.get(src);
    arr.push(entry);
    if (arr.length > 2000) arr.splice(0, arr.length - 2000);
    if (src === "apk") {
      setApkLog(entry.text);
      return;
    }
    renderLogs();
  };
  es.onerror = () => setTimeout(() => { try { es.close(); } catch (e) {} connectLogs(); }, 3000);
}

/* ---------------- boot ---------------- */
(async function boot() {
  try {
    loadFileList();
  } catch (e) {
    console.error(e);
  }
  try {
    loadApk();
  } catch (e) {
    console.error(e);
  }
  try {
    loadTables();
  } catch (e) {
    console.error(e);
  }
  try {
    loadPlayers();
  } catch (e) {
    console.error(e);
  }
  connectLogs();
  try {
    loadConfig();
  } catch (e) {
    console.error(e);
  }
  await refreshStatus();
  setInterval(refreshStatus, 3000);
})();