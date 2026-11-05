# EveJS-CPI

A mod for EveJS allowing for Configurable Planetary Infrastructure multipliers.

It has one setting, **Planetary infrastructure capacity multiplier**
(`planetaryInfrastructureCapacityMultiplier`). It accepts any number above zero, such as 0.5, 2 or 50,
and multiplies:

| What | Retail, level 0 | ×2 |
|---|---|---|
| Command center CPU, at every upgrade level | 1675 tf | 3350 tf |
| Command center powergrid, at every upgrade level | 6000 MW | 12000 MW |
| Link bandwidth (`logisticalCapacity`, before the ×2 per link level) | 1250 m³/h | 2500 m³/h |
| Storage facility capacity | 12000 m³ | 24000 m³ |
| Launch pad capacity | 10000 m³ | 20000 m³ |
| Command center storage | 500 m³ | 1000 m³ |

Unchanged: what each structure and link uses, command center upgrade costs, extraction,
factory output and cycle times.

CPU and powergrid round half up to whole numbers. Bandwidth and storage are not rounded.

## Why it changes the client too

The EVE client works these numbers out from its own files and checks a colony against them before
the server sees anything: `planetCommon.commandCenterInfoPerLevel`, `BaseLink.GetBaseBandwidth`
and `StoragePin.GetCapacity`. A server-only multiplier above 1 would leave the client refusing to
build past retail. CPI applies the same multiplier on both sides, so the planet screen shows and
checks what the server enforces.

## Install

1. Copy this folder into the EveJS installation's `mods` folder, or import it in the Launcher's
   Mods page. It arrives disabled (`loader.js.disabled`).
2. **Configure** sets the multiplier. The Launcher saves it to `preferences.json` in this folder.
3. Enable the mod and start the server with mods (Native Modded). Docker is not supported.
4. Players log in again to pick up a new value.

The server console shows `[CPI] planetary infrastructure capacity x2 on the server and at client
login.` when the mod is on. The handshake log shows `CPI:OK:2.0` from each client.

Changing the setting needs a server restart, and each player's next login brings the new value.
Disabling the mod and restarting returns the server to retail. A client still running from a
CPI login returns to retail by itself at its next login, because the patch holds only for the
handshake that delivered it.

## How it works

`loader.js` is a Node preload (`--require`). It changes nothing on disk.

- **Server.** `lib/serverPatches.js` wraps three exports of EveJS's
  `server/src/services/planet/planetStaticData.js` as the module loads:
  `getCommandCenterInfo` (CPU and powergrid), `getUsageParametersForLinkType`
  (`logisticalCapacity`) and `getPITypeInfo` (`capacity`, for storage, spaceport and command
  pins). EveJS reads these through the module object, so colony validation, routing, expedited
  transfers and launch pad imports all see the scaled values.
- **Client.** `lib/loginDelivery.js` appends one statement to EveJS's
  `server/src/network/tcp/handshake.js` as Node compiles it, rebinding `buildTidiSignedFunc` to
  a wrapper. The wrapper runs EveJS's login code first, then `client/cpi.py` (sent as base64, in a
  private namespace), and returns EveJS's result. `cpi.py` wraps `planetCommon.GetCPUOutput`,
  `planetCommon.GetPowerOutput`, `BaseLink.GetBaseBandwidth` and `StoragePin.GetCapacity` in
  the client's memory. `SpaceportPin` and `CommandPin` inherit `GetCapacity`.

The two halves switch on together or not at all. The server half reports retail values until the
handshake builder has been wrapped and its output checked. It stays at retail, and logs
`[CPI] disabled, PI stays at retail: <reason>`, when any of these is true:

- `handshake.js` does not declare `buildTidiSignedFunc` exactly once;
- EveJS's payload is not the expected marshal string;
- `handshake.js` was loaded before the preload ran;
- `planetStaticData.js` lacks the three exports;
- `preferences.json` holds a value that is not a number above zero.

## Limits

- Show Info on a storage structure's type still shows the retail capacity, since that window
  reads type attributes directly rather than through the planet code.
- Lowering the multiplier does not remove anything. A colony already over its new CPU,
  powergrid or bandwidth keeps running until it is next edited, when the usual
  "exceeded" errors apply. Contents over a pin's new capacity stay, and routes into that pin
  stop until there is room.
- Tied to EveJS internals (the two file paths and the three exports above). A Server change
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
used: `{"planetaryInfrastructureCapacityMultiplier": 20}`.

## License

[GNU Affero General Public License v3.0](LICENSE), the license of EveJS, whose server process
this mod runs inside.
