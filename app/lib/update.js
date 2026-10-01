"use strict";

const fs = require("fs");
const path = require("path");
const https = require("https");
const { p } = require("./paths");

const VERSION = "0.2.1";

const API = "https://api.github.com/repos/avoidr/SlashRoyaleLegacy";

const defaultBranch = "main";
const commitCache = { data: null, at: 0 };
const CACHE_MS = 5 * 60 * 1000;

function gitDir() {
  let g = path.join(p.root, ".git");
  try {
    if (fs.statSync(g).isFile()) {
      const t = fs.readFileSync(g, "utf8").trim();
      const m = t.match(/^gitdir:\s*(.+)$/m);
      g = m ? path.resolve(p.root, m[1].trim()) : null;
    }
  } catch (e) {
    return null;
  }
  return g ? g : null;
}

function localHead() {
  const g = gitDir();
  if (!g) return null;
  try {
    const head = fs.readFileSync(path.join(g, "HEAD"), "utf8").trim();
    // detached → the sha itself
    if (/^[0-9a-f]{40}$/i.test(head)) return { sha: head.toLowerCase(), branch: defaultBranch, detached: true };
    const m = head.match(/^ref:\s*refs\/heads\/(.+)$/);
    if (!m) return null;
    const branch = m[1];
    const refFile = path.join(g, "refs", "heads", ...branch.split("/"));
    let sha = null;
    if (fs.existsSync(refFile)) sha = fs.readFileSync(refFile, "utf8").trim();
    if (!sha) {
      // packed-refs fallback
      const packed = path.join(g, "packed-refs");
      if (fs.existsSync(packed)) {
        for (const line of fs.readFileSync(packed, "utf8").split("\n")) {
          const pm = line.trim().match(/^([0-9a-f]{40})\s+refs\/heads\/(.+)$/);
          if (pm && pm[2] === branch) sha = pm[1];
        }
      }
    }
    if (!sha || !/^[0-9a-f]{40}$/i.test(sha)) return null;
    return { sha: sha.toLowerCase(), branch, detached: false };
  } catch (e) {
    return null;
  }
}

function httpGet(url, timeoutMs = 15000, redirects = 5) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        timeout: timeoutMs,
        headers: {
          "User-Agent": "slash-royale-panel",
          Accept: "application/vnd.github+json",
        },
      },
      (res) => {
        // GitHub answers 301 for a renamed repo and keeps that redirect forever,
        // so follow it instead of treating it as a failure. Without this, an
        // install whose API constant still names the old repo breaks the moment
        // the repo is renamed.
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          if (redirects <= 0) {
            return reject(new Error("too many redirects from GitHub"));
          }
          const next = new URL(res.headers.location, url).toString();
          return resolve(httpGet(next, timeoutMs, redirects - 1));
        }

        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c) => {
          body += c;
          if (body.length > 4 * 1024 * 1024) req.destroy(new Error("response too large"));
        });
        res.on("end", () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            return reject(new Error(`GitHub returned HTTP ${res.statusCode}`));
          }
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(new Error("invalid JSON from GitHub"));
          }
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error("update check timed out")));
    req.on("error", reject);
  });
}

function commitInfo(c) {
  if (!c) return null;
  return {
    sha: c.sha,
    short: c.sha ? c.sha.slice(0, 7) : "",
    message: (c.commit && c.commit.message ? c.commit.message : "").split("\n")[0].trim(),
    date: c.commit && c.commit.committer && c.commit.committer.date ? c.commit.committer.date : null,
  };
}

async function check(force = false) {
  const now = Date.now();
  if (!force && commitCache.data && now - commitCache.at < CACHE_MS) {
    return commitCache.data;
  }
  const out = await doCheck();
  commitCache.data = out;
  commitCache.at = now;
  return out;
}

async function doCheck() {
  const local = localHead();
  const out = {
    ok: true,
    version: VERSION,
    checkedAt: new Date().toISOString(),
    installed: null,
    latest: null,
    ahead: 0,
    commits: [],
    available: false,
    source: "github",
  };
  if (!local) {
    return { ...out, available: null, error: "not a git checkout — cannot compare versions" };
  }
  out.installed = { sha: local.sha, short: local.sha.slice(0, 7), branch: local.branch };
  const branch = local.branch || defaultBranch;
  try {
    // Walk the remote branch's commit list (newest first) until we find where
    // our local commit sits. Commits above it are the updates we don't have yet.
    // This avoids the compare API's odd behaviour when the local commit has not
    // been pushed (it would report a bogus "you are ahead").
    const found = await findLocalPosition(local.sha, branch);
    out.latest = found.entries[0] ? commitInfo(found.entries[0]) : null;
    if (found.idx < 0) {
      // The local HEAD isn't in the remote history at all: the checkout is
      // ahead of (or diverged from) GitHub, so there is nothing newer to fetch.
      out.ahead = 0;
      out.commits = [];
      out.available = false;
      return out;
    }
    out.commits = found.entries.slice(0, found.idx).map(commitInfo).filter(Boolean);
    out.commits.length = Math.min(out.commits.length, 50);
    out.ahead = found.idx;
    out.available = found.idx > 0;
    return out;
  } catch (e) {
    return { ...out, available: null, error: e.message };
  }
}

async function findLocalPosition(localSha, branch) {
  const seen = new Map();
  let page = 1;
  for (;;) {
    const entries = await httpGet(`${API}/commits?sha=${encodeURIComponent(branch)}&per_page=100&page=${page}`);
    if (!Array.isArray(entries) || !entries.length) break;
    for (let i = 0; i < entries.length; i++) {
      const sha = String(entries[i].sha || "");
      if (seen.has(sha)) continue;
      seen.set(sha, entries[i]);
      const globalIdx = seen.size - 1;
      if (sha === localSha) return { idx: globalIdx, entries: [...seen.values()] };
    }
    if (entries.length < 100) break;
    page++;
    if (page > 20) break; // safety cap (~2000 commits)
  }
  return { idx: -1, entries: [...seen.values()] };
}

module.exports = { VERSION, check, localHead };