"use strict";

const fs = require("fs");
const path = require("path");
const { EventEmitter } = require("events");
const { ts } = require("./util");
const { p } = require("./paths");

class Logs extends EventEmitter {
  constructor() {
    super();
    this.buffers = new Map();
    this.inflight = new Map();
    this.files = new Map();
  }

  _file(name) {
    if (!this.files.has(name)) {
      try {
        fs.mkdirSync(p.envLogs, { recursive: true });
      } catch (e) {}
      this.files.set(name, path.join(p.envLogs, name + ".log"));
    }
    return this.files.get(name);
  }

  _buf(name) {
    if (!this.buffers.has(name)) {
      this.buffers.set(name, { max: 2000, lines: [] });
    }
    return this.buffers.get(name);
  }

  push(name, stream, text, level = "out") {
    const buf = this._buf(name);
    const line = { ts: ts(), stream, text: String(text), level };
    buf.lines.push(line);
    while (buf.lines.length > buf.max) buf.lines.shift();
    try {
      fs.appendFileSync(this._file(name), `[${line.ts}] ${line.text}\n`);
    } catch (e) {}
    this.emit("line", name, line);
  }

  log(name, text) {
    this.push(name, "out", text, "info");
  }

  attachChild(name, child) {
    const inflight = this.inflight.get(name) || 0;
    this.inflight.set(name, inflight + 1);
    const flush = (stream) => (chunk) => {
      if (!child.__terminated) this._chunk(name, chunk, stream);
    };
    child.stdout && child.stdout.on("data", flush("out"));
    child.stderr && child.stderr.on("data", flush("err"));
    child.once("exit", () => {
      child.__exitCode = true;
      const n = this.inflight.get(name) || 1;
      this.inflight.set(name, Math.max(0, n - 1));
      this.push(name, "sys", `[process exited]`, "sys");
      this.emit("exit", name);
    });
    return child;
  }

  _normalize(name, raw, stream) {
    if (name !== "db") return { text: raw, stream, level: stream === "err" ? "error" : "info" };
    // mariadbd --console writes its startup/connection lines to stderr and
    // prefixes them with its own timestamp ("2026-09-25 16:58:42 0 [Note] ...").
    // Strip that duplicate timestamp and fold the severity into the same
    // [Info]/[Warn]/[Error] tags the game servers use. Route non-error lines
    // to stream "out" so they render with normal styling instead of red.
    const m = raw.match(/^(\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}:\d{2})\s+\d+\s+\[(Note|Warning|Error|ERROR)\]\s?(.*)$/i);
    if (!m) return { text: raw, stream: "out", level: "info" };
    const tag = { note: "[Info]", warning: "[Warn]", error: "[Error]", error2: "[Error]" }[m[2].toLowerCase()];
    const isErr = /error/i.test(m[2]);
    return { text: `${tag} ${m[3]}`, stream: isErr ? "err" : "out", level: isErr ? "error" : /warning/i.test(m[2]) ? "warn" : "info" };
  }

  _chunk(name, chunk, stream) {
    const text = chunk.toString();
    for (const raw of text.split(/\r?\n/)) {
      if (raw.length === 0) continue;
      const n = this._normalize(name, raw, stream);
      const t = n.text;
      if (t.length > 2000) {
        this.push(name, n.stream, t.slice(0, 2000) + "...", n.level);
      } else {
        this.push(name, n.stream, t, n.level);
      }
    }
  }

  clear() {
    for (const [name] of this.buffers) {
      this.buffers.set(name, { max: 2000, lines: [] });
    }
    for (const [name] of this.files) {
      try {
        fs.writeFileSync(this.files.get(name), "");
      } catch (e) {}
    }
    this.emit("clear");
  }

  history(name) {
    return this._buf(name).lines;
  }

  names() {
    return Array.from(this.buffers.keys());
  }
}

module.exports = new Logs();