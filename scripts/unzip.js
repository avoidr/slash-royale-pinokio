"use strict";

// Extract a .zip archive to a directory using the panel's yauzl dependency.
// Usage: node scripts/unzip.js <archive.zip> <dest-dir>
const path = require("path");
const fs = require("fs");
const yauzl = require(path.join(__dirname, "..", "app", "node_modules", "yauzl"));

const src = process.argv[2];
const dest = process.argv[3];

if (!src || !dest) {
  console.error("usage: node scripts/unzip.js <archive.zip> <dest-dir>");
  process.exit(2);
}

fs.mkdirSync(dest, { recursive: true });

yauzl.open(src, { lazyEntries: true, autoClose: true }, (err, zip) => {
  if (err) {
    console.error("open failed: " + err.message);
    process.exit(1);
  }
  let pending = 0;
  let failed = false;
  zip.readEntry();
  zip.on("entry", (entry) => {
    if (/\/$/.test(entry.fileName)) {
      zip.readEntry();
      return;
    }
    pending++;
    const out = path.join(dest, entry.fileName);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    zip.openReadStream(entry, (err2, stream) => {
      if (err2) {
        failed = true;
        console.error("read failed: " + err2.message);
        finish();
        return;
      }
      const w = fs.createWriteStream(out);
      stream.pipe(w);
      w.on("close", () => {
        if (!--pending) finish();
      });
      w.on("error", (e) => {
        failed = true;
        console.error("write failed: " + e.message);
        finish();
      });
    });
    zip.readEntry();
  });
  zip.on("end", () => finish());
  zip.on("error", (e) => {
    failed = true;
    console.error(e.message);
    finish();
  });
  let done = false;
  function finish() {
    if (done) return;
    if (pending > 0) return;
    done = true;
    if (failed) process.exit(1);
    console.log("extracted to " + dest);
  }
});