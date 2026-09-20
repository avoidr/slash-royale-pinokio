"use strict";

const path = require("path");
const fs = require("fs");

const APP = path.join(__dirname, ".."); // app/ (panel code)
const ROOT = path.resolve(APP, ".."); // launcher root

const p = {
  root: ROOT,
  app: APP,
  envDir: path.join(ROOT, "env"),
  envLogs: path.join(ROOT, "env", "logs"),
  serverDir: path.join(ROOT, "server"),
  cloneDir: path.join(ROOT, "server", "HashRoyale"),
  mainServerDir: path.join(ROOT, "server", "publish"),
  battlesServerDir: path.join(ROOT, "server", "publish-battles"),

  dotnetDir: path.join(ROOT, "env", "dotnet"),
  jdkDir: path.join(ROOT, "env", "jdk"),
  mariadbDir: path.join(ROOT, "env", "mariadb"),
  mariadbData: path.join(ROOT, "env", "mariadb-data"),

  appData: path.join(APP, "data"),
  settingsFile: path.join(APP, "data", "settings.json"),
  keystoreDir: path.join(APP, "data", "keystore"),
  keystoreFile: path.join(APP, "data", "keystore", "release.jks"),
  apkDir: path.join(APP, "data", "apk"),
  assetsDir: path.join(APP, "assets"),
  baseApk: path.join(APP, "assets", "retroroyale.apk"),

  csprojMain: path.join(ROOT, "server", "HashRoyale", "src", "ClashRoyale", "ClashRoyale.csproj"),
  csprojBattles: path.join(ROOT, "server", "HashRoyale", "src", "ClashRoyale.Battles", "ClashRoyale.Battles.csproj"),
  databaseSql: path.join(ROOT, "server", "HashRoyale", "src", "ClashRoyale", "GameAssets", "database.sql"),
  pristineGameAssets: path.join(ROOT, "server", "HashRoyale", "src", "ClashRoyale", "GameAssets"),
  gameAssets: path.join(ROOT, "server", "publish", "GameAssets"),

  mainDll: path.join(ROOT, "server", "publish", "ClashRoyale.dll"),
  battlesDll: path.join(ROOT, "server", "publish-battles", "ClashRoyale.Battles.dll"),
};

function exeName() {
  return process.platform === "win32" ? ".exe" : "";
}

function pickFirst(candidates) {
  for (const c of candidates) {
    try {
      fs.accessSync(c, fs.constants.F_OK);
      return c;
    } catch (e) {}
  }
  return candidates[0];
}

const ext = exeName();

p.dotnetBin = path.join(p.dotnetDir, "dotnet" + ext);
p.jarsigner = pickFirst([
  path.join(p.jdkDir, "bin", "jarsigner" + ext),
  path.join(p.jdkDir, "Library", "bin", "jarsigner" + ext),
]);
p.keytool = pickFirst([
  path.join(p.jdkDir, "bin", "keytool" + ext),
  path.join(p.jdkDir, "Library", "bin", "keytool" + ext),
]);
p.mariadbd = pickFirst([
  path.join(p.mariadbDir, "bin", "mariadbd" + ext),
  path.join(p.mariadbDir, "Library", "bin", "mariadbd" + ext),
]);
p.mariadbInstallDb = pickFirst([
  path.join(p.mariadbDir, "bin", "mariadb-install-db" + ext),
  path.join(p.mariadbDir, "bin", "mysql_install_db" + ext),
]);
p.mariadbClient = pickFirst([
  path.join(p.mariadbDir, "bin", "mariadb" + ext),
  path.join(p.mariadbDir, "bin", "mysql" + ext),
]);

function ensure() {
  for (const dir of [
    p.envLogs,
    p.appData,
    p.keystoreDir,
    p.apkDir,
    p.serverDir,
    p.mariadbData,
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function exists(full) {
  try {
    fs.accessSync(full, fs.constants.F_OK);
    return true;
  } catch (e) {
    return false;
  }
}

module.exports = { p, ensure, exists };