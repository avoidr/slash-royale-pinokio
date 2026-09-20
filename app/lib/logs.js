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

  _chunk(name, chunk, stream) {
    const text = chunk.toString();
    for (const raw of text.split(/\r?\n/)) {
      if (raw.length === 0) continue;
      if (raw.length > 2000) {
        this.push(name, stream === "err" ? "err" : "out", raw.slice(0, 2000) + "...");
      } else {
        this.push(name, stream === "err" ? "err" : "out", raw);
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