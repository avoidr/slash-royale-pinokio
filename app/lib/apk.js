"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { EventEmitter } = require("events");
const yauzl = require("yauzl");
const yazl = require("yazl");
const { p, exists } = require("./paths");
const settings = require("./settings");
const logs = require("./logs");
const gamefiles = require("./gamefiles");
const {
  execFile,
  indexOfBytes,
  asciiBytes,
  formatBytes,
  generatePassword,
} = require("./util");

const ADDRESS_NEEDLE = "cluster.retroroyale.xyz";
const BATTLE_PATCHES = [
  { offset: 0x001c27f0, from: 0xd0, to: 0xd1 },
  { offset: 0x001c2b40, from: 0x90, to: 0x92 },
];

const BASE_APK_URL =
  "https://dw.malavida.com/eG9ic0lPcS8vMlk3MnJvVEF2WXJhdW4zRHI4V2NuYkZsdjMvUkVJeUhVcUVZckpjWU5sbFBmN25TNlRCK3ZuYmFhYmZ1W/XBuWXRhbmh0b0xuVVYyVjdaVFkwT0dlMTV0Snl2Mktjd1R2Y2hqdkRaK05lMXZSRjRzdEJranZacUprNGRsZ282YURQQi/tNNTFSMHgyMjMxZCtsYjllTXYza21wajQ0bXk5ZFBPVjEyVDNySTJUUXN0K2lXbzVXTWlTeWN2UkNKamJPMmN6dThkaVp/DeUlycTdDUkFVNDJvd2J5ejhJV2ZZODQvakpJUGZmSjgzTnVFK3V4ckVaSFNrbkhnTnNHQTNWTkduU25pdWYwUUV5VHQ0/aWlHQTFsY0RJa25SbmRBVmNXaHFOT0NVWUM1V0tXS3dsR2l4cXZjNkY2Yk1NQitvMnZpbGx4bHFYNklEaHdobE95elZ2a/2tCcE9IVFpjSGdIUG5od25TbEthMlBQcTROT3ZWVlFGKzZnVzlubjNJR1AxNjRIUXNPd1oxbVJiWm5kNzRYV3FFUldrZk/xDRXB0enhyNjFYYlJXV2x4U3dhNEs0TDVTQXgrS21QSmQ1QlZnL2tLcEt0OUJXTmtLSktrQy80UnA3NFJnOHprUHB3NE5/rL3Q5bGFEY2RrTVBzT2tYa0pQN1NoamFOb3lZZ0lEQ1VJa2RXVEFnUTlhd09lelRRVitJRGM5aGIvSFFzUVM2SzVJPQ==/dcaf347cab1e89b4";

const downloadBus = new EventEmitter();
const downloadState = {
  active: false,
  done: false,
  bytes: 0,
  total: 0,
  pct: null,
  error: null,
};

function setDownload(patch) {
  Object.assign(downloadState, patch);
  const t = downloadState.total;
  downloadState.pct = t ? Math.min(100, (downloadState.bytes / t) * 100) : null;
  downloadBus.emit("progress", currentDownloadState());
}

function currentDownloadState() {
  return { ...downloadState };
}

function onDownload(cb) {
  downloadBus.on("progress", cb);
}

function offDownload(cb) {
  downloadBus.removeListener("progress", cb);
}

function isApkFile(file) {
  try {
    const fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(4);
    fs.readSync(fd, buf, 0, 4, 0);
    fs.closeSync(fd);
    return buf[0] === 0x50 && buf[1] === 0x4b;
  } catch (e) {
    return false;
  }
}

