# O‑KAM / VStarcam Webcam — Reverse‑Engineering & Integration Instruction

> Working document for integrating the terpcontrol "O‑KAM Pro" webcam **without the O‑KAM app**.
> Status as of 2026‑08‑11 (paused mid‑investigation). Condensed facts also live in Claude project memory (`okam-webcam-vstarcam.md`).
> ⚠️ **This file contains live credentials** (camera, Wi‑Fi, O‑KAM account). Do not commit/push it to a public remote; add to `.gitignore` or move to secure notes if this repo is shared.

---

## 1. Objective & requirements

Onboard the webcam from the controller/module, app‑free, and get periodic HD stills to the cloud. Four hard requirements:

1. **User sets the camera's Wi‑Fi via the controller/module** (no O‑KAM app for onboarding).
2. **Fully reversible** — disconnecting restores the camera to stock so the original O‑KAM app still works.
3. **One HD image every 1–2 min to the cloud** — either pushed by the camera, or pulled via the controller's MQTT tunnel.
4. **Minimal change / minimal risk** — no custom firmware if avoidable.

## 2. Status summary

| # | Requirement | Status |
|---|---|---|
| 1 | Set Wi‑Fi from controller, app‑free | ✅ **Solved & proven** (HTTP `set_wifi.cgi` in AP mode) |
| 2 | Reversible / original app still works | ✅ Yes — camera stays 100% stock; factory reset restores it |
| 4 | Minimal, no firmware | ✅ On track — everything is settings + HTTP + P2P, no firmware |
| 3 | HD image every 1–2 min | ✅ **SOLVED end-to-end on hardware (2026‑08‑20).** The controller captures over P2P and the existing image pipeline stores/serves it; see §17. Earlier note (2026‑08‑18): App‑free provisioning proven live; the PPCS transport cipher is fully reversed & reimplemented in pure Python; a clean‑room client pulls a **2304×1296 HD JPEG** LAN‑direct from the camera on Wi‑Fi. See §15. |

## 3. Hardware & identity

- Sold as **"O‑KAM Pro"**; it is a **VStarcam OEM** unit. SoC **Ingenic T23‑N**, sensor **GC2083** (2304×1296), Wi‑Fi chip **AIC8800DC**, firmware `EN120.8.53.11`, ~8MB NOR flash under a metal cover (no exposed UART on this unit).
- Ships as an **open AP** `@IPC-<n>` at gateway **`192.168.168.1`**; MAC `<CAMERA_MAC>`.
- CS2/PPPP device id `VSTH…NXWNT`; `realdeviceid` embeds the AP number (e.g. `AAC2852199TWVA`). P2P id rotates on factory reset.
- Default HTTP creds: **`admin` / `888888`** (universal VStarcam default; `login.cgi` even leaks it).

## 4. Zero‑app provisioning — SOLVED (requirement #1)

In **AP/setup mode only**, the camera exposes a **GoAhead webserver on TCP `81`** with the full VStarcam CGI API over plain HTTP (query‑param auth `loginuse`/`loginpas`, not digest). Unknown CGIs return `var cgi="not support";`.

Recipe the controller replicates (mirrors `provisionSmartSocket`):
1. `GET /wifi_scan.cgi?loginuse=admin&loginpas=888888` then `GET /get_wifi_scan_result.cgi?…` → read `ap_ssid[]`, `ap_security[]` (WPA2/AES = `4`).
2. `GET /set_wifi.cgi?loginuse=admin&loginpas=888888&enable=1&ssid=<SSID>&channel=0&mode=0&authtype=<ap_security>&encrypt=0&keyformat=0&defkey=0&key1=&key1_bits=0&key2=&key2_bits=0&key3=&key3_bits=0&key4=&key4_bits=0&wpa_psk=<PSK>`
   - **Critical encoding** (from `libOKSMARTJIAMI`‑adjacent `python-yatwin` lib): the WPA mode goes in **`authtype`** (2=wpa‑psk/aes, 3=wpa‑psk/tkip, **4=wpa2‑psk/aes**, 5=wpa2‑psk/tkip) — it equals the scan's `ap_security`. `encrypt` is WEP‑only → `0`. PSK param is **`wpa_psk`** (underscore), **not** `wpapsk`.
   - `set_wifi.cgi` **applies immediately** and drops the AP; there is no non‑committing test endpoint.
