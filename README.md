# EveJS-CPI

A mod for EveJS allowing for Configurable Planetary Infrastructure multipliers.

Each setting accepts any number above zero, such as 0.5, 2 or 50. 1 is retail.

| Setting | Multiplies | Retail | ×2 |
|---|---|---|---|
| **Command center fitting multiplier** (`piCommandCenterFittingMultiplier`) | Command center CPU, at every upgrade level | 1675 tf at level 0 | 3350 tf |
| | Command center powergrid, at every upgrade level | 6000 MW at level 0 | 12000 MW |
| **Connection bandwidth multiplier** (`piConnectionBandwidthMultiplier`) | Link bandwidth (`logisticalCapacity`, before the ×2 per link level) | 1250 m³/h | 2500 m³/h |
| **Storage capacity multiplier** (`piStorageCapacityMultiplier`) | Storage facility capacity | 12000 m³ | 24000 m³ |
| | Launch pad capacity | 10000 m³ | 20000 m³ |
| | Command center storage | 500 m³ | 1000 m³ |
| **P1 schematic duration multiplier** (`piP1SchematicDurationMultiplier`) | Cycle time of schematics that make P1 | 30 min | 60 min |
| **P2 schematic duration multiplier** (`piP2SchematicDurationMultiplier`) | Cycle time of schematics that make P2 | 60 min | 120 min |
| **P3 schematic duration multiplier** (`piP3SchematicDurationMultiplier`) | Cycle time of schematics that make P3 | 60 min | 120 min |
| **P4 schematic duration multiplier** (`piP4SchematicDurationMultiplier`) | Cycle time of schematics that make P4 | 60 min | 120 min |

A duration multiplier below 1 makes factories faster: 0.5 halves the cycle, so a factory runs
twice as often. Output per cycle stays retail, so a factory also uses its inputs up at the new
speed: the same raw material still makes the same amount of product, just sooner. A schematic's
tier is its product's, so the P4 schematics that take a P1 input next to their P3 inputs follow
the P4 setting.

Unchanged: what each structure and link uses, command center upgrade costs, extraction and
factory output per cycle.

CPU and powergrid round half up to whole numbers. Cycle times round half up to whole seconds,
and never go below one second. Bandwidth and storage are not rounded.

## Why it changes the client too

The EVE client works these numbers out from its own files and checks a colony against them before
the server sees anything: `planetCommon.commandCenterInfoPerLevel`, `BaseLink.GetBaseBandwidth`,
`StoragePin.GetCapacity` and its schematic table. A server-only multiplier above 1 would leave the
client refusing to build past retail, and a server-only cycle time would leave the client's colony
simulation, progress bars and route bandwidth on retail until the next relog. CPI applies the same
settings on both sides, so the planet screen shows and checks what the server enforces.

## Install