async function runDownload(url) {
  const tmp = p.baseApk + ".part";
  if (!url) {
    setDownload({ active: false, done: false, error: "No base client download URL configured." });
    return;
  }
  try {
    fs.mkdirSync(path.dirname(p.baseApk), { recursive: true });
    logs.log("apk", "Downloading base client...");
    const resp = await fetch(url, { redirect: "follow" });
    if (!resp.ok || !resp.body) throw new Error(`Download request failed (HTTP ${resp.status}).`);
    const total = Number(resp.headers.get("content-length")) || 0;
    setDownload({ total, error: null });

    const reader = resp.body.getReader();
    const ws = fs.createWriteStream(tmp);
    await new Promise((resolve, reject) => {
      const pump = async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              ws.end(() => resolve());
              return;
            }
            await new Promise((ok, no) => ws.write(Buffer.from(value), (e) => (e ? no(e) : ok())));
            setDownload({ bytes: downloadState.bytes + value.length });
          }
        } catch (e) {
          ws.destroy();
          reject(e);
        }
      };
      pump();
    });

    const size = fs.statSync(tmp).size;
    if (size < 1024 * 1024 || !isApkFile(tmp)) {
      throw new Error("Downloaded file is not a valid APK (missing ZIP header / too small).");
    }
    fs.rmSync(p.baseApk, { force: true });
    fs.renameSync(tmp, p.baseApk);
    setDownload({ active: false, done: true, bytes: size, error: null });
    logs.log("apk", `Base client downloaded (${formatBytes(size)}).`);
  } catch (e) {
    try { fs.rmSync(tmp, { force: true }); } catch (e2) {}
    setDownload({ active: false, done: false, error: e.message || String(e) });
    logs.log("apk", `Base client download failed: ${e.message}`);
  }
}

function startDownload(url) {
  if (exists(p.baseApk)) {
    return currentDownloadState();
  }
  if (downloadState.active) {
    return currentDownloadState();
  }
  setDownload({ active: true, done: false, bytes: 0, total: 0, pct: null, error: null });
  runDownload(url || BASE_APK_URL).catch(() => {});
  return currentDownloadState();
}

let building = false;

function keystorePass() {
  const passFile = path.join(p.keystoreDir, "release.pass");
  if (exists(passFile)) return fs.readFileSync(passFile, "utf8").trim();
  const pw = generatePassword(16);
  fs.writeFileSync(passFile, pw, "utf8");
  return pw;
}

async function ensureKeystore() {
  let pass = keystorePass();
  if (!exists(p.keystoreFile)) {
    logs.log("apk", "Generating signing keystore...");
    try {
      await execFile(p.keytool, [
        "-genkeypair",
        "-v",
        "-keystore", p.keystoreFile,
        "-storepass", pass,
        "-alias", "android",
        "-keypass", pass,
        "-keyalg", "RSA",
        "-keysize", "2048",
        "-validity", "10000",
        "-dname", "CN=SlashRoyale Private Server, OU=PS, O=PS, L=Local, ST=Local, C=US",
      ]);
    } catch (e) {
      throw new Error("Unable to generate keystore: " + (e.stderr || e.message));
    }
  }
  pass = keystorePass();
  try {
    const ks = fs.readFileSync(p.keystoreFile);
    if (!ks || ks.length < 64) throw new Error("keystore invalid");
  } catch (e) {
    throw new Error("Signing keystore is missing. " + e.message);
  }
  return { file: p.keystoreFile, pass };
}

function extractApk(apkPath, dest) {
  return new Promise((resolve, reject) => {
    yauzl.open(apkPath, { lazyEntries: true, autoClose: true }, (err, zip) => {
      if (err) return reject(err);
      const queue = [];
      zip.readEntry();
      zip.on("entry", (entry) => {
        if (/\/$/.test(entry.fileName)) {
          zip.readEntry();
          return;
        }
        const outFile = path.join(dest, entry.fileName);
        fs.mkdirSync(path.dirname(outFile), { recursive: true });
        queue.push(
          new Promise((done, fail) => {
            zip.openReadStream(entry, (err2, stream) => {
              if (err2) return fail(err2);
              const w = fs.createWriteStream(outFile);
              stream.pipe(w);
              w.on("close", () => done());
              w.on("error", fail);
            });
          })
        );
        zip.readEntry();
      });
      zip.once("end", () => Promise.all(queue).then(resolve, reject));
      zip.once("error", reject);
    });
  });
}

