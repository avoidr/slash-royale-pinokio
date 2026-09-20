"use strict";

const fs = require("fs");
const path = require("path");

const file = path.resolve(
  "server",
  "HashRoyale",
  "src",
  "ClashRoyale.Battles",
  "ClashRoyale.Battles.csproj"
);

if (!fs.existsSync(file)) {
  console.error("csproj not found: " + file);
  process.exit(1);
}

const before = fs.readFileSync(file, "utf8");
const after = before.replace(
  /<TargetFramework>netcoreapp3\.1<\/TargetFramework>/g,
  "<TargetFramework>net8.0</TargetFramework>"
);

if (after !== before) {
  fs.writeFileSync(file, after);
  console.log("retargeted ClashRoyale.Battles to net8.0");
} else {
  console.log("ClashRoyale.Battles already targets net8.0");
}