1. Download `EveJS-CPI-<version>.zip` from this repository's
   [Releases](https://github.com/Its-Zaq/EveJS-CPI/releases) and import it in the Launcher's
   Mods page, or copy its `evejs-cpi` folder into the EveJS installation's `mods` folder. It
   arrives disabled (`loader.js.disabled`).
2. **Configure** sets the multipliers. The Launcher saves them to `preferences.json` in this folder.
3. Enable the mod and start the server with mods (Native Modded). Docker is not supported.
4. Players log in again to pick up new values.

The server console shows `[CPI] on the server and at client login:` followed by every setting
that is not 1, such as `piStorageCapacityMultiplier x2`, when the mod is on. The handshake log
shows `CPI:OK:` and the same settings from each client, sorted by name and written the Python
way (`piStorageCapacityMultiplier x2.0`).

Changing a setting needs a server restart, and each player's next login brings the new value.
Disabling the mod and restarting returns the server to retail. A client still running from a
CPI login returns to retail by itself at its next login, because the patch holds only for the
handshake that delivered it.

### Updates

From 1.1.1 on, the Launcher's Mods page offers each new CPI release from this repository: **Check
mod updates** shows it with its release notes, and nothing installs until you choose to. An
update keeps `preferences.json`, so your settings carry over. CPI 1.1.0 and earlier don't say
where their updates come from, so import 1.1.1 by hand once; the Launcher finds every later
version itself.

### Updating from CPI 1.0

CPI 1.0 had one setting, `planetaryInfrastructureCapacityMultiplier`, for all three capacities.
On the first server start after the update, CPI replaces it in `preferences.json` with the three
capacity settings, each set to the old value, and logs `[CPI] preferences.json: replaced
planetaryInfrastructureCapacityMultiplier with the three capacity settings.` A capacity setting
already in the file keeps its own value. If the file cannot be rewritten, CPI logs why and still
applies the old value to every capacity setting the file lacks.

## How it works

`loader.js` is a Node preload (`--require`). Apart from the one-time update of `preferences.json`
above, it changes nothing on disk.

- **Server.** `lib/serverPatches.js` wraps four exports of EveJS's
  `server/src/services/planet/planetStaticData.js` as the module loads:
  `getCommandCenterInfo` (CPU and powergrid), `getUsageParametersForLinkType`
  (`logisticalCapacity`), `getPITypeInfo` (`capacity`, for storage, spaceport and command
  pins) and `getSchematicByID` (`cycleTime`, by the tier `getCommodityTier` gives the
  schematic's product). EveJS reads these through the module object, so colony validation,
  production, routing, expedited transfers and launch pad imports all see the scaled values. A
  scaled schematic is a copy: EveJS's cached schematic never changes.
- **Client.** `lib/loginDelivery.js` appends one statement to EveJS's
  `server/src/network/tcp/handshake.js` as Node compiles it, rebinding `buildTidiSignedFunc` to
  a wrapper. The wrapper runs EveJS's login code first, then `client/cpi.py` (sent as base64, in a
  private namespace), and returns EveJS's result. `cpi.py` wraps `planetCommon.GetCPUOutput`,
  `planetCommon.GetPowerOutput`, `BaseLink.GetBaseBandwidth`, `StoragePin.GetCapacity` and
  `SchematicsLoader.GetData` in the client's memory. `SpaceportPin` and `CommandPin` inherit
  `GetCapacity`. Every client reader of a schematic asks `SchematicsLoader.GetData` for the table
  when it runs, so the scaled cycle reaches process pins (simulation, progress bars, route
  bandwidth), the schematic picker and its tooltips alike.

Nothing about a factory's cycle is saved per pin: both sides keep only when it last ran and read
the cycle time each time. Running factories pick up a new duration at their next cycle, and
routes need no change.

The two halves switch on together or not at all. The server half reports retail values until the
handshake builder has been wrapped and its output checked. It stays at retail, and logs
`[CPI] disabled, PI stays at retail: <reason>`, when any of these is true:

- `handshake.js` does not declare `buildTidiSignedFunc` exactly once;
- EveJS's payload is not the expected marshal string;
- `handshake.js` was loaded before the preload ran;
- `planetStaticData.js` lacks one of the five exports above;
- `preferences.json` is not a JSON object, or holds a setting that is not a number above zero.

## Limits

- Show Info on a storage structure's type still shows the retail capacity, since that window
  reads type attributes directly rather than through the planet code.
- Lowering a capacity setting does not remove anything. A colony already over its new CPU,
  powergrid or bandwidth keeps running until it is next edited, when the usual
  "exceeded" errors apply. Contents over a pin's new capacity stay, and routes into that pin
  stop until there is room.
- A shorter cycle raises the bandwidth every route into and out of that factory uses, since
  route bandwidth is volume per cycle over cycle time. Lowering a duration setting can push an
  existing colony over a link's bandwidth, and its next edit then fails until the link is
  upgraded or the connection bandwidth setting is raised.
- A shorter cycle also uses up inputs faster: extractors keep their own cycle, so factories fed
  straight from extraction run dry sooner.
- Very short cycles make the server simulate more factory cycles when it catches up a colony
  that has not been viewed for a while.
- Tied to EveJS internals (the two file paths and the five exports above). A Server change
  to any of them switches the mod to retail with a log line rather than breaking login.

## Without the Launcher

The client half needs nothing on the client side: the server sends it at login, so the ordinary
`Play.bat` works. Only the server has to start with the loader. From the EveJS root, with the mod
in `mods\evejs-cpi` and its `loader.js` enabled:

```powershell
$env:NODE_OPTIONS = "--require=$PWD\mods\evejs-cpi\loader.js"
Push-Location server
node --max-old-space-size=8192 .
Pop-Location
Remove-Item Env:NODE_OPTIONS
```

Set `NODE_OPTIONS` only for the server's own `node`, not around `npm start`, or npm and other
Node tools would load the mod too. Write `preferences.json` by hand when the Launcher is not
used, with any of the settings above; a missing setting is 1:

```json
{
  "piCommandCenterFittingMultiplier": 2,
  "piConnectionBandwidthMultiplier": 2,
  "piStorageCapacityMultiplier": 20,
  "piP1SchematicDurationMultiplier": 0.5
}
```

## License

[GNU Affero General Public License v3.0](LICENSE), the license of EveJS, whose server process
this mod runs inside.