function apkAbis(apkPath) {
  return new Promise((resolve) => {
    const abis = [];
    if (!exists(apkPath)) return resolve(abis);
    yauzl.open(apkPath, { lazyEntries: true, autoClose: true }, (err, zip) => {
      if (err) return resolve(abis);
      zip.readEntry();
      zip.on("entry", (en) => {
        const m = en.fileName.match(/^lib\/([^/]+)\//);
        if (m && !abis.includes(m[1])) abis.push(m[1]);
        zip.readEntry();
      });
      zip.once("end", () => resolve(abis));
      zip.once("error", () => resolve(abis));
    });
  });
}

function shouldStore(name) {
  if (name.startsWith("lib/")) return true;
  if (name === "resources.arsc") return true;
  if (/\.(ttf|otf)$/.test(name)) return true;
  return false;
}

function zipDir(dir, outFile) {
  return new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile();
    const entries = [];
    (function walk(dirPath) {
      for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
        const abs = path.join(dirPath, entry.name);
        const rel = path.relative(dir, abs).split(path.sep).join("/");
        if (entry.isDirectory()) {
          walk(abs);
        } else if (entry.isFile()) {
          zip.addFile(abs, rel, { compress: !shouldStore(rel) });
          entries.push(rel);
        }
      }
    })(dir);
    zip.end();
    const w = fs.createWriteStream(outFile);
    zip.outputStream.pipe(w);
    w.on("close", () => resolve(entries));
    w.on("error", reject);
    zip.outputStream.on("error", reject);
  });
}

function patchLibg(stageRoot, address, patchBattles) {
  const libs = ["lib/armeabi-v7a/libg.so", "lib/x86/libg.so"];
  const report = { address: { applied: null, found: null, message: null }, battles: [] };
  const needle = asciiBytes(ADDRESS_NEEDLE);
  const want = address ? asciiBytes(address) : needle;

  if (address) {
    if (address.length > ADDRESS_NEEDLE.length) {
      throw new Error(
        `Address "${address}" is ${address.length} chars; must be at most ${ADDRESS_NEEDLE.length} characters (park a subdomain under it).`
      );
    }
    report.address.found = [];
    for (const rel of libs) {
      const file = path.join(stageRoot, rel);
      if (!exists(file)) continue;
      const buf = fs.readFileSync(file);
      const idx = indexOfBytes(buf, needle);
      report.address.found.push({ lib: rel, offset: idx });
      if (idx === -1) {
        report.address.message = `"${ADDRESS_NEEDLE}" not found in ${rel}`;
        continue;
      }
      const bytes = Buffer.from(want);
      for (let i = 0; i < ADDRESS_NEEDLE.length; i++) {
        buf[idx + i] = i < bytes.length ? bytes[i] : 0;
      }
      fs.writeFileSync(file, buf);
      report.address.applied = { lib: rel, offset: idx };
    }
    report.address.applied = report.address.found.length ? report.address.applied : null;
  } else {
    report.address.message = "no address patch requested";
  }

  if (patchBattles) {
    const file = path.join(stageRoot, "lib/armeabi-v7a/libg.so");
    if (exists(file)) {
      const buf = fs.readFileSync(file);
      for (const b of BATTLE_PATCHES) {
        const cur = buf[b.offset];
        report.battles.push({ offset: "0x" + b.offset.toString(16).toUpperCase(), before: "0x" + cur.toString(16).toUpperCase(), ...b });
        if (cur === b.from) {
          buf[b.offset] = b.to;
          report.battles[report.battles.length - 1].applied = true;
        } else {
          report.battles[report.battles.length - 1].applied = false;
        }
      }
      fs.writeFileSync(file, buf);
    }
  }
  return report;
}

async function signApk(apkFile, keystore) {
  const meta = fs.readdirSync(path.dirname(apkFile));
  const pass = keystorePass();
  logs.log("apk", `Signing ${path.basename(apkFile)}...`);
  try {
    await execFile(p.jarsigner, [
      "-verbose",
      "-sigalg", "SHA1withRSA",
      "-digestalg", "SHA1",
      "-keystore", keystore.file,
      "-storepass", pass,
      "-keypass", pass,
      apkFile,
      "android",
    ]);
    return true;
  } catch (e) {
    throw new Error("Signing failed: " + (e.stderr || e.message));
  }
}

