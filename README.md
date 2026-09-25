# SlashRoyale

Self-hosted Clash Royale private server based on [HashRoyale](https://github.com/Hashmane/HashRoyale) (fork by Hashmane, itself a fork of ZrdRoyale), wrapped in a web admin panel and a Pinokio launcher.

**Start → install → open the panel.** The panel starts your MariaDB database, main game server and battle server together with one click, streams their live logs, lets you edit any game CSV (card stats, client data…) and browse/edit the database, and rebuilds your client APK.

## What this gives you

| Component | Runs on | Managed in panel |
| --- | --- | --- |
| Admin web panel | Node.js (bundled with Pinokio) | — |
| MariaDB (portable, in `env/`) | `env/mariadb/bin/mariadbd` | Server tab (part of the stack) |
| Main game server | .NET 8 (`ClashRoyale`) | Server tab (part of the stack) |
| Battle server | .NET 8 (`ClashRoyale.Battles`) | Server tab (part of the stack) |
| APK toolchain | OpenJDK in `env/jdk` | APK Builder tab |

Ports (fixed by the server code — the game always talks to 9339, battles to 9449, cluster 9876):

- **9339** main server (players' client connects here)
- **9449** battle server
- **9876** main ↔ battle cluster (UDP, requires `use_udp: true`)
- **3306** MariaDB (the server connection string has no port option, so MariaDB must stay on 3306)
- **3000** admin panel

## How to use

1. **Install** – builds the bundled SlashRoyale source (fork of HashRoyale), retargets the battle project to .NET 8, installs the .NET 8 SDK into `env/dotnet`, an OpenJDK into `env/jdk`, a portable MariaDB into `env/mariadb`, publishes both servers, and installs panel dependencies.
2. **Start** – launches the panel. Click **Start servers** on the Server tab to bring up the MariaDB database plus the main and battle servers together. Each start first clears the log side so you only see the current session, and the panel waits for each server to genuinely report ready before saying "up". Nothing listens on 3306/9339/9449 until you do. The panel also auto-creates the database and schema the first time a server starts.
3. **Build your APK** – **APK Builder** tab. It uses the base client at `app/assets/retroroyale.apk` (if the file is missing, the builder shows a popup that downloads it for you — ~90 MB), patches the server address (defaults to this machine's LAN IP — change it in the APK Builder) into both 32-bit `libg.so` binaries, conditionally applies the battle checksum patch, **bakes every genuine edit you made in the CSV tab (`csv_logic` + `csv_client`) into the client**, drops the old signatures, repacks, and signs with a locally generated keystore (`app/data/keystore/release.jks`).
   - **Baking card data (always on):** the client decides card stats itself (damage, hitpoints, spawn counts…) from the CSV files shipped inside the APK — the server is only a relay for battles. Baking re-encodes the CSVs you edit in the **CSV** tab into the client's SC/LZMA format and overwrites the copies inside the APK, so your edits actually take effect in-game. Only **genuine, schema-valid edits** are baked: each candidate is first decompressed and checked against the client's own copy (identical header/type rows, column and row counts, no embedded newlines/NULs). Unchanged files and any file whose server copy is stale, reduced, or corrupt (e.g. upstream's `skins.csv` or `globals.csv`) are left byte-for-byte untouched, so a bad server file can never break the client at boot. Requires Python with the standard `lzma` module on `PATH` (used only to compress the CSVs).
   - Note the patch offsets depend on the base APK variant. If a battle patch offset doesn't match the expected bytes it is skipped and a warning is shown; the build still completes. The base APK is never written to.
4. **Connect** – players install the built APK and play on your address (port 9339).
   - **Android version caveat:** the RetroRoyale-era client ships **32-bit native libraries only** (`armeabi-v7a`, `x86`). Android 16 and newer phones are 64-bit-only and will refuse to install it ("app isn't compatible with your phone"). Use a 32-bit-capable device or an Android ≤ 15 handset, or obtain an `arm64-v8a` build of the client. The APK Builder shows the client's ABIs so you can check before transferring.
5. **Logs** – the Logs tab streams every process (`db`, `main`, `battles`, `apk`, `panel`) live, with history replayed on open.

### Editing game data (CSV files)

The **CSV** tab edits the server's `GameAssets` files live (both `csv_logic/*` — card stats — and `csv_client/*`), no rebuild needed. Changes are picked up on the next main-server restart. **Restore pristine data** resets all GameAssets from the untouched clone, and the same action is available in the APK Builder (`Revert server to default`).

> **Why your edit didn't show up in-game:** card stats (damage, hitpoints, unit counts…) are computed by the **client** from the CSV copies that ship inside the APK — the servers only relay battle commands. Editing the server's CSVs changes what the *server* knows, but the client keeps using its own baked-in stats until you **rebuild the APK with baking enabled** (default) so your edited CSVs are written into the client. (Content patches deliver a different, network-based path that is off by default here.)

> Client-side card stats require the server to serve a content patch (`use_content_patch`) — by default server-side stat changes apply to gameplay; cosmetic/side-information changes on the client won't show until content patching is enabled.

### Database browser

The **Database** tab (start the server stack first) browses and edits the game database directly:

- **Tables** – live list of every table in the `rrdb` database with row counts and sizes.
- **Table data** – paginated rows with editable cells. **Save row** writes an `UPDATE` keyed on the primary key; **Delete** removes the row (both guarded by a confirm when "confirm writes" is on). Tables without a primary key are read-only here.
- **SQL console** – run arbitrary single statements; results render as a table, writes report affected rows. Results are capped at 1000 rows (add a `LIMIT`). The panel uses the same `root` credentials the servers use.

> **Player `Trophies` column is read-only-ish.** The server mirrors this column from the player's `Home` JSON (`Home.Arena.Trophies`) and overwrites it on every save, so editing the `Trophies` cell directly has no lasting effect. Use the **Players** tab instead — it writes the underlying `Home` JSON and keeps the mirror in sync.

CLI shortcuts for the same operations: `/api/dbview/*` endpoints (see table below).

### Player editor (Players tab)

The **Players** tab is the simplified, no-raw-JSON way to administer accounts:

- **List** – every player with level, trophies, gold, gems, session count and admin/banned badges; filterable.
- **Basics** – rename a player, set level (1–13), trophies, gold and gems. Trophies edits recompute the arena from `arenas.csv` and update the mirrored `Trophies` column.
- **Cards** – **Unlock all cards** adds every card from the game's CSV data (spells_characters/buildings/other) to the deck; **Max all cards** also sets them to level 13 (what the `/max` chat command intends).
- **Admin / Ban** – toggles the player in the main server's `config.json` (`admins` / `banned_ids`), the exact same lists the `/admin` and `/ban` chat commands use. These need a **main server restart** to take effect (the chat command path reloads live; the panel edits the file).
- Changes to player data apply on the player's next login — usually best done while the stack is stopped or the player is offline.

### Game rules (Config tab)

The **Config** tab edits the main server's `config.json` directly (no rebuild, restart the server stack to apply):

- `MinTrophies` / `MaxTrophies` – battle rewards. Defaults are **0 / 0**, meaning battles never change trophies; set e.g. 30/60 so wins actually award trophies (the winner gets a random value in the range).
- `DefaultGold`, `DefaultGems`, `DefaultLevel`, `GemsToGiveAfterMatch`, `GoldToGiveAfterMatch` – economy defaults and post-match rewards.

### Player activity

The Logs tab's **Player activity** filter shows registration / login / disconnect events detected from the `player` table (polled every 2 s while the stack runs):

- **registered** – a new player row appeared.
- **logged in (#N)** – the player's session count increased.
- **disconnected (session lasted …)** – the player ended a play session, with its final duration (the battle/main server writes the finalized session at logout).

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

# one-click stack: start / stop everything together
curl -X POST http://127.0.0.1:3000/api/stack/start
curl -X POST http://127.0.0.1:3000/api/stack/stop
curl http://127.0.0.1:3000/api/stack/status

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
| POST | `/api/stack/start` `/api/stack/stop` | start / stop db + main + battles together |
| GET | `/api/stack/status` | current stack state |
| POST | `/api/db/start` `/api/db/stop` | database lifecycle (low-level) |
| POST | `/api/server/:name/:action` | `main`/`battles` × `start`/`stop`/`restart` (low-level) |
| GET | `/api/gamefiles` | list csv_logic / csv_client files |
| GET/POST | `/api/gamefiles/:file.csv` | read / edit a CSV table (e.g. `csv_logic/characters.csv`) |
| POST | `/api/gamefiles/restore` | restore pristine GameAssets |
| GET | `/api/dbview/tables` | list tables in the game database (rows, sizes) |
| GET | `/api/dbview/table/:table` | paginated rows + schema (`?limit=&offset=`; returns `pk`) |
| POST | `/api/dbview/query` | run one SQL statement, read or write |
| POST | `/api/dbview/update` | `UPDATE` a row by primary key (`{table, pk, set}`) |
| GET | `/api/players` | list players (level, trophies, gold, gems, admin, banned) |
| POST | `/api/players/:id` | edit a player: `{patch: {name, level, trophies, gold, gems}}`, `{cards: "unlock"\|"max"}`, `{admin: bool}`, `{banned: bool}` (admin/ban → restart main) |
| GET | `/api/config/main` | read the main server's `config.json` |
| POST | `/api/config/main` | patch numeric game knobs (`MinTrophies`, `MaxTrophies`, gold/gems, …) via `{config: {...}}` |
| POST | `/api/apk/build` | build patched APK (`address`, `patchAddress`, `patchBattles`, `bakeGamefiles`, `outputPath`) |
| GET | `/api/apk/status` | base APK / keystore / JDK / last build info |
| GET | `/api/logs` | all buffered log lines per process |
| GET | `/api/logs/all/stream` | SSE stream of every process |
| GET | `/api/logs/:proc/stream` | SSE stream for one process (`app`, `db`, `main`, `battles`, `apk`, `gamefiles`) |

## Notes & limitations

- **MariaDB occupies 3306.** If a system MySQL/MariaDB already listens there, the panel refuses to start its own instance rather than fight it. Change the other service to a different port.
- **Address length ≤ 21 chars.** The address bytes replace `cluster.retroroyale.xyz` in each `libg.so`; a longer value cannot fit. The address defaults to this machine's LAN IP.
- The battle checksum patch targets specific offsets in the RetroRoyale-derived `libg.so`. On a base APK where those bytes differ, the patch is skipped with a warning instead of corrupting the binary.
- The APK is signed with **v1 (JAR) signatures only** (required for old Android compatibility) and is not zipaligned; the retro client runs from anywhere, but release-store distribution should run `zipalign` afterwards.
- `update.js` retargets the battle project to .NET 8 (if needed), republishes both servers, and refreshes panel dependencies. The panel code lives in this launcher folder (no remote), so it updates with the launcher itself.

Every mutating call returns `{ ok: true, ... }` and errors return `{ ok: false, error }` with a 4xx/5xx status.