"use strict";

const { execFileSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const root = path.resolve(__dirname, "..");
const dotnet = path.join(
  root,
  "env",
  "dotnet",
  process.platform === "win32" ? "dotnet.exe" : "dotnet"
);

if (!fs.existsSync(dotnet)) {
  console.error("dotnet SDK not found: " + dotnet + " (run Install first)");
  process.exit(2);
}

const targets = [
  {
    name: "ClashRoyale (main server)",
    csproj: path.join(root, "server", "HashRoyale", "src", "ClashRoyale", "ClashRoyale.csproj"),
    out: path.join(root, "server", "publish"),
  },
  {
    name: "ClashRoyale.Battles (battle server)",
    csproj: path.join(root, "server", "HashRoyale", "src", "ClashRoyale.Battles", "ClashRoyale.Battles.csproj"),
    out: path.join(root, "server", "publish-battles"),
  },
];

for (const t of targets) {
  if (!fs.existsSync(t.csproj)) {
    console.error("missing csproj: " + t.csproj);
    process.exit(2);
  }
  console.log("=== Publishing " + t.name + " ===");
  execFileSync(dotnet, ["publish", t.csproj, "-c", "Release", "-o", t.out], { stdio: "inherit" });
}

console.log("Publish complete.");