/* ------------------------------------------------------------------ *
 * Baking edited game CSVs into the client
 *
 * The 1.9.2 client ships its card data as `assets/csv_logic/*.csv` (and
 * `csv_client/*`) stored in Supercell's "SC" text format: an LZMA1 blob
 * prefixed with the 5-byte coder-properties header `5d 00 00 04 00`
 * (lc=3, lp=0, pb=2, dictionary 256 KiB) plus a 4-byte little-endian
 * uncompressed length. A couple of files (e.g. `skins.csv`) ship plain.
 *
 * Only files that are genuine, faithful edits get baked into the client:
 *   - the client's own copy must decode with the identical schema
 *     (header row, type row, per-row column count, total row count - a
 *     stale or reduced server CSV such as upstream's `skins.csv`, which
 *     ships with fewer rows than the retail client, is never baked);
 *   - the server copy must be free of embedded CR/LF/NUL bytes (this
 *     rejects rows such as the corrupted `USE_STAGGERED_...` value that
 *     upstream ships in `globals.csv`);
 *   - and the content must actually differ from what the client ships.
 *
 * Files failing any check keep the client's original bytes untouched.
 * Baked files are re-encoded into the client's quoted CRLF form and
 * recompressed with the same LZMA1 settings if the original was
 * compressed; plain originals are written back plain. Compression goes
 * through Python's stdlib `lzma`; a tiny Python helper also decodes the
 * client's copies so the schema can be verified before baking.
 * ------------------------------------------------------------------ */

const SC_HEADER = Buffer.from([0x5d, 0, 0, 4, 0]);
const BAKABLE_ASSETS = [
  { apk: "assets/csv_logic", srv: "csv_logic" },
  { apk: "assets/csv_client", srv: "csv_client" },
];

const SC_COMPRESS_PY = [
  "import lzma, sys",
  "src, dst = sys.argv[1], sys.argv[2]",
  "d = open(src, 'rb').read()",
  "c = lzma.compress(d, format=lzma.FORMAT_RAW, filters=[{'id': lzma.FILTER_LZMA1, 'dict_size': 262144}])",
  "open(dst, 'wb').write(b'\\x5d\\x00\\x00\\x04\\x00' + len(d).to_bytes(4, 'little') + c)",
].join("\r\n");

// Decode every client CSV in a staged asset dir and write a JSON map of
// relative filename -> raw text (SC blobs are stream-decompressed, plain
// files are returned as-is) to a temp file instead of stdout, since the
// decoded payload can exceed child_process's stdout buffer.
const SC_DECOMPRESS_PY = [
  "import json, lzma, os, sys",
  "root, outfile = sys.argv[1], sys.argv[2]",
  "RAW = [{'id': lzma.FILTER_LZMA1, 'dict_size': 262144}]",
  "out = {}",
  "for f in os.listdir(root):",
  "    if not f.lower().endswith('.csv'):",
  "        continue",
  "    p = os.path.join(root, f)",
  "    d = open(p, 'rb').read()",
  "    if len(d) >= 9 and d[:5] == b'\\x5d\\x00\\x00\\x04\\x00':",
  "        try:",
  "            dec = lzma.LZMADecompressor(format=lzma.FORMAT_RAW, filters=RAW)",
  "            t = dec.decompress(d[9:]).decode('utf-8', 'replace')",
  "        except Exception:",
  "            t = ''",
  "    else:",
  "        t = d.decode('utf-8', 'replace')",
  "    out[f] = t",
  "open(outfile, 'w', encoding='utf-8').write(json.dumps(out))",
].join("\r\n");

let pythonCmd = undefined;

async function findPython() {
  if (pythonCmd !== undefined) return pythonCmd;
  const candidates = process.platform === "win32" ? ["python", "py", "python3"] : ["python3", "python"];
  for (const cand of candidates) {
    try {
      const args = cand === "py" ? ["-3", "-c", "import lzma"] : ["-c", "import lzma"];
      await execFile(cand, args, { timeout: 30000 });
      pythonCmd = cand;
      return cand;
    } catch (e) {
      pythonCmd = null;
    }
  }
  return pythonCmd;
}

async function runPython(script, args) {
  const cmd = await findPython();
  if (!cmd) {
    throw new Error("Python with the `lzma` module is required to bake card data into the APK.");
  }
  const argv = cmd === "py" ? ["-3", "-c", script, ...args] : ["-c", script, ...args];
  return execFile(cmd, argv, { timeout: 120000 });
}

function isScBlob(buf) {
  return (
    buf.length > SC_HEADER.length &&
    buf[0] === SC_HEADER[0] &&
    buf[1] === SC_HEADER[1] &&
    buf[2] === SC_HEADER[2] &&
    buf[3] === SC_HEADER[3] &&
    buf[4] === SC_HEADER[4]
  );
}

