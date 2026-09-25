# SlashRoyale

Self-hosted Clash Royale private server based on [HashRoyale](https://github.com/Hashmane/HashRoyale) (itself a fork of ZrdRoyale), packaged with a web admin panel and a Pinokio launcher.

Install it from Pinokio, and the panel gives you an all-in-one way to run and manage your server:

- one-click start for the whole stack (MariaDB + main game server + battle server) with live logs
- edit game data (`csv_logic` / `csv_client` CSV files) and browse/edit the game database
- administer players (level, trophies, cards, admin/ban), tune game rules, set the address players connect to
- rebuild your client APK patched to point at your server, signed with a locally generated keystore

## Components & ports

| Component | Lives in | Managed in |
| --- | --- | --- |
| Admin panel (Node.js) | `app/` | — |
| MariaDB (portable) | `env/mariadb` | Server tab |
| Main game server (.NET 8) | `server/publish` | Server tab |
| Battle server (.NET 8) | `server/publish-battles` | Server tab |
| APK toolchain (OpenJDK 21+) | `env/jdk` | APK Builder tab |

Ports (fixed by the server code):

- **9339** – main server, where the game client connects
- **9449** – battle server
- **9876** – main ↔ battle cluster (UDP, requires `use_udp: true`)
- **3306** – MariaDB (the server connection setting has no port option, so MariaDB must stay here)
- **3000** – admin panel

## Getting started

1. **Install** (`install.js`) – installs the .NET 8 SDK (`env/dotnet`), an OpenJDK 21+ (`env/jdk`) and a portable MariaDB (`env/mariadb`) for your platform, retargets the battle project to .NET 8, publishes both game servers, and installs panel dependencies.
2. **Start** (`start.js`) – launches the admin panel. Hit **Start server** on the Server tab to bring up the database, main server and battle server together. Each process is only marked "up" once it genuinely reports ready, and nothing listens on 3306/9339/9449 until you start the stack. The database and its schema are created automatically on the first start.
3. **Build an APK** and install it on a phone (see below) — players then connect to your address on port 9339.

The launcher menu also offers **Update** (re-apply the .NET 8 retarget, re-publish both servers, refresh panel dependencies) and **Reset** (wipe `env/`, `app/node_modules`, `app/data` and both `server/publish*` folders so you can reinstall from scratch).

## Using the panel

### Server & live logs
The Server tab shows the status of the database, main and battle servers, a Start / Restart button, and the **live log** with history replayed on open. Sources: `app`, `db`, `main`, `battles`, `apk`, `gamefiles`, `activity`. Starting the stack clears the log first so you only see the current session.

While the stack runs, **player activity** is detected by polling the `player` table every 2 s and logged under the `activity` source:

- **registered** – a new player row appeared
- **logged in (#N)** – the player's session count went up
- **disconnected (session lasted …)** – a play session ended, with its duration

### Edit game data (CSV tab)
Edits the server's `GameAssets` files live (`csv_logic/*` card stats and `csv_client/*` client data) — no rebuild needed. Changes are picked up on the next main-server restart. **Restore pristine data** resets all GameAssets from the untouched source clone.

> **Why your edit didn't show up in-game:** card stats (damage, hitpoints, unit counts…) are computed by the **client** from the CSV copies shipped inside the APK — the servers only relay battle commands. Editing the server's CSVs changes what the *server* knows, but the client keeps its baked-in stats until you **rebuild the APK** (baking is enabled by default) so your edited CSVs are written into the client.

### Database (Database tab)
Start the server stack first. Lists every table in the game database with row counts and sizes; browses rows (paginated, editable cells) and runs an **SQL console** (one statement at a time, reads and writes; results capped at 1000 rows — add a `LIMIT`). **Save row** writes an `UPDATE` keyed on the primary key and **Delete** removes the row; both are guarded by a confirm when "confirm writes" is on. Tables without a primary key are read-only. Uses the same `root` credentials the servers use.

> **Player `Trophies` is read-only-ish.** The server mirrors this column from the player's `Home` JSON and overwrites it on every save. Use the Players tab instead — it writes the underlying `Home` JSON and keeps the mirror in sync.

### Players (Players tab)
A no-raw-JSON way to administer accounts: list/filter every player (level, trophies, gold, gems, session count, admin/banned badges); rename, set level (1–13), trophies, gold, gems (trophy edits recompute the arena and the mirrored `Trophies` column); **Unlock all cards** / **Max all cards** (level 13); toggle **admin / banned** — written to the main server's `config.json` (`admins` / `banned_ids`, the same lists the `/admin` and `/ban` chat commands use), applied on the next **main-server restart**. Data edits apply on the player's next login; best done while the stack is stopped or the player is offline.

### Config tab
- **Connect** – the server address baked into rebuilt APKs. Defaults to this machine's LAN IP; **Use local IP** fills it in automatically. It's written into the client the next time you build an APK.
- **Game rules** – edits the main server's `config.json` directly (restart the stack to apply). Out-of-the-box values: `MinTrophies` **25** / `MaxTrophies` **34** — the winner of a regular battle gets a random trophy value in that range (`Random.Next(Min, Max)`, so 25–33), while friendly and 2v2 battles always award 0; `DefaultGold` **1000**, `DefaultGems` **1000**, `DefaultLevel` **1**, `GemsToGiveAfterMatch` **0**, `GoldToGiveAfterMatch` **20**.

## Building the client APK

The **APK Builder** tab repackages the RetroRoyale base client at `app/assets/retroroyale.apk`:

- **Base client download** – if the APK file is missing, the builder shows a popup that downloads it for you (~90 MB).
- **Patches the server address** into both 32-bit `libg.so` binaries (`cluster.retroroyale.xyz` is replaced; see the length note below), conditionally applies the battle checksum patch, and re-signs with a locally generated keystore (`app/data/keystore/release.jks`).
- **Bakes your CSV edits** (`csv_logic` + `csv_client`) into the client: each genuine, schema-valid edit is decompressed, checked against the client's own copy (identical headers/type rows, column and row counts, no embedded newlines/NULs), then re-encoded and compressed into the client's SC/LZMA format inside the APK. Unchanged, stale, reduced or corrupt files (e.g. upstream's `skins.csv`, `globals.csv`) stay byte-for-byte untouched so a bad server file can never break the client at boot. Requires Python with the standard `lzma` module on `PATH`.
- If a battle patch offset doesn't match the expected bytes it is skipped with a warning and the build still completes. The base APK is never written to.
- The build output (e.g. `app/data/apk/clash-royale-<timestamp>.apk`) replaces any previous build.

> **Android version caveat:** the RetroRoyale-era client ships **32-bit native libraries only** (`armeabi-v7a`, `x86`). Android 16+ phones are 64-bit-only and will refuse to install it. Use a 32-bit-capable device or an Android ≤ 15 handset. The builder shows the client's ABIs so you can check before transferring.

## API

The panel exposes a JSON API under `http://127.0.0.1:3000/api`.

### JavaScript

```javascript
const base = "http://127.0.0.1:3000/api";
const res = await fetch(`${base}/status`);
const data = await res.json();
console.log(data.servers.main.state);
```

### curl

```bash
# overall status (db, server stack, toolchain)
curl http://127.0.0.1:3000/api/status

# one-click stack: start / stop / restart everything together
curl -X POST http://127.0.0.1:3000/api/stack/start
curl -X POST http://127.0.0.1:3000/api/stack/stop
curl -X POST http://127.0.0.1:3000/api/stack/restart
curl http://127.0.0.1:3000/api/stack/status

# set the address baked into the client APK
curl -X POST http://127.0.0.1:3000/api/settings/address \
  -H "Content-Type: application/json" \
  -d '{"address":"192.168.1.50"}'

# edit a game CSV (card stats / client data)
curl http://127.0.0.1:3000/api/gamefiles/csv_logic/characters.csv
curl -X POST http://127.0.0.1:3000/api/gamefiles/csv_logic/characters.csv \
  -H "Content-Type: application/json" \
  -d '{"headers":["Name","Rarity"],"types":["text","text"],"data":[["Golem","Epic"]]}'

# build a patched APK (long-running; watch /api/logs/all/stream)
curl -X POST http://127.0.0.1:3000/api/apk/build \
  -H "Content-Type: application/json" \
  -d '{"address":"127.0.0.1","patchAddress":true,"patchBattles":true,"bakeGamefiles":true}'

# live logs (Server-Sent Events)
curl -N http://127.0.0.1:3000/api/logs/all/stream
```

### Endpoint reference

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | liveness probe |
| GET | `/api/status` | db / servers / toolchain / address / configs summary |
| GET | `/api/settings/localip` | this machine's suggested LAN address |
| POST | `/api/settings/address` | set the address baked into client APKs (`{address}`) |
| POST | `/api/stack/start` `/api/stack/stop` `/api/stack/restart` | one-click stack control |
| GET | `/api/stack/status` | current stack state |
| POST | `/api/db/start` `/api/db/stop` | database lifecycle (low-level) |
| GET | `/api/db/status` | database status (low-level) |
| POST | `/api/server/:name/:action` | `main`/`battles` × `start`/`stop`/`restart` (low-level) |
| GET | `/api/gamefiles` | list `csv_logic` / `csv_client` files |
| GET/POST | `/api/gamefiles/:file.csv` | read / edit a CSV table (e.g. `csv_logic/characters.csv`) |
| POST | `/api/gamefiles/restore` | restore pristine GameAssets |
| GET | `/api/gamefiles/diff` | files changed vs. pristine |
| GET | `/api/dbview/tables` | list tables in the game database (rows, sizes) |
| GET | `/api/dbview/table/:table` | paginated rows + schema (`?limit=&offset=`; returns `pk`) |
| POST | `/api/dbview/query` | run one SQL statement, read or write |
| POST | `/api/dbview/update` | `UPDATE` a row by primary key (`{table, pk, set}`) |
| GET | `/api/players` | list players (level, trophies, gold, gems, admin, banned) |
| POST | `/api/players/:id` | edit a player: `{patch: {name, level, trophies, gold, gems}}`, `{cards: "unlock"\|"max"}`, `{admin: bool}`, `{banned: bool}` (admin/ban → restart main) |
| GET/POST | `/api/config/main` | read / patch the main server's `config.json` (numeric knobs via `{config: {...}}`) |
| POST | `/api/apk/build` | build patched APK (`address`, `patchAddress`, `patchBattles`, `bakeGamefiles`, `outputPath`) |
| GET | `/api/apk/status` | base APK / keystore / JDK / last build info |
| POST | `/api/apk/download` | start the base-client download (if missing) |
| GET | `/api/apk/download/stream` | base-client download progress (SSE) |
| GET | `/api/logs` | all buffered log lines per source |
| GET | `/api/logs/all/stream` | SSE stream of every source |
| GET | `/api/logs/:proc/stream` | SSE stream for one source (`app`, `db`, `main`, `battles`, `apk`, `activity`, `gamefiles`) |

## Notes & limitations

- **MariaDB occupies 3306.** If a system MySQL/MariaDB already listens there, the panel refuses to start its own instance instead of fighting it. Move the other service to a different port.
- **Address is ≤ 21 characters.** It replaces `cluster.retroroyale.xyz` (21 bytes) in each `libg.so`; a longer value cannot fit. Defaults to this machine's LAN IP; change it on the **Config tab → Connect**.
- The battle checksum patch targets specific offsets in the RetroRoyale-derived `libg.so`. On a base APK where those bytes differ, the patch is skipped with a warning rather than corrupting the binary.
- The APK is signed with **v1 (JAR) signatures only** (needed for old-Android compatibility) and is not zipaligned; the retro client runs from anywhere, but release-store distribution should run `zipalign` afterwards.

Every mutating call returns `{ ok: true, ... }` and errors return `{ ok: false, error }` with a 4xx/5xx status.