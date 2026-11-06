# Indicators of compromise

Collected by static analysis on 2026-11-06. URLs are defanged.

## File

| | |
|---|---|
| Name | `Watch2Party Setup.exe` |
| Size | 145,720,309 bytes |
| SHA-256 | `b31383346c23d0e16bcdf40831237017ccaf1efcf9f78454f208dd6ea8ca1c25` |
| SHA-1 | `634bbc2d7a1afe9656dea7d4457b9dbd1110dbcf` |
| MD5 | `51a023083f6ef3d2e06dad6ad34e38c2` |
| Signature | none |
| Version info | `Node.js JavaScript Runtime`, `node.exe`, 22.22.3 |
| Embedded project name | `sexychecker` |
| Embedded entry point | `C:\snapshot\v200\main.js` |

## Network

| Indicator | Role |
|---|---|
| `watch2party[.]com` | Lure site. Registered 2026-10-30 at Hostinger, proxied by Cloudflare (`104.21.45.32`, `172.67.208.90`) |
| `hxxps://www.dropbox[.]com/scl/fi/ordvcf6sxetwtne0zaffk/Watch2Party-Setup.exe` | Installer download |
| `hxxps://ptb.discord[.]com/api/webhooks/1565751789171511376/<token withheld>` | Exfiltration webhook |
| `hxxps://www.myexternalip[.]com/raw` | Public IP lookup (legitimate service) |
| `hxxps://discord[.]com/api/v10/users/@me`, `/users/@me/billing/payment-sources`, `/users/@me/relationships`, `/users/@me/guilds`, `/users/<id>/profile` | Discord API calls made with stolen tokens (legitimate service) |
| `hxxps://media.discordapp[.]net/attachments/969859570203766806/1379378498547875920/caption.gif` | Avatar image used for the wallet messages |

## Command lines

```
Powershell -NoLogo -NonInteractive -NoProfile -ExecutionPolicy Bypass -Encoded WwBTAHkAcwB0AGUAbQAuAFQAZQB4AHQALgBFAG4AYwBvAGQAaQBuAGcAXQA6ADoAVQBUAEYAOAAuAEcAZQB0AFMAdAByAGkAbgBnACgA...
net session
powershell -Command "Start-Process -FilePath '<path to sample>' -Verb runAs"
taskkill /F /IM chrome.exe
taskkill /F /IM msedge.exe
taskkill /F /IM opera.exe
taskkill /F /IM opera_gx.exe
taskkill /F /IM brave.exe
taskkill /F /IM firefox.exe
reg query "HKLM\HARDWARE\DESCRIPTION\System"
```

The encoded PowerShell command decodes to a script that defines `Console.Window` with `GetConsoleWindow` and `ShowWindow`, then calls `ShowWindow($consolePtr, 0)`.

## File system

| Path | Use |
|---|---|
| `%TEMP%\<username>_WalletBackup\` | Staging directory for the Exodus wallet copy; deleted afterwards |
| `%APPDATA%\Exodus\exodus.wallet` | Read |
| `<browser profile>\Local Extension Settings\<extension id>` | Read |
| `<browser>\User Data\Local State`, `Login Data`, `Network\Cookies`, `Web Data` | Read |
| `%APPDATA%\Mozilla\Firefox\Profiles\*\cookies.sqlite`, `logins.json` | Read |
| `%APPDATA%\discord*\Local Storage\leveldb\*.ldb`, `*.log` | Read |
| `C:\Program Files\Mozilla Firefox\nss3.dll` | Loaded |

## Wallet extension IDs targeted

| Extension ID | Wallet |
|---|---|
| `nkbihfbeogaeaoehlefnkodbefgpgknn` | MetaMask |
| `bfnaelmomeimhlpmgjnjophhpkkoljpa` | Phantom |
| `hnfanknocfeofbddgcijnmhnfnkdnaad` | Coinbase |
| `egjidjbpglichdcondbcbdnbeeppgdph` | Trust |
| `acmacodkjbdgmoleebolmdjonilkdbch` | Rabby |
| `dmkamcknogkgcdfhhbddcghachkejeap` | Keplr |
| `fnjhmkhhmkbjkkabndcnnogagogbneec` | Ronin |
| `klghhnkeealcohjjanjjdaeeggmfmlpl` | Zerion |
| `afbcbjpbpfadlkmhmclhkeeodmamcflc` | Math |
| `mkpegjkblkkefacfnmkajcjmabijhclg` | Magic Eden |

## Strings

Present in the script after deobfuscation:

```
asko biri admin perm vermis log geliyooooooooo
amina kuyam hideself funcunda hata cikti?!
akis patladi:
lovell | allah daha cok wersin kardesim
lovell arkadas bulucu
IM RICH BOYYYYYYYYYYYY XDXDXDXD
CREDIT CARD $$$$$$$$$$$$$
tüm data burda.txt
sifreler.txt
Google Chromekey1
```

Present in the raw executable:

```
"name": "sexychecker"
Function("L1jCzhR","var nLj80u_,vAkBIr,
```
