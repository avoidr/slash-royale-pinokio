"use strict";

process.env.NODE_ENV = process.env.NODE_ENV || "production";

const path = require("path");
const http = require("http");
const express = require("express");
const { p, ensure } = require("./lib/paths");
const settings = require("./lib/settings");
const logs = require("./lib/logs");
const api = require("./routes/api");

ensure();
settings.load();

const app = express();
app.use(
  express.static(path.join(p.app, "public"), {
    etag: true,
    maxAge: 0,
    setHeaders: (res) => res.setHeader("Cache-Control", "no-cache"),
  })
);
app.use("/api", api);

app.get("/", (req, res) => res.sendFile(path.join(p.app, "public", "index.html")));
app.use((req, res) => res.status(404).json({ ok: false, error: "not found" }));

const port = parseInt(process.env.PANEL_PORT, 10) || settings.get().panelPort || 3000;
const server = http.createServer(app);

server.listen(port, "127.0.0.1", () => {
  logs.log("app", `Clash Royale PS admin panel ready on http://127.0.0.1:${port}`);
  console.log(`Clash Royale PS admin panel ready on http://127.0.0.1:${port}`);
  setTimeout(() => {
    const royale = require("./lib/royale");
    royale.autoStart().catch((e) => logs.log("app", `auto-start failed: ${e.message}`));
  }, 1500);
});

async function shutdown(signal) {
  logs.log("app", `Received ${signal}, shutting down...`);
  const royale = require("./lib/royale");
  const db = require("./lib/db");
  royale.shutdown();
  db.shutdown();
  server.close();
  setTimeout(() => process.exit(0), 1200);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("uncaughtException", (e) => {
  logs.log("app", `Uncaught exception: ${e.stack || e.message}`);
});