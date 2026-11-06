# "Watch2Party Setup.exe": a Node.js infostealer posing as a watch-party app

`Watch2Party Setup.exe` is not a watch-party app. It is an information stealer that takes browser passwords, cookies, payment cards, Discord sessions and cryptocurrency wallets from a Windows machine and uploads them to a Discord webhook.

This repository documents where it was found, what it does, and how its obfuscation was removed. Everything here comes from static analysis done on 2026-11-06; the sample was never executed for this write-up.

**This repository contains no malware binary and no working download link.** The deobfuscated script is an analysis artifact that does not run, and the webhook token is redacted.

## Where it was found

The file was sent to the author as a link to a "watch party" app.

| | |
|---|---|
| Lure site | `watch2party[.]com` |
| Domain registered | 2026-10-30, one week before this analysis |
| Registrar | Hostinger (IANA ID 1636) |
| DNS / proxy | Cloudflare (`104.21.45.32`, `172.67.208.90`) |
| Installer served from | `hxxps://www.dropbox[.]com/scl/fi/ordvcf6sxetwtne0zaffk/Watch2Party-Setup.exe` (live on 2026-11-06) |

## The file

| | |
|---|---|
| Name | `Watch2Party Setup.exe` |
| Size | 145,720,309 bytes |
| SHA-256 | `b31383346c23d0e16bcdf40831237017ccaf1efcf9f78454f208dd6ea8ca1c25` |
| SHA-1 | `634bbc2d7a1afe9656dea7d4457b9dbd1110dbcf` |
| MD5 | `51a023083f6ef3d2e06dad6ad34e38c2` |
| Type | PE32+ x64 console executable, unsigned |