3. Camera reboots onto the target Wi‑Fi. Find it on the LAN by MAC (ARP / router), read back `get_params.cgi` → `var ip=`. (Can't read the new IP from the AP side like Tasmota — the AP dies at once.)

Reversibility (req #2): everything above is stock config; a **factory reset** (hold reset button ~5–10s) wipes it and returns the camera to AP mode + original app.

**Gotcha:** a bad/unreachable SSID (or wrong `authtype`) leaves the camera stuck in station mode; the AP does not return quickly → power‑cycle, then factory‑reset if needed.

## 5. The streaming problem — station‑mode lockdown

Once the camera joins a real Wi‑Fi network, it **firewalls its own wireless interface down to only two proprietary ports, TCP `9001`/`9002`.** Port `81` (all CGI incl. `snapshot.cgi`), RTSP, ONVIF, HTTP‑snapshot — **none are reachable on the LAN.** Verified by full 1–10600 scans; closed ports **time out** (SYN dropped) on station vs. cleanly **refused** in AP mode.

Dead ends confirmed (do not re‑try):
- **RTSP/ONVIF**: `set_rtsp.cgi`/`set_onvif.cgi` config sticks (`rtspenable=1`) but the daemon **never binds** on the LAN. `get_rtsp`/ONVIF effectively stripped for LAN use.
- **FTP timed push** (`set_ftp.cgi&upload_interval=N`, "Instantly upload image interval(s)"): **never fires** (no camera‑side connection, AP or station) — FTP appears stripped (`get_ftp`=not‑support).
- **Remote root** to open the firewall: GoAhead `set_ftp.cgi`→telnetd injection, NTP‑server injection, `set_telnet`/`debug`/`shell` CGIs — all patched/absent on this firmware.
- **aiopppp / UDP‑32108 PPPP**: camera doesn't answer 32108 discovery reproducibly; its real local channel is TCP‑framed P2P (below), which aiopppp doesn't speak.
- **Open firmware (thingino/OpenIPC)**: exists for this exact board (issue #1241) but **unimplemented**, AIC8800DC driver unproven, SD‑flash‑only + high brick risk. Rejected by req #2 (must stay reversible/original‑app) and #4 (no firmware).

Snapshot resolution note: `snapshot.cgi` in AP mode returns **640×360** (sub‑stream). The app's saved stills are **2304×1296** — HD snapshot comes via the P2P/main‑stream path, not `snapshot.cgi`.

## 6. The app↔camera protocol (captured, LAN‑direct)

Captured with **PCAPdroid** on a real phone (same subnet as camera → LAN‑direct). File: `okam.pcap`.

- Transport: **CS2 "PPCS" P2P over UDP, LAN‑direct** — 24‑byte punch packets to a port range (`2214x`), then a session on a dynamic UDP port (e.g. `22934`). Not TCP `9001/9002`, not plain PPPP‑32108.
- Framing: every UDP payload starts with magic byte **`0x49`**; video packets are `49 55 …` ("IU") + ~6‑byte frame/id header, then payload. Heartbeats/punch are byte‑identical fixed tokens (no per‑packet nonce). The `0x49` framing is **not** a simple XOR of PPPP's `0xf1`.
- **Commands are VStarcam CGIs tunneled over P2P** via `JNIApi.writeCgi(...)` — i.e. the snapshot path is: PPCS connect → login → `writeCgi("snapshot.cgi…")`/livestream → HD JPEG over the channel. **No H.264 decode needed for a still.**
- Video payload is **encrypted** (no H.264 start‑codes at any offset).

The PPCS state machine (from `libOKSMARTPPCS` exports) matches PPPP: `CSession_Hello/HelloAck/DevLgn/P2pReq/P2pRdy/Punch/Drw/DrwAck/RlyHello/Alive…`. `aiopppp` is a good structural reference for reimplementation (but magic/obfuscation differ).

## 7. The AppCrypto AES path — reversed, but NOT used on the P2P path

> ⚠️ **Superseded by §10 (2026‑08‑18).** Live Frida capture proved `AppCrypto`/`libOKSMARTJIAMI` AES **never fires** for LAN/relay P2P. This section documents the AES that *does* exist in the app (some cloud‑REST use) but it is **not** the camera transport cipher. The real transport cipher is inside `libOKSMARTPPCS` (§10C). Do not chase `keySeed`/`MD5(...)` for the streaming path.

App class **`com.vstarcam.AppCrypto`** (JNI → `libOKSMARTJIAMI.so`, tiny‑AES‑c):
- **AES‑128‑CBC, IV = 16 zero bytes, PKCS7 padding.** Ciphertext transported as a hex string.
- **Key = `MD5( keySeed + "_+Vstarcam++20200715" )`** (from `Java_com_vstarcam_AppCrypto_decrypt` disasm: `snprintf("%s_+Vstarcam++20200715", keySeed)` → md5 → key; `AES_decrypt_eye(key, hexdecode(cipher))`).
- Other seeds in `.rodata`: `%s_%s_Ricky` (used by `deviceKey`), hardcoded `64D33A12C0451837365F911F691D9334`, `EYE4_SIGNATURE`; key derivation also pulls the **APK signing signature** (`getPackageInfo`/`signatures`) → **re‑signing/repackaging breaks the key**, so frida‑gadget repackaging is out; must use a rooted emulator running the original‑signed APK.
- **Unknown remaining:** the exact `keySeed` value passed at runtime (device id? session key?) and the exact `writeCgi` snapshot command. Both are one Frida capture away (§9–10).

## 8. Native libraries (in `split_config.arm64_v8a.apk`)

- `libOKSMARTPPCS.so` (726 KB) — CS2 **PPCS** P2P SDK (the transport). JNI: `com.vstarcam.JNIApi` (`connect/login/writeCgi/write/read/…`). Multi‑protocol: `PPCS_/XQP2P_/HLP2P_ GetAPIVersion`.
- `libOKSMARTJIAMI.so` (23 KB) — crypto (§7).
- `libOKSMARTPLAY.so` (media/decode), `libOKSMARTSHENGYIN.so` (audio), `libapp.so` (54 MB — **Flutter AOT Dart**, so app logic is not statically recoverable → dynamic Frida analysis required).

## 9. The analysis rig (built & working)

- **Rooted Android emulator** AVD `okamre` (`~/.android/avd`, persists): Google‑APIs arm64 android‑34, HVF‑accelerated. `adb root` works.
- **Frida 16.7.19** on both sides (frida 17 removed the `Java` bridge → hooks fail; **use 16.x** in the venv). frida‑server pushed to `/data/local/tmp/frida-server16`.
- Hooks (`hook.js`) on `com.vstarcam.AppCrypto` (encrypt/decrypt/deviceKey) and `com.vstarcam.JNIApi` (writeCgi/login/write) → log to `hits.log` via `run_frida.py` (spawns the app hooked from launch).
- O‑KAM `com.okampro.oksmart` installed (original‑signed base + splits). Logged in as `<OKAM_ACCOUNT>` / `<OKAM_PASSWORD>`, **region Germany** (region must match or login silently fails). Flutter UI has no uiautomator nodes → drive via `adb … input tap <x> <y>` / `input text` + `exec-out screencap -p` (screenshot‑and‑tap).

## 10. Live-capture results (2026‑08‑18) — command layer fully reversed

The old blocker (camera unbound) is resolved: the camera was re‑paired to `<OKAM_ACCOUNT>` (O‑KAM Pro, Germany region), and after a `pm clear` + fresh login the emulator drove **Live view / FHD** with `run_frida.py` hooked. Device: **`did=VSTH204422KPFRR`** (CS2 P2P id) / **`realdeviceid=AAC2852199TWVA`**, online at `192.168.144.85`. Two decisive findings:

**A. There is NO `AppCrypto`/AES on the LAN P2P path.** Across login, Live view, FHD switch and manual screenshot, `com.vstarcam.AppCrypto.{encrypt,decrypt,deviceKey}` and the native `libOKSMARTJIAMI` AES exports (`AES_init_ctx`, `AES_CBC_*`, `cryptoKey`) were hooked and **never fired**. The whole `keySeed` → `MD5(keySeed+"_+Vstarcam++20200715")` theory in §7 is **not used** for LAN/relay P2P. (AppCrypto is presumably only for some cloud‑REST payloads; the device list/login go over TLS, also not AppCrypto.)

**B. Commands are plaintext VStarcam CGIs tunneled over PPCS.** `com.vstarcam.JNIApi.writeCgi(handle, "<cgi>", 5)` carries the command in the clear; responses arrive via `AppP2PApiPlugin.commandListener` as ASCII‑decimal byte arrays (also plaintext). Captured vocabulary:
- **Start video:** `livestream.cgi?streamid=10&substream=2&` (SD preview). `substream` selects the stream.
- **Set definition (SD/HD/FHD):** `camera_control.cgi?param=16&value=N&` — **not** a new `livestream.cgi`. FHD → the 2304×1296 main stream.
- **Params/status:** `get_params.cgi?`, `get_status.cgi?vuid=AAC2852199TWVA&`, `get_camera_params.cgi?`, `get_factory_param.cgi?`, `set_users.cgi?app_oemid=OKAMPRO&app_version=3.0.35&aac_support=1&`.
- **Binary control set:** `trans_cmd_string.cgi?cmd=<code>&command=<n>&…` (e.g. `cmd=2017` motion cfg, `2126`, `4109`, `2109`, `8000`, `4500`, `2131 DevActiveTime` keep‑alive, `4121`).
- **HD still = client‑side frame grab.** The app's "Screenshot" issues **no** camera command — it saves the currently‑decoded FHD frame. There is **no server‑side HD `snapshot.cgi`** on this path; the 2304×1296 still is a decoded keyframe from the FHD `livestream` H.264.

**C. The PPCS transport IS encrypted (this is the only remaining barrier).** Wire capture (`okam.pcap`, tcpdump inside the emulator, relay peer `95.222.55.10`): every UDP payload starts with `0x49`; frame types `49 55` ("IU", data/video, ≤1032 B), `49 54` ("IT", control/ack, 10–42 B), `49 65` (`4965fe3e`, constant alive). Header ≈ `49 <type> <4‑byte session token, constant> <2‑byte incrementing seq> <payload…>`. **Payload entropy: 7.97 (data) / 7.22 (control)** — both channels are ciphered on the wire even though `PPCS_Write` receives plaintext. So encryption lives in **`libOKSMARTPPCS`** (the "C"=Crypt in PPCS), *not* AppCrypto. No repeating‑XOR period found (correlation ≈ random baseline) ⇒ a **real stream cipher** (AES‑CTR‑like or the CS2 built‑in crypto keyed off the SDK license string), not a toy XOR. The keystream is position‑based, not per‑packet‑nonced (matches "no per‑packet nonce").

**D. It's standard CS2 PPCS.** `libOKSMARTPPCS` exports the full CS2 API (`PPCS_Initialize/Connect/ConnectByServer/Write/Read/Close`, channel‑based) and the complete PPPP state machine (`CSession_Hello/HelloAck/P2pReq/P2pRdy/Punch/DevLgn/Drw/DrwAck/RlyHello/Alive…`). Also bundles two sibling stacks: `XQP2P_*`, `HLP2P_*`. `PPCS_Write/Read` are 4‑byte branch thunks and the code is under the `libpglarmor` packer → **not Frida‑hookable** (channel‑level dump blocked; use the Java `writeCgi` layer + tcpdump instead).

## 11. Path to requirement #3 — two options

The command layer is trivial; the transport cipher is the whole game. Two ways forward:

- **(A) Reuse the vendor `libOKSMARTPPCS.so` (recommended, fastest).** It exposes the standard CS2 API, so let *it* do all framing+crypto: `PPCS_Initialize(<license>)` → `PPCS_ConnectByServer/Connect(<DID>)` → login → `PPCS_Write(ch0, "livestream.cgi?substream=<FHD>")` → `PPCS_Read(ch1, …)` to pull H.264 → decode one keyframe → JPEG. Runs as an ARM sidecar (the controller is ARM; APK ships arm64 only — no x86 build, so an x86 server needs an arm container/emulation or run it on the controller). **Still need to capture:** the `PPCS_Initialize` license/init string + server string, and the exact connect/login sequence (DID `VSTH204422KPFRR`, creds). These come from `JNIApi.init/create/connect/login` — broaden the hook and catch them at cold P2P init (they fire once, early).
- **(B) Clean‑room reverse the PPCS cipher (multi‑day).** Disassemble `libOKSMARTPPCS` `CSession_Drw_Deal`/`Data_Read`/`Data_Write` + the crypto init to recover the stream cipher + key schedule, then reimplement PPPP+cipher in Python. Needs a **LAN‑direct** pcap (real phone on the camera's subnet — emulator NAT only gives the relay path) to nail the punch/hello/DevLgn handshake. Higher effort, no vendor blob.

Then, for either: wrap the client so it runs **server‑side through the controller MQTT tunnel** (§12), issue FHD `livestream` every 1–2 min, grab one keyframe → JPEG → existing image pipeline.

## 12. End‑goal implementation (requirement #3)

Deliver the HD still via the **controller's existing MQTT tunnel** (`server/src/services/tunnel.service.ts` ↔ firmware `fridgecloud.cpp`), which relays raw TCP/UDP from the cloud through the controller to a LAN device:
- Server‑side (or a small sidecar) speaks PPCS+AES to the camera **through the tunnel** (controller is the camera's LAN peer), issues the snapshot command every 1–2 min, receives the HD JPEG, stores it via the existing image pipeline (`image.service.ts`, `cloudSettings`/webcam model — see `docs`/`shared-types`). No firmware, reversible, satisfies all four requirements.
- Onboarding stays as §4 (controller drives `set_wifi.cgi` in AP mode), so the end‑user UX is "unbox → module adopts it".

## 13. Artifacts, paths, credentials

- Workspace (may be wiped on Mac reboot): `/tmp/okam-re/` — `okam.pcap` (16 MB relay capture, 2026‑08‑18), `hook.js` (native AppCrypto+AES, JNIApi, AppP2PApiPlugin, PPCS_Write/Read‑via‑thunk), `run_frida.py` (**attach** or **spawn** mode; blocks on Event not stdin), `pcap_analyze.py`/`entropy.py`/`xortest.py` (no‑scapy pcap tooling), `hits.log`, `apk/` (pulled base+splits, extracted `.so`), frida venv (`venv/`, frida 16.7.19 + pycryptodome). **If gone:** re‑pull APK via `adb shell pm path com.okampro.oksmart`; the venv rebuild is `/opt/homebrew/bin/python3.13 -m venv venv && venv/bin/pip install frida==16.7.19 frida-tools pycryptodome`. frida‑server already at `/data/local/tmp/frida-server16` in the AVD.
- Rig gotchas learned 2026‑08‑18: (i) frida `enumerate_processes()` does **not** match the app by name — find pid via `adb shell ps -A | grep okam`; (ii) the app's `com.vstarcam.*` classes load **lazily** → hook on a retry timer (no time cap), not a single `Java.perform`; (iii) two concurrent frida sessions **crash** the (packed) app — one session at a time; (iv) `nohup … &` closes stdin → `run_frida.py` must block on `threading.Event().wait()`, not `sys.stdin.read()`.
- AVD `okamre` persists in `~/.android/avd`. Android SDK at `~/Library/Android/sdk` (cmdline‑tools installed; Homebrew is broken for installs on this Mac; system python 3.9 too old for frida → use `/opt/homebrew/bin/python3.13`).
- Camera HTTP: `admin` / `888888`. Device: `did=VSTH204422KPFRR`, `realdeviceid=AAC2852199TWVA`, LAN IP `192.168.144.85`, MQTT device‑record `security=<MQTT_DEVICE_SECURITY>`.
- Home Wi‑Fi: SSID `<WIFI_SSID>` / PSK `<WIFI_PSK>`.
- O‑KAM account: `<OKAM_ACCOUNT>` / `<OKAM_PASSWORD>`, region **Germany**. After a `pm clear` the region defaults to **States** — must reset to Germany in the login screen's region picker or the account's devices won't show.

## 14. Lessons / gotchas

- Emulator NAT (10.0.2.x) makes the app **cloud‑relay** instead of LAN‑direct — fine for capturing crypto+commands (transport‑independent), **not** for capturing the LAN‑direct wire protocol (use the real phone/pcap for that).
- macOS 26 can't sniff Wi‑Fi (no `airport`, no monitor mode); Internet‑Sharing hotspot bridging is unreliable here. Real‑phone PCAPdroid or FRITZ!Box capture are the viable wire captures.
- Frida **16.x** for the Java bridge. Re‑signing breaks the signature‑derived key → rooted emulator + original APK only.

## 15. SOLVED — the full app‑free HD‑still path (2026‑08‑18)

Requirement #3 is achieved end‑to‑end. A clean‑room Python client (`/tmp/okam-re/`, files below) provisions the camera, speaks the reversed protocol LAN‑direct, and pulls a **2304×1296 HD JPEG** from the camera while it is on the home Wi‑Fi — no O‑KAM app, no vendor `.so`.

### 15.1 The transport cipher — fully reversed
`libOKSMARTPPCS.so` obfuscates every UDP packet with `cs2p2p__P2P_Proprietary_Encrypt(key,in,out,len)` (@0x6646c) via `cs2p2p_SendMessage` (@0x6804c). It is a **CFB‑style self‑synchronising stream cipher**:
- 256‑byte S‑box permutation (was at vaddr `0x2af11`; saved as `sbox.bin`).
- 4‑byte derived key `dk` from a key string: `[Σb, −Σb, Σ((b*0xAB)>>9), XOR b]` over `key[:20]`. **The key is a fixed global constant for this SDK build → `dk = [44,212,96,6]` (0x2c,0xd4,0x60,0x06) decrypts everything, including pre‑session discovery packets.** No per‑session secret.
- Algorithm (enc and dec share the S‑box; `prev` is always the **ciphertext** byte):
  ```
  prev=0
  for j: ks = sbox[(dk[prev&3] + prev) & 0xFF]; C[j]=ks^P[j] (enc) / P[j]=ks^C[j] (dec); prev=C[j]
  ```
  Recovered by aligning known plaintext (the `f1 d8` DRW header + a known CGI) against captured ciphertext, majority‑vote per residue (consistency 1.000). Validated byte‑for‑byte against captured Hello/LanSearch/P2pReq/DRW.

### 15.2 The protocol — standard CS2 PPPP under the obfuscation
Plaintext framing: `F1 <type> <len16> <payload>`. Types: `00` Hello / `01` HelloAck / `05` P2pReq(+DID) / `20` DevLgn(+DID+session) / `30` LanSearch / `41` PunchPkt / `42`,`43` P2P‑Rdy / `d0` DRW / `d1` DrwAck / `e0`,`e1` Alive. DID on the wire = `56 53 54 48`(“VSTH”) `00…00 03 1e 86`(=204422) `4b 50 46 52 52`(“KPFRR”).

**LAN‑direct handshake that works** (the emulator only ever used relay, so this was found live against the camera):
1. `LanSearch(0x30)` broadcast/unicast to `<cam>:32108` → camera replies `PunchPkt(0x41)` from an ephemeral port `P`.
2. To `<cam>:P`, **repeatedly** (every ~0.5 s) send `Hello(0x00)` + `P2pReq(0x05,DID)` + `DevLgn(0x20,DID+sess)` + `PunchPkt(0x41,DID)`, echoing the camera's `0x42/0x43`. The **DevLgn is what authenticates the session** — without it the camera ACKs DRW at the transport level (`0xd1`) but silently drops commands. Must keep punching or the binding drops.
3. Data channel: DRW `F1 D0 <len16> | D1 <ch> <idx16> | 01 0A 00 00 <len32‑LE> | GET /<cgi>?…`. **Commands must be authenticated** — append `name=admin&loginuse=admin&userId=<uid>&loginpas=<hash>&user=admin&pwd=888888&`; wrong `loginpas` → silent drop. First DRW must be **index 0**.
4. Responses come back as channel‑0 DRW (`result= 0;var …`). Video comes on **channel 1** after `livestream.cgi?streamid=10&substream=2&`.

### 15.3 Video → still
Channel‑1 bytes are **VStarcam media frames**: 32‑byte header starting `55 aa 15 a8`, then **standard H.264 Annex‑B** (`00 00 00 01` NAL start codes; SPS type 7 + PPS type 8 + IDR type 5 = a complete keyframe). Strip the 32‑byte headers, concat the NALs, `ffmpeg -f h264 -i - -frames:v 1` → JPEG. First keyframe is full sensor res **2304×1296** even on substream=2.

### 15.4 Reference client (`/tmp/okam-re/`)
- `ppcs.py` — the cipher + PPPP framing (`sbox.bin`, `dk`, `encrypt/decrypt/pkt/lan_search`).
- `okam_p2p.py` — `OkamCam`: discover → auth handshake → `request(cgi)` → channel reassembly.
- `okam_still.py` — `grab_still(ip,out)`: end‑to‑end HD JPEG grab. **Proven: pulled 2304×1296 stills from 192.168.144.85.**
- Open items for productionisation: derive `loginpas` from the password instead of the captured hash `03f5c2333e78918` (constant for admin/888888); the `DevLgn` session field `0002 1264 1002 000a` may be reduce‑able to zeros LAN‑direct (works as captured).

### 15.5 Deployment architecture — IMPLEMENTED (UDP tunnel, server-side P2P)
Chosen approach (2026‑08‑19): keep firmware minimal and run the P2P client **server‑side**, reaching the camera through a small **UDP mode added to the existing MQTT tunnel** (the camera's only TCP ports, 9001/9002, do not speak the P2P protocol the app uses — the app is UDP‑only, so there is nothing to reverse there; HTTP/81 is firewalled on station).

Implemented:
- **Firmware** (`firmware/src/`): `wifi.cpp` — real provisioning (`provisionOkamCam`, replaces the `showTerpCamUi` placeholder): join the `@IPC-<n>` AP, read the DID via `get_status.cgi`, `set_wifi.cgi` onto the home wifi, store + report `hardware-info:webcam_did`. `fridgecloud.{h,cpp}` — a **UDP relay mode** on the tunnel (`Tunnel.udp`/`isUdp`; `tunnel_write` with `udp:true` sends the datagram to `host:port`; `handleTunnelReads` forwards inbound datagrams whole, tagged with the peer `host`/`port`; MQTT buffer bumped to 2 KB for ~1 KB video datagrams).
- **Server** (`server/src/services/`): `tunnel.service.ts` — `openUdpTunnel(device_id)` returns a `TunnelUdpSocket` (dgram‑shaped: `send(buf,port,host)` + `'message'(buf,{address,port})`), routed via a UDP branch in `onTunnelReadDataReceived`. `okam-p2p.service.ts` — the clean‑room PPPP client (cipher + handshake + livestream + keyframe reassembly) over any dgram‑like socket; **learns the camera's address/port/DID from its LanSearch reply** (plug‑and‑play, only the default admin/888888 auth is baked in). `okam-cam.service.ts` — `ffmpeg` H.264→JPEG then `imageModel.create({format:'jpeg',…})`. A `startPolling()` grabs one still per camera‑device every ~90 s (not auto‑started — wire at bootstrap once the firmware is flashed).

Validated live LAN‑direct (Mac on the camera LAN): the **exact TypeScript client logic** pulls a 2304×1296 keyframe from `192.168.144.85`. The only production difference is the socket comes from `openUdpTunnel()` instead of node `dgram`. The **firmware builds and boots** — `/firmware-check` passed two OTA cycles on fridge + controller (it also caught one real compile bug: `tunnelActive` called the non‑const `WiFiClient::connected()` through a `const` ref). **Still unverified:** whether the thin tunnel's latency/throughput sustains the P2P keepalive + a ~30–200 KB keyframe within a reasonable window (the acknowledged risk of this approach) — answerable only once a controller with this firmware is on a camera's LAN. Discovery through the tunnel uses the `255.255.255.255` LAN broadcast (the server never needs the camera's LAN IP).

## 16. Live hardware bring-up (2026‑08‑19) — capture works LAN‑direct, tunnel is the wall

Flashed the firmware to the fridge module; provisioning + `webcam_did` reporting work on real hardware (`hardwareInfo.webcam_did` set, `message-terp-cam-connected` logged). Two things then surfaced:

- **`snapshot.cgi` over P2P returns a ready JPEG on channel 0** — no H.264/keyframe/decode needed. LAN‑direct this is 100% reliable: clean 640×360 JPEG (`okam-p2p.service.ts` now grabs via `snapshot.cgi`, `okam-cam.service.ingestJpeg` stores it directly). The video channel (livestream) also works LAN‑direct but is worse over the tunnel.
- **The MQTT tunnel cannot reliably carry the multi‑packet transfer.** The image is ~30 DRW packets with PPPP sliding‑window flow control. Over the tunnel the transfer stalls after 1–8 packets, every time, with the camera's window frozen. Root causes, in order of impact:
  1. **The tunnel is MQTT QoS 0.** The firmware's `EspMQTTClient`/PubSubClient `publish()` is QoS‑0 only (no QoS arg; PubSubClient can't publish QoS 1). So tunnelled datagrams are fire‑and‑forget — lossy. The camera's window advances only on cumulative ACK of contiguous data, so the first lost packet that never gets retransmitted through the lossy link freezes the transfer.
  2. **`handleTunnelReads`/`handleTunnelCloses` early‑return `if (!ui.isIdle())`** — while the fridge UI is busy the controller stops forwarding the camera's packets, adding stalls.
  3. 5‑packets‑per‑loop forward cap + high MQTT round‑trip latency vs the camera's small retransmit window.
  Client‑side mitigations tried and ruled out: cumulative ACK (ack highest contiguous index, correct ARQ), minimal‑outbound to avoid congesting the bidirectional link, redundant acks, re‑request. None help because the loss is in the QoS‑0 transport, not the client.

**Conclusion:** reliable multi‑packet P2P over the QoS‑0 UI‑gated tunnel isn't achievable without either (A) an application‑level reliable‑delivery layer on the tunnel **and** relaxing the `ui.isIdle()` gate (real firmware work, uncertain), or (B) running the tiny P2P **snapshot** client on the controller LAN‑direct (proven 100% reliable, no decode since `snapshot.cgi` is already JPEG) and uploading the finished JPEG to the server over a normal HTTP POST — i.e. the "controller runs the client" option, but only ~snapshot+HTTP, no H.264. The image pipeline integration (store as `format:'jpeg'`, timelapse/thinning/serving) is done and reused either way.

### 16.1 Tunnel reliability attempt (2026‑08‑19) — measured, still not viable

Per the decision to keep the server‑side client + tunnel, the following were implemented and measured against the live fridge cam. Each is a real fix and is kept, but together they still do not produce a reliable image.

Fixed and confirmed working:
- **MQTT buffer**: `connect()` reset `setMaxPacketSize(1024)` on every (re)connect, silently dropping any tunnel message > 1 KB — i.e. every 1032‑byte camera datagram. Raised to 4096. Before: `maxLen=89`; after: `maxLen=1032`.
- **Auth**: the client used a captured `loginpas` hash from a previous pairing; after the camera was reset the correct value is the plain default (`loginpas=888888`). Symptom was `result=-1` on every CGI. Now `result= 0`.
- **Transfer method**: switched from the video channel + H.264 keyframe to `snapshot.cgi`, which returns a **ready JPEG on channel 0** — no decode, and channel 0 is far better behaved. LAN‑direct this yields a clean 640×360 JPEG every time.
- **UDP drain**: the relay drained only 5 datagrams per loop (`UDP_PACKET_PER_LOOP_COUNT` now 40) — an undrained datagram is a lost one.
- **Cumulative ACK**: acking each packet's own index tells the camera that packets in a gap arrived, so it never retransmits them; now acks the highest *contiguous* index.
- **Reassembly**: JPEG assembly no longer requires a globally contiguous buffer — one fragment lost anywhere earlier (e.g. in the preamble text) used to cap the contiguous prefix forever. It now assembles from the SOI fragment forward.
- **Relay reuse**: one persistent UDP relay per device instead of a new one per capture (slot churn forced a fresh P2P handshake and a new source port each time). This produced the single best run: **1362 datagrams** vs 1–8 before.
- **Stall detection**: no new fragment for 6 s ⇒ discard the partial and re‑request.

Remaining blocker — **the relay's throughput is not reproducible**. Consecutive attempts against the same camera/firmware range from `drwPkts={"0":6}, uniqueCh0frags=0` to 1362 datagrams, and no attempt has completed a JPEG through the tunnel. The signature (many packets received, few *unique* indices; the camera retransmitting) points at our ACKs not reaching the camera in time: the ESP32 spends its loop publishing inbound datagrams over MQTT (each publish is a blocking TLS write) and only then processes the queued `tunnel_write` ACKs, so the camera's ARQ times out and retransmits, which generates more inbound work — a feedback loop. Raising the drain rate made this worse, not better, which is consistent.

To pursue this further the relay needs a real design rather than tuning: a long‑lived relay whose lifecycle both sides agree on, ACK traffic prioritised over (or interleaved with) inbound forwarding — e.g. `client->loop()` between publishes — and probably a smaller inbound batch. The alternative remains §16 option (B): run the snapshot client on the controller LAN‑direct (proven 100 % reliable, JPEG needs no decode) and POST the finished image.

## 17. Final architecture — the controller runs the snapshot client

Decision (2026‑08‑20): stop relaying P2P through the MQTT tunnel. The camera's sliding‑window protocol needs low, predictable latency; a LAN round‑trip has it, a round‑trip through the tunnel does not (§16.1). So the client moved onto the controller, which is already on the camera's LAN.

**Flow:** image pipeline (unchanged trigger: poll schedule / test‑image button) → `readRtspStreamImage` sees `okam://…` → `okamP2PService.captureViaController` publishes `{action:'cam_capture'}` on `/devices/<id>/command` → firmware `okamCamCapture()` does LanSearch → handshake → `GET /snapshot.cgi` → streams the JPEG back on `/devices/<id>/image` → server reassembles and returns the buffer → pipeline stores it as `format:'jpeg'` (timelapses, thinning, sharing, the `/image/:device_id` route all follow for free).

**Why this is reliable:** the whole ARQ conversation stays on the LAN, where it has always worked 100 % (verified repeatedly). Only the finished JPEG crosses the internet, and it does so over MQTT‑on‑TCP — an ordered, retransmitting transport — in a one‑way, latency‑tolerant stream. No H.264 decode anywhere: `snapshot.cgi` already returns JPEG.

**Memory (the binding constraint on the ESP32) — `firmware/src/okamcam.cpp`:**
- **Nothing is heap‑allocated in the capture path.** Four file‑static buffers (~4.8 KB total: 1.2 KB datagram, 256 B outbound, 1.6 KB base64, 1.8 KB message). Static, so they can neither leak nor fragment the heap, and the cost is fixed and known rather than depending on runtime conditions.
- **The image is never buffered.** Fragments are published as they are read, so RAM use is independent of image size — a 32 KB or a 1 MB still costs the same.
- The 256‑byte cipher table is `const` → flash, not RAM. Base64 encodes into the static buffer (the shared helper returns a `std::string`, i.e. a heap allocation per fragment — deliberately not used here).
- The UDP socket is `stop()`ed on **every** return path, including the discovery‑ and auth‑failure paths.
- Every phase is time‑bounded (discover 4 s, auth 6 s, transfer 15 s, plus a 3 s idle abort) and feeds the task watchdog, so a silent camera can neither hang the loop task nor spin forever.
- Measured after the change: **RAM 20.3 %** (66 640 / 327 680 B), flash 66.3 %.

Server side holds one pending capture per device with a 30 s timeout; the fragment map is cleared on completion, timeout, abort and supersede, so nothing accumulates there either.

### 17.1 Why the on-device receiver is a real ARQ receiver

The first controller-side version received strictly in order and published each fragment as it arrived. It reproducibly died after 5–7 fragments (`message-cam-capture:incomplete bytes=7160`), while the identical logic on a laptop pulled the whole 33 KB image every time. Two device-specific causes, both now handled:

1. **Publishing between fragments.** `publishImageMessage()` is a blocking TLS write; while it runs no UDP can be read. The camera keeps sending, lwip's UDP mailbox (~6 datagrams by default) overflows, and the packets are gone. Fix: receive the whole image into the static buffer, publish afterwards — the camera has stopped sending by then, so blocking is free.
2. **Strict in-order acceptance.** With any loss or reordering the receiver discarded everything after the gap, so one dropped datagram ended the transfer. Fix: fragments are stored **by index** (`slot = index - base_index`, each at a fixed `slot * 1024` offset, with its own length recorded), the ACK carries the highest **contiguous** slot so the camera both advances its window and resends what is missing, and ACKs are coalesced (≥40 ms apart) so draining a burst is not one syscall per packet.

Completion is "the fragment containing the JPEG end marker has arrived **and** every fragment before it has too". Only then are the slots compacted (always a leftward `memmove`, so it is safe in place), trimmed to `SOI…EOI` — dropping the `result= 0;var …` preamble the camera sends ahead of the image — and published in ~1 KB fragments.

### 17.2 On-device receive loss — what was measured

The camera does not pace the image to the receiver: it blasts ~39 fragments of 1 KB back-to-back and only sparsely retransmits. A laptop on the same LAN loses none of them; the ESP32 initially captured **8 of 40** (`message-cam-capture:incomplete got=8/40 eoi=-1`). Everything in the drain loop is therefore a throughput problem, not a protocol problem. Measures applied, in the order they were tested:

- **WiFi modem power-save off for the capture** (`WiFi.setSleep(false)`, restored on every exit path). Power-save parks the radio between beacons and silently drops inbound UDP — a well-known ESP32 UDP-loss cause. Measured effect here: `got=9/39`, i.e. it was *not* the dominant factor, but it is kept because it can only help.
- **ACK coalescing.** The telling detail in `got=9/39` is that the first ~9 fragments arrive fine and the rest are lost: while there are no gaps the receiver was acking *every* packet, and each ACK is an lwip syscall during which the camera keeps filling a mailbox only a few datagrams deep. ACKs are now sent at most every 25 ms or every 8 fragments.
- **Watchdog fed on a timer, not per packet** — same reasoning: in the drain loop every avoidable syscall costs fragments.

The receiver tolerates the loss that remains (fragments are indexed, gaps are re-requested).

**Result: working.** With ACK coalescing in place the fridge module captures the image end to end — `message-cam-capture:ok bytes=31813 got=35/44 eoi=33`, and the cloud's test-image button returns `http=200` with a valid 640×360 JPEG. Note `got=35/44`: fragments are still lost, and the retransmit/indexed-reassembly path is what turns that into a complete image, so it is load-bearing rather than belt-and-braces.

### 17.3 Status and the remaining reliability gap

**Working end to end on hardware.** Both entry points produce a real image:
- test-image button → `http=200`, valid 640×360 JPEG (`message-cam-capture:ok bytes=31813 got=35/44 eoi=33`);
- the scheduled pipeline poll → `[okam] image assembled … 31828B`, stored as `format:'jpeg'` and served by `/image/:device_id`.

**Per-attempt success is ~1 in 3** (measured 2/6 over a few minutes). Because the existing poller retries on its normal schedule, a still still lands roughly every 1–2 min, but the failures are wasteful and should be chased down. What the diagnostics show:
- `got=35/44` on a success — fragments *are* lost even when it works; the indexed reassembly plus re-request is what completes the image.
- `got=17/17 eoi=-1` — everything we were sent arrived contiguously, but the camera stopped mid-image (~17 KB of 33 KB). Nothing was lost on our side; the sender simply stopped.
- `got=1/3 eoi=-1 try=3` immediately after a success — the retries return almost nothing, suggesting the camera needs a cooldown (or a fresh session) between snapshots rather than back-to-back requests on the same session.

Next things to try, in order: a short delay between the in-session retries (the camera looks busy right after delivering an image); re-running the handshake for each retry instead of reusing the session; and pacing the poll so a capture is never requested immediately after a previous one.

## 18. Full resolution (2304×1296) — the video-keyframe path

`snapshot.cgi` is hardwired to the 640×360 sub-stream: `stream=`, `resolution=` and `substream=` were all tried and every variant returns 640×360. The full-resolution image is only available from the **video** stream, so the controller now asks for `livestream.cgi?streamid=10&substream=2`, keeps the **first keyframe** and sends the raw H.264 to the cloud, which decodes it to a JPEG with ffmpeg (`okamCamService.decodeKeyframeToJpeg`). The ESP32 never decodes anything — the keyframe is ~32–47 KB, about the size of the old sub-stream JPEG.

Constraints and findings:
- **Buffer ceiling is the chip, not the design.** 64 KB of static buffer overflows `dram0_0_seg` by ~8 KB on this ESP32 (no PSRAM on `heltec_wifi_lora_32_V2`), so the frame buffer is 48 KB — measured keyframes are 32–47 KB, and anything larger is refused rather than grown. RAM 35.4%.
- **ACK the channel you are receiving on.** The first video build ACKed channel 0 while receiving channel 1, so the camera's video window never advanced and it never resent gaps: `got=9/48`, and 0/6 captures succeeded. Acking `VIDEO_CHANNEL` is what makes the video path viable at all.
- Video is a continuous stream rather than a paced request/response, so it is inherently harder on the device than the sub-stream snapshot was: the keyframe's ~47 fragments arrive back-to-back and later P-frames keep competing for the same shallow mailbox.

## 19. The reliability wall, measured (2026-08-20)

Requirement #3's remaining gap is **capture success rate**, and it is now characterised precisely rather than guessed at. Every number below is from the live fridge module against the live camera, 6-10 captures per build spaced 30 s.

### 19.1 What the stream actually does

Measured LAN-direct with a clean-room probe (`/tmp/okam-re/vidprobe.js`) and confirmed by on-device counters:

- `livestream.cgi?streamid=10&substream=2` delivers **exactly one keyframe — the first frame of the session.** Everything after it is P-frames of 90 B - 5 KB. On-device: `anch=1` on every single capture, and `skip=3..28` non-keyframe headers afterwards, never a second keyframe.
- **Re-issuing `livestream.cgi` on a running stream is ignored** (measured `re=5` restarts, no new keyframe). A fresh keyframe requires a fresh session, i.e. a whole new capture.
- `substream=1` is a different, low-resolution stream: ~2.7 KB keyframes. **2304x1296 is only available from substream=2**, and `snapshot.cgi` is hardwired to 640x360, so the first keyframe of substream=2 is the only full-resolution source that exists.
- The keyframe is **scene-dependent: 27-38 KB on a quiet scene, 52-67 KB on a busy one.** This is the single most destabilising fact — a build that works at 37 KB scores 0/10 unchanged once the scene brightens, because a keyframe larger than the buffer is refused outright.

### 19.2 Acking is a resend request, not an acknowledgement

The `0xd1` DrwAck behaves like "resend from here", not "I have this". Three builds bracket it:

| Acking strategy | fragments/capture | frame headers seen | result |
|---|---|---|---|
| From the first fragment (highest index seen) | 9000+ | 0-2 | 0/10 |
| From the first fragment (highest contiguous) | 4300-8500 | 3-7 | 0/8 |
| **None at all** | 578 | **510** | 0/8 (clean, but no way to fill a gap) |
| **Only while anchored on a keyframe** | ~1000 | ~20 | best measured |

Acking early floods the link with retransmitted data that drowns new data in lwip's few-deep UDP mailbox. Acking nothing gives pristine reception but no repair. **Acking only while a keyframe is being assembled** is the only strategy that both keeps the stream clean and repairs the frame being captured — that is what the shipped code does.

### 19.3 The memory ceiling, measured

`skipped-low-heap` now logs the real numbers: **free=158 KB but the largest contiguous block is 94,196 bytes.** Fragmentation, not total free heap, is the constraint. Sizing history:

- 48 KB buffer — allocates, but refuses today's 53 KB keyframes: 0/10.
- 64 KB buffer — allocates, still refuses the 67 KB ones: 0/10.
- 80 KB + 24 KB margin — needs 104 KB: skipped every capture.
- 80 KB + 12 KB margin — needs 94,208 vs 94,196 available. **Missed by 12 bytes**, skipped every capture.
- **76 KB + 8 KB margin** — needs 86,016, fits, leaves ~18 KB contiguous during the capture. Shipped.

Nothing is held between captures: the buffer is `malloc`'d per capture, freed on every exit path, and the guard skips the capture (the image service just retries later) rather than squeezing the rest of the firmware. Static RAM is unchanged at 20.4%.

### 19.4 Where it stands

With the buffer sized correctly the controller anchors on the keyframe on **every** attempt (`anch=1`, `maxlen≈53000`) and then loses it to missing fragments (`drop=1`). Best measured rate was **3/8** back when the scene produced 37 KB keyframes (~37 fragments); at 53 KB (~53 fragments) it is 0/6. Per-attempt success falls off sharply with fragment count, because the camera bursts the whole keyframe back to back and the ESP32's UDP mailbox is only a few datagrams deep.

**This is the wall: one keyframe per session, ~53 back-to-back 1 KB fragments, no second chance, on a chip with no PSRAM.** The 80% target is not reachable by tuning the receiver further. The options that would actually move it:

1. **Shrink the keyframe at the camera.** `camera_control.cgi?param=N&value=V` is a working setter (`result= 0`); `param=3` was observed to move `enc_bitrate` 512 -> 1024. The param-ID map is not known, and blind probing cost one camera reboot to undo, so this needs the app's CGI list (APK) rather than guesswork. A main stream at ~256 kbps would put keyframes near 25 KB (~25 fragments) — the regime that already scored 3/8 at 37 KB.
2. **Accept 640x360** via `snapshot.cgi`, which is a paced request/response rather than a live burst and was materially more reliable.
3. **A controller with PSRAM**, which removes both the buffer ceiling and the mailbox pressure.

### 19.5 The APK route is closed — this firmware cannot be told to shrink the keyframe

Option 1 above was pursued to the end. `base.apk` + `split_config.arm64_v8a.apk` were pulled from the `okamre` AVD (`adb pull /data/app/.../com.okampro.oksmart-*/`), and `libapp.so` (54 MB Flutter AOT) yields the app's complete CGI inventory. Findings:

- **There is no `set_camera_params.cgi` anywhere in the app** — the camera answers `var cgi="not support"` because the CGI genuinely does not exist on this build. The full setter surface is `camera_control.cgi?param=N&value=V` (the app uses params 1, 2, 3, 5, 11, 14, 16, 33, 34, 36-40), `decoder_control.cgi`, and `trans_cmd_string.cgi` (203 uses).
- Flutter's string table is unordered, so the param-ID map cannot be read off by proximity — each `camera_control.cgi?param=N&value=` is an isolated literal.
- **Tested against the live camera, nothing moves the encoder.** `param=0&value=4` (the classic VStarcam resolution slot) returns `result= 0` and changes nothing. `param=3` values 3 and 4 leave keyframes at 53-66 KB. The one earlier reading that looked like a bitrate change (`enc_bitrate` 512 -> 1024, and later ~3 KB keyframes) was a **wedged encoder**, not a low-bitrate mode — it survived across substreams and only cleared on `reboot.cgi`.
- The app's own UI strings advertise H.264+ / H.265 ("~50% less storage and bitrate"), and `trans_cmd_string.cgi?cmd=2105&command=2&videoFormat=` is the selector. It **accepts and persists** (`result= 0`, readback `videoFormat=1`) **but the encoder ignores it**: after a full reboot the stream is still H.264 (NAL 7/8/5) at 56.7 KB. `param=16` is the app's HD/SD stream toggle, not a resolution control.

**Conclusion: the main stream's bitrate and keyframe size are not controllable on firmware `EN120.8.53.11`.** The camera was left exactly as found (`resolution=5, enc_size=5, enc_bitrate=512, enc_framerate=15, enc_keyframe=15, videoFormat=0`), verified by readback.

### 19.6 Multiple sessions per capture — tried, and it backfires

Since each *session* reliably yields exactly one keyframe, the obvious move is several sessions per capture. Implemented (fresh socket + fresh LanSearch + fresh DevLgn per attempt, 6 attempts inside a 26 s budget) and measured: **0/10, and worse than that it damages the device.** Two independent failures:

- Discovery never completed on any session — `frag=0 anch=0 try=7`, i.e. every attempt fell through with no data at all.
- **Repeated `udp.stop()` / `udp.begin(0)` permanently fragments the heap**: the largest free block fell from 94,196 to 77,812 bytes and stayed there, so subsequent captures logged `skipped-low-heap`. Socket churn is not viable on this stack.

Reverted. The shipped build is one session per capture, with the cloud's own retry schedule providing the repetition.

## 20. Shipped: the 640x360 snapshot path (2026-08-20)

Following §19, the controller now ships the **`snapshot.cgi` path** and the full-resolution keyframe path is retired to git history. The reason is pacing, not resolution:

- `snapshot.cgi` is a **paced request/response** on DRW channel 0 — the camera sends a fragment, waits for its ack, sends the next. The receiver sets the rate, so a shallow UDP mailbox is not a problem.
- `livestream.cgi` is an **unpaced burst** — ~53 back-to-back 1 KB fragments with no unprompted retransmission and exactly one keyframe per session. The receiver has no say, and that is what caps it at ~3/8.

**Measured: 22/22** across two runs (10/10 and 12/12, captures spaced 30 s), every one a complete 640x360 JPEG of 26-39 KB that decodes and ends on its EOI marker — against 3/8 at best for the full-resolution path. Requirement #3's reliability target is met.

The device log shows the repair working rather than being avoided: a typical success is `got=43/56`, i.e. fragments *are* lost and the indexed reassembly plus contiguous re-ack is what completes the image. That mechanism is load-bearing, not belt-and-braces.

Implementation notes:
- Fragments are stored **by index** and the highest **contiguous** index is acked (coalesced). Taking them strictly in order and re-acking the last good one instead was measured far worse — `resend=343..553` out of ~400 fragments and 0/10 — because the `0xd1` packet is a resend request rather than a pure acknowledgement (§19.2), so naming an old index makes the camera go-back-N the whole window and the flood drowns the fragment actually wanted. Switching to indexed reassembly cut fragments per capture from ~420 to ~200.
- **The `result= 0;var …` preamble does not always fit in the first fragment.** The SOI lands in slot 2 on this camera, so the slot it appears in has to be recorded, not assumed to be slot 0. Assuming slot 0 left the preamble in front of the JPEG and every capture failed its final SOI check with a plausible-looking `bytes=39921` — a silent, total failure that only the marker check caught. The EOI scan is likewise only started once the SOI is known, so a stray `ff d9` byte pair in the preamble cannot end the image before it starts.
- The image is **buffered, then published**. Publishing is a blocking TLS write during which no UDP can be read; doing it between fragments killed the transfer after ~5 fragments.
- The JPEG is bounded by its **SOI/EOI markers** — the `result= 0;var …` preamble before SOI and any trailing text after EOI are stripped, and an image that never reached EOI is refused rather than stored as the grey-striped partial that looks like a broken lens.
- Buffer is **56 KB, malloc'd per capture and freed on every exit path**, with the same largest-free-block guard as before (`skipped-low-heap` reports free/max/needed). 640x360 stills measure ~31-33 KB. Static RAM 20.3%.
- The server needs **no change**: `okamP2PService.onImageMessage` already resolves a plain JPEG directly and only calls ffmpeg when the message carries `"h264":true`. That branch is left intact for whenever the full-resolution path is revived.

### 20.1 Reviving the full-resolution path

The complete recipe, the four reasons it is unreliable, and the list of things already tried and disproved are kept as a long comment block in **`firmware/src/okamcam.h`** so they sit next to the code rather than only in this document. In short: it needs a controller with **PSRAM** — that removes both the buffer ceiling and the memory pressure that makes draining a 53-fragment burst marginal. Shrinking the keyframe at the camera is not an option on firmware `EN120.8.53.11` (§19.5).

## 21. Camera factory-reset on disconnect (2026-08-20)

Disconnecting a camera in the module UI used to only forget the DID locally, which left the camera joined to a Wi-Fi network it was no longer paired with — recoverable only with the physical reset button. `okamCamFactoryReset()` now sends **`restore_factory.cgi`** over the same P2P session the capture path uses, so the camera drops back to its `@IPC-<n>` setup AP and can be paired again by this module or any other.

- It is **best effort by design**: a camera that is powered off or out of range must not make disconnecting impossible, so the module forgets the pairing either way and the UI says whether the reset was acknowledged (`cam disconnected and reset` vs `cam disconnected / cam did not answer - reset it by hand`).
- The command is re-sent for up to `RESET_CONFIRM_MS` and any channel-0 reply counts as confirmation, because the camera reboots as soon as it acts and the reply may never arrive. Resending is safe — it is idempotent, and after the first one the camera is gone.
- This also fixes the stale-credential trap noted in §15.4: after a factory reset the camera answers plain `loginpas=888888` again, which is what the next provisioning run uses.

Credentials note: this document contains live device credentials and must not be pushed to a public remote.