// Server CSVs are unquoted with CRLF rows. The client ships the same data
// with every field double-quoted (still CRLF rows, trailing newline).
function encodeClientCsv(rows) {
  const width = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const lines = rows.map((r) => {
    const cells = [];
    for (let i = 0; i < width; i++) {
      const cell = r[i] === undefined || r[i] === null ? "" : String(r[i]);
      cells.push('"' + cell.replace(/"/g, '""') + '"');
    }
    return cells.join(",");
  });
  return lines.join("\r\n") + "\r\n";
}

function arraysEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// Same number of rows, same header row, same type row, and every row has
// the same number of columns in both files.
function schemaMatches(a, b) {
  if (!a.length || !b.length || a.length !== b.length) return false;
  if (!arraysEqual(a[0], b[0])) return false;
  if (!arraysEqual(a[1], b[1])) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].length !== b[i].length) return false;
  }
  return true;
}

function differs(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (!arraysEqual(a[i], b[i])) return true;
  }
  return false;
}

function cellsClean(rows) {
  for (const r of rows) {
    for (const c of r) {
      if (c.indexOf("\r") !== -1 || c.indexOf("\n") !== -1 || c.indexOf("\u0000") !== -1) {
        return false;
      }
    }
  }
  return true;
}

async function decodedClientCsvs(apkDir) {
  if (!(await findPython())) {
    throw new Error("Python with the `lzma` module is required to bake card data into the APK.");
  }
  const tmp = path.join(os.tmpdir(), `csv-dec-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  try {
    await runPython(SC_DECOMPRESS_PY, [apkDir, tmp]);
    const out = JSON.parse(fs.readFileSync(tmp, "utf8") || "{}");
    if (out && typeof out === "object") return out;
  } catch (e) {
    logs.log("apk", `WARN could not decode client CSVs for comparison: ${e.message}`);
  } finally {
    try { fs.rmSync(tmp, { force: true }); } catch (e) {}
  }
  return {};
}

async function scCompress(buf) {
  const tmpIn = path.join(os.tmpdir(), `sc-in-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const tmpOut = tmpIn + ".sc";
  fs.writeFileSync(tmpIn, buf);
  try {
    await runPython(SC_COMPRESS_PY, [tmpIn, tmpOut]);
    return fs.readFileSync(tmpOut);
  } finally {
    try { fs.rmSync(tmpIn, { force: true }); } catch (e) {}
    try { fs.rmSync(tmpOut, { force: true }); } catch (e) {}
  }
}

// Overwrite the APK's own CSV assets with the server's genuine edits.
// Files that are unchanged, unreproducible, or schema-incompatible keep
// the client's original bytes.
async function bakeGamefiles(stage) {
  const baked = [];

  for (const set of BAKABLE_ASSETS) {
    const srvDir = path.join(p.gameAssets, set.srv);
    const apkDir = path.join(stage, set.apk);
    if (!exists(srvDir) || !exists(apkDir)) continue;

    const client = await decodedClientCsvs(apkDir);
    if (Object.keys(client).length === 0) continue;

    const batch = [];
    for (const f of fs.readdirSync(srvDir)) {
      if (!f.toLowerCase().endsWith(".csv")) continue;
      const apkFile = path.join(apkDir, f);
      if (!exists(apkFile)) continue;
      const clientText = client[f];
      if (typeof clientText !== "string") continue;

      const srvText = fs.readFileSync(path.join(srvDir, f), "utf8").replace(/\u0000/g, "");
      const srvRows = gamefiles.parseCsv(srvText);
      const clientRows = gamefiles.parseCsv(clientText);
      if (!schemaMatches(clientRows, srvRows)) continue;
      if (!cellsClean(srvRows)) continue;
      if (!differs(clientRows, srvRows)) continue;

      batch.push({ f, apkFile, srvRows, isSc: isScBlob(fs.readFileSync(apkFile)) });
    }

    for (const item of batch) {
      if (item.isSc) {
        const text = encodeClientCsv(item.srvRows);
        const blob = await scCompress(Buffer.from(text, "utf8"));
        fs.writeFileSync(item.apkFile, blob);
      } else {
        fs.writeFileSync(item.apkFile, gamefiles.serializeCsv(item.srvRows), "utf8");
      }
      baked.push(`${set.apk}/${item.f}`);
    }
  }
  return baked;
}

async function build(opts = {}) {
  const s = settings.get();
  const address = opts.address !== undefined ? opts.address : s.serverAddress || "";
  if (opts.address !== undefined) s.serverAddress = address;
  const patchBattles = opts.patchBattles !== undefined ? opts.patchBattles : true;
  const patchAddress = opts.patchAddress !== undefined ? opts.patchAddress : !!address;
  const bakeGamefilesOn = opts.bakeGamefiles !== undefined ? !!opts.bakeGamefiles : true;
  const outputPath = opts.outputPath || path.join(p.apkDir, `clash-royale-${Date.now()}.apk`);

  if (!exists(p.baseApk)) {
    throw new Error("Base APK not found at app/assets/retroroyale.apk. Download it from the APK Builder tab.");
  }
  await ensureKeystore();

  const stale = fs.existsSync(p.apkDir) ? fs.readdirSync(p.apkDir).filter((f) => /^clash-royale-.*\.apk$/.test(f)) : [];
  for (const f of stale) {
    try { fs.rmSync(path.join(p.apkDir, f), { force: true }); } catch (e) {}
  }
  if (stale.length) logs.log("apk", `Removed ${stale.length} previous build${stale.length === 1 ? "" : "s"}.`);

  const stamp = Date.now();
  const stage = path.join(p.apkDir, `work-${stamp}`);
  fs.mkdirSync(stage, { recursive: true });
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  building = true;

  try {
    logs.log("apk", `Extracting base client (${formatBytes(fs.statSync(p.baseApk).size)})...`);
    await extractApk(p.baseApk, stage);

    const abis = await apkAbis(p.baseApk);
    const has64 = abis.some((a) => a === "arm64-v8a" || a === "x86_64");
    if (abis.length) {
      logs.log("apk", `Client ABIs: ${abis.join(", ")}${has64 ? "" : " (32-bit only)"}`);
    }

    const report = { address: null, battles: [], csv: null };
    const patched = patchLibg(stage, patchAddress ? address : "", patchBattles);
    Object.assign(report, patched);

    if (bakeGamefilesOn) {
      const baked = await bakeGamefiles(stage);
      report.csv = { baked };
      if (baked.length) {
        logs.log("apk", `Baked ${baked.length} edited game CSVs into the client.`);
      } else {
        logs.log("apk", "No editable game CSVs found to bake into the client.");
      }
    }

    // drop old signatures
    const metaDir = path.join(stage, "META-INF");
    if (exists(metaDir)) fs.rmSync(metaDir, { recursive: true, force: true });

    logs.log("apk", "Repacking APK...");
    const entries = await zipDir(stage, outputPath);
    const size = fs.statSync(outputPath).size;
    logs.log("apk", `Packaged ${entries.length} entries (${formatBytes(size)}).`);

    await signApk(outputPath, { file: p.keystoreFile });
    logs.log("apk", `APK ready: ${outputPath}`);

    s.apk.lastOutput = outputPath;
    s.apk.lastBuild = stamp;
    settings.save(s);

    return {
      ok: true,
      path: outputPath,
      size,
      entries: entries.length,
      abis,
      report,
      signed: true,
    };
  } finally {
    building = false;
    try {
      fs.rmSync(stage, { recursive: true, force: true });
    } catch (e) {}
  }
}

async function status() {
  const s = settings.get();
  return {
    baseApk: exists(p.baseApk),
    baseApkPath: p.baseApk,
    abis: await apkAbis(p.baseApk),
    keystore: exists(p.keystoreFile),
    jarsigner: exists(p.jarsigner),
    keytool: exists(p.keytool),
    jdkInstalled: exists(p.jdkDir),
    building,
    settings: {
      serverAddress: s.serverAddress,
      apk: {
        patchAddress: s.apk.patchAddress,
        patchBattles: s.apk.patchBattles,
        bakeGamefiles: s.apk.bakeGamefiles !== false,
      },
    },
    outputs: {
      lastOutput: s.apk.lastOutput,
      lastBuild: s.apk.lastBuild,
    },
  };
}

module.exports = { build, status, ensureKeystore, signApk, startDownload, currentDownloadState, onDownload, offDownload, BASE_APK_URL };