The executable is a stock Node.js 22.22.3 runtime built for [`pkg`](https://github.com/yao-pkg/pkg), with an 84 MiB payload appended after the PE image. Its version resource still says "Node.js JavaScript Runtime", and its manifest requests `asInvoker`, so there is no UAC prompt at launch.

The payload is a `pkg` virtual filesystem of 3,159 entries rooted at `C:\snapshot\v200\`. Only two files belong to the author of the malware:

- `package.json`, which names the project **`sexychecker`** ([copy here](deobfuscated/sample-package.json)).
- `main.js`, a single 622 KB line obfuscated with [js-confuser](https://github.com/MichaelXF/js-confuser).

The rest is `node_modules`. The dependency list alone gives the purpose away: `@primno/dpapi`, `better-sqlite3`, `sql.js`, `ffi-napi`, `libsodium-wrappers`, `jszip`, `form-data`, `axios`, `sudo-prompt`.

## What it does when run

1. **Checks for a virtual machine** and exits if any of these is true:
   - 2 or fewer CPU cores, or less than 2 GiB of RAM;
   - a network adapter with a VMware (`00:05:69`, `00:0C:29`, `00:1C:14`, `00:50:56`) or VirtualBox (`08:00:27`) MAC prefix;
   - `reg query HKLM\HARDWARE\DESCRIPTION\System` mentions "vmware" or "virtualbox";
   - VMware or VirtualBox guest drivers exist under `System32\drivers`.

   Hyper-V is not on the list. When the sample was run in Windows Sandbox it went on to request elevation, so this check did not stop it there.
2. **Waits two seconds, then hides its console window** with an encoded PowerShell command that calls `GetConsoleWindow` and `ShowWindow(hwnd, 0)`. To the person who ran it, the window appears to close.
3. **Checks for administrator rights** with `net session`. Without them it relaunches itself elevated and exits:
   `powershell -Command "Start-Process -FilePath '<itself>' -Verb runAs"`
4. Once elevated, it **notifies the operator** through the webhook, then **force-closes** `chrome.exe`, `msedge.exe`, `opera.exe`, `opera_gx.exe`, `brave.exe` and `firefox.exe` so their databases are unlocked.
5. **Collects data** (next section), zips it in memory, and **uploads** it.
6. Exits. There is no persistence mechanism and no second-stage download.

## What it steals

| Target | Data | How |
|---|---|---|
| 33 Chromium-based browser paths (Chrome, Edge, Brave, Opera, Opera GX, Vivaldi, Yandex, Chromium and others), every profile | Saved passwords, cookies, autofill, saved credit cards, stored CVCs | Reads `Login Data`, `Network\Cookies` and `Web Data` with sql.js; decrypts with the browser master key |
| Firefox, Waterfox | Cookies, saved logins | Reads `cookies.sqlite`; loads `nss3.dll` and calls `PK11SDR_Decrypt` on `logins.json` |
| Discord, Canary, PTB, Development, Lightcord | Session tokens | Scans `Local Storage\leveldb` for `dQw4w9WgXcQ:` blobs; decrypts them with the DPAPI-protected key in `Local State` |
| Chrome, Brave, Yandex, Edge, Opera, Opera GX | Discord tokens from web sessions | Regex scan of `Local Storage\leveldb` |
| Exodus | Wallet directory | Copies `%APPDATA%\Exodus\exodus.wallet` |
| Wallet extensions in Chrome, Edge, Brave, Vivaldi, Opera, Chromium | Extension storage | Copies `Local Extension Settings\<id>` for MetaMask, Phantom, Coinbase, Trust, Rabby, Keplr, Ronin, Zerion, Math and Magic Eden |

For every Discord token it finds, the stealer queries the Discord API as the victim and records the account's e-mail, phone number, MFA status, payment methods, badges and friends list. It also looks up the machine's public IP at `myexternalip.com`.

### How Chrome's app-bound encryption is bypassed

Current Chrome protects its cookie key with app-bound encryption ("v20"). The stealer undoes it locally, which is the reason it wants administrator rights:

1. Read `os_crypt.app_bound_encrypted_key` from `Local State`.
2. Enable `SeDebugPrivilege`, open the `winlogon.exe` process, duplicate its token and impersonate SYSTEM. Run DPAPI decryption as SYSTEM.
3. Revert, and run DPAPI decryption again as the user.
4. Decrypt the result according to its flag byte, using constants that have been published in open-source Chrome decryption tools:
   - flag 1: AES-256-GCM with a fixed key;
   - flag 2: ChaCha20-Poly1305 with a fixed key;
   - flag 3: decrypt with the CNG key `Google Chromekey1` (as SYSTEM), XOR with a fixed value, then AES-256-GCM.

The older "v10" key is recovered with a single user-level DPAPI call.

## Exfiltration

All output goes to one Discord webhook on `ptb.discord.com` (ID `1565751789171511376`; token withheld). There is no other command-and-control channel.

- A text message when a victim grants administrator rights.
- A zip named after the victim's Discord display name (or `data.zip`), attached to embeds that show each Discord token with the account details above, plus a list of saved Discord and Google passwords.
- One further message per stolen wallet, with the wallet archive attached.

Inside the zip:

```
browser/<browser>/<profile>/sifreler.txt        passwords, "url <|> user <|> password"
browser/<browser>/<profile>/cookies.txt         cookies, Netscape format
browser/<browser>/<profile>/tüm data burda.txt  autofill, cards, CVCs
browser/firefox/cookies.txt
browser/firefox/sifreler.txt
tokens.txt                                      Discord tokens
```

## Operator artifacts

These are strings found in the sample. They describe the build, not the identity of any person.

- File names, log messages and webhook text are in Turkish ("sifreler" is "passwords").
- Embed footers are branded `lovell`.
- The project is named `sexychecker`.
- The script contains a function that would list Discord servers where the victim is owner or administrator. Nothing calls it in this build.
- The Node.js runtime's PDB path points to a GitHub Actions runner. That belongs to the public `pkg` base binary, not to the malware author.

## Indicators

See [IOCs.md](IOCs.md) for hashes, network indicators, command lines and file paths. A YARA rule is in [detection/watch2party_stealer.yar](detection/watch2party_stealer.yar); it matches this sample and has not been tested against a clean corpus.

Behaviour worth alerting on, independent of this build:

- An unsigned executable whose version info claims to be Node.js, spawning `powershell -Encoded` and then `powershell Start-Process ... -Verb runAs` on itself.
- `net session` followed by `taskkill /F /IM` against several browsers.
- A non-browser process reading `Login Data`, `Web Data`, `Local State` or `logins.json`, or loading `nss3.dll`.
- A non-system process opening `winlogon.exe` and calling `ImpersonateLoggedOnUser`.
- Outbound requests to `discord.com/api/webhooks/` and `myexternalip.com` from the same process.

## If you ran it

Assume everything in the table above was taken, on the account that ran it.

1. From a different, clean device: change the passwords saved in your browsers, starting with e-mail, and sign out of all sessions for each account. Stolen cookies stay valid until the session is revoked, so changing a password alone is not enough.
2. Change your Discord password. This invalidates the stolen token.
3. Move cryptocurrency to a new wallet with a new seed phrase, created on a clean device.
4. Have any card saved in a browser reissued.
5. The sample does not install persistence, but it ran with administrator rights. Reinstalling Windows is the safe option.

## How the obfuscation was removed

The scripts are in [tools/](tools/). They parse and rewrite the code; they never evaluate any of it. Run in order, they turn the 622 KB one-liner into [deobfuscated/main.deobfuscated.js](deobfuscated/main.deobfuscated.js) (9,370 lines).

| Step | Script | What it undoes |
|---|---|---|
| 0 | `unpack_pkg.py` | Extracts the `pkg` virtual filesystem. The payload offsets are stored as padded decimal strings in the V8 code cache; the readable `'// PAYLOAD_POSITION //'` placeholders in the binary are left unpatched and are a red herring. |
| 1 | `unwrap.js` | The outer `Function("arg", "<code>")({...})` wrapper that hides `require` and `module` behind getters. |
| 2 | `deob1.js` | A 729-entry constant table, and the top-level string table. |
| 3 | `deflatten.js` | Control-flow flattening. 151 functions are rewritten as generator state machines: a `switch` on the sum of two to four state variables, local variables moved into objects reached through `with`, opaque predicates in the `case` labels, and string indices that depend on the current state. The script walks each machine from its entry state with a small arithmetic interpreter and emits the blocks in order. |
| 4 | `deob3.js` | String concealment. There are 75 base91 decoders, each with its own alphabet, but they all index one shared 2,224-entry table. The script groups call sites by decoder and picks the alphabet under which every string in the group decodes to valid text. All 75 groups resolved with no conflicts. |
| 5 | `deob4.js` | A lookup function that hides global objects (`process`, `Buffer`, `Promise`), and a dispatcher that hides 35 helper functions behind string keys with arguments passed through a global array. |

The identifier names in steps 2, 4 and 5 are specific to this build. For another js-confuser sample they need to be changed; the approach stays the same.

```
cd tools && npm install
python3 unpack_pkg.py <sample.exe> out/
node unwrap.js    out/snapshot/v200/main.js inner.js
node deob1.js     inner.js  stage1.js
node deflatten.js stage1.js stage2.js
node deob3.js     stage2.js stage3.js
node deob4.js     stage3.js stage4.js
```

Where a flattened function has loops or merge points, the output keeps labelled blocks and `GOTO(Bn)` markers instead of rebuilding `while` and `if`. Helper calls appear as `F_<key>(...)`. Both are notation, which is one reason the output does not execute.

## Repository layout

```
README.md                         this write-up
IOCs.md                           indicators
deobfuscated/main.deobfuscated.js readable script (not runnable, token redacted)
deobfuscated/strings.tsv          every decoded string with its line number
deobfuscated/sample-package.json  the payload's own package.json
detection/watch2party_stealer.yar YARA rule
tools/                            unpacking and deobfuscation scripts
```
