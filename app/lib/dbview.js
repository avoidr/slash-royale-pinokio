"use strict";

const mariadb = require("mariadb");
const settings = require("./settings");
const logs = require("./logs");

const IDENT_RE = /^[A-Za-z0-9_$]+$/;
const MAX_ROWS = 1000;

let pool = null;

function poolOpts() {
  const db = settings.get().db;
  return {
    host: db.host,
    port: db.port,
    user: db.user,
    password: db.password || "",
    database: db.database,
    connectionLimit: 4,
    connectTimeout: 5000,
    acquireTimeout: 5000,
    decimalAsNumber: false,
    bigIntAsNumber: false,
    rowsAsArray: false,
    supportBigNumbers: true,
  };
}

function getPool() {
  if (!pool) pool = mariadb.createPool(poolOpts());
  return pool;
}

async function withConn(fn) {
  const c = await getPool().getConnection();
  try {
    await c.ping();
    return await fn(c);
  } finally {
    c.release();
  }
}

function dbError(e) {
  if (!e) return "unknown database error";
  const m = (e.message || "").toLowerCase();
  if (m.includes("connect") || m.includes("econnrefused") || m.includes("timeout")) {
    return "Database is not running. Start the server stack first.";
  }
  if (m.includes("database") && m.includes("doesn't exist")) {
    return "The game database has not been created yet. Start the server stack once to create it.";
  }
  return e.message || String(e);
}

async function assertTable(name) {
  if (!IDENT_RE.test(name)) throw new Error("invalid table name");
  const rows = await withConn((c) =>
    c.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = ? AND table_name = ?",
      [settings.get().db.database, name]
    )
  );
  if (!rows.length) throw new Error(`table "${name}" not found`);
}

async function tables() {
  const meta = await withConn((c) =>
    c.query(
      "SELECT table_name AS name, data_length + index_length AS size_bytes FROM information_schema.tables WHERE table_schema = ? ORDER BY table_name",
      [settings.get().db.database]
    )
  );
  const out = [];
  for (const t of meta) {
    const cnt = await withConn((c) => c.query("SELECT COUNT(*) AS n FROM `" + t.name + "`"));
    out.push({ name: t.name, rows: Number(cnt[0].n), size_bytes: t.size_bytes });
  }
  return out;
}

async function describeTable(name) {
  await assertTable(name);
  const cols = await withConn((c) =>
    c.query(
      `SELECT column_name AS name, data_type AS type, column_type AS fullType, is_nullable AS nullable, column_default AS defaultVal
       FROM information_schema.columns
       WHERE table_schema = ? AND table_name = ?
       ORDER BY ordinal_position`,
      [settings.get().db.database, name]
    )
  );
  const pkRows = await withConn((c) =>
    c.query(
      `SELECT column_name AS name FROM information_schema.statistics
       WHERE table_schema = ? AND table_name = ? AND index_name = 'PRIMARY'
       ORDER BY seq_in_index`,
      [settings.get().db.database, name]
    )
  );
  return { columns: cols.map((c) => ({ ...c })), pk: pkRows.map((r) => r.name) };
}

async function page(name, limit, offset) {
  await assertTable(name);
  limit = Math.max(1, Math.min(Number(limit) || 100, MAX_ROWS));
  offset = Math.max(0, Number(offset) || 0);
  const info = await describeTable(name);
  const data = await withConn(async (c) => {
    const total = await c.query(`SELECT COUNT(*) AS n FROM \`${name}\``);
    const rows = await c.query(`SELECT * FROM \`${name}\` LIMIT ? OFFSET ?`, [limit, offset]);
    return { total: Number(total[0].n), rows };
  });
  const headers = data.rows.length ? Object.keys(data.rows[0]) : [];
  return {
    table: name,
    limit,
    offset,
    total: data.total,
    headers,
    columns: info.columns,
    pk: info.pk,
    rows: data.rows.map((r) => headers.map((h) => (r[h] === null ? null : r[h]))),
  };
}

const READ_FIRST = /^(select|show|describe|desc|explain|with)\b/i;

function splitStatement(sql) {
  const t = String(sql || "").trim();
  if (!t) return null;
  let body = t;
  while (/\s*;[;\s]*$/.test(body)) body = body.replace(/;+\s*$/, "").trim();
  if (!body) return null;
  if (body.includes(";")) throw new Error("Run one statement at a time (extra ';' found).");
  return body;
}

async function runSql(sqlInput) {
  const body = splitStatement(sqlInput);
  if (!body) return { columns: [], rows: [], affectedRows: 0, write: false };
  const isRead = READ_FIRST.test(body);
  const result = await withConn(async (c) => {
    const start = Date.now();
    const r = await c.query(body).catch((e) => {
      throw new Error(dbError(e));
    });
    const ms = Date.now() - start;
    if (Array.isArray(r)) {
      const headers = r.length ? Object.keys(r[0]) : [];
      return {
        columns: headers,
        rows: r.slice(0, MAX_ROWS).map((row) => headers.map((h) => (row[h] === null ? null : row[h]))),
        truncated: r.length > MAX_ROWS,
        affectedRows: 0,
        ms,
      };
    }
    return { columns: [], rows: [], truncated: false, affectedRows: r && r.affectedRows, ms, info: r };
  });
  return { ...result, write: !isRead };
}

function coerce(val, type) {
  if (val === null || val === undefined) return null;
  const str = String(val);
  const numeric = ["tinyint", "smallint", "mediumint", "int", "bigint", "decimal", "float", "double", "bit", "year"];
  if (numeric.some((n) => type.startsWith(n))) {
    if (!str.length) return null;
    const n = Number(str);
    return Number.isNaN(n) ? null : n;
  }
  return str === "" ? "" : str;
}

async function updateRow(table, pk, set) {
  await assertTable(table);
  if (!pk || typeof pk !== "object" || !Object.keys(pk).length) throw new Error("primary key required");
  if (!set || typeof set !== "object") throw new Error("no columns to update");
  const info = await describeTable(table);
  const typeFor = Object.fromEntries(info.columns.map((c) => [c.name.toLowerCase(), c.type]));
  const safePk = {};
  const safeSet = {};
  for (const [k, v] of Object.entries(pk)) {
    if (!(k.toLowerCase() in typeFor)) throw new Error(`unknown column: ${k}`);
    safePk[k] = coerce(v, typeFor[k.toLowerCase()]);
  }
  for (const [k, v] of Object.entries(set)) {
    if (!(k.toLowerCase() in typeFor)) throw new Error(`unknown column: ${k}`);
    safeSet[k] = coerce(v, typeFor[k.toLowerCase()]);
  }
  const setSql = Object.keys(safeSet).map((k) => "`" + k + "` = ?").join(", ");
  const whereSql = Object.keys(safePk).map((k) => "`" + k + "` = ?").join(" AND ");
  const params = [...Object.values(safeSet), ...Object.values(safePk)];
  const r = await withConn((c) =>
    c.query(`UPDATE \`${table}\` SET ${setSql} WHERE ${whereSql} LIMIT 1`, params)
  );
  return { affectedRows: r.affectedRows, warnings: r.warningStatus || 0 };
}

module.exports = { tables, page, runSql, updateRow, poolOpts, dbError };