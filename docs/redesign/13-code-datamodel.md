# Terp Control — Server data model, API surface, auth, multi-user/sharing

Ground truth map of `/home/user/terpcontrol.cloud/server` (branch `claude/controller-software-user-types-wc1jxn`).
Every claim below is from reading the file; paths are absolute-relative to the repo root and carry line numbers.

---

## 0. Stack shape in one paragraph

Express 4 + Mongoose 8 against MongoDB (`server/src/databases/index.ts:6-13`), plus InfluxDB 2 for
time-series (`server/src/services/data.service.ts:11`), plus RabbitMQ with the MQTT plugin as the
device bus (`rabbitmq/rabbitmq.conf`). Shared TS interfaces live in `shared-types/index.d.ts` and are
imported by both server and webapp as `@fg2/shared-types` (a `file:../shared-types` dependency,
`server/package.json:20`). There is **no ORM migration tooling of any kind** — schemas are Mongoose
documents and change by ad-hoc backfill code.

Bootstrap: `server/src/server.ts:22-32` instantiates nine route classes and mounts them all at `/`
(`server/src/app.ts:89-93`) — i.e. **routes are flat, there is no `/api` prefix and no versioning**
(except two hand-written legacy aliases under `/auth/v0.0.1/device/…`).

---

## 1. Full endpoint inventory

Auth column legend:
- **none** – no auth middleware and no in-controller check
- **user** – `authMiddleware` (any valid non-expired `token_type:'user'` JWT; demo sessions included but blocked from writes)
- **admin** – `authAdminMiddleware` (JWT with `is_admin:true`, not demo)
- **owner** – controller calls `isUserDeviceMiddelware(...)`: owner of the device, OR admin, OR demo-session on a demo device
- **owner|share** – controller calls `isUserDeviceOrShareMiddelware(...)`: as above OR a valid share token
- **device-secret** – authenticated by the device's own password / a shared secret, not a user session

### Auth (`server/src/routes/auth.route.ts`, `path='/'`)

| Method | Path | Auth | Rate limit | Purpose | Line |
|---|---|---|---|---|---|
| POST | `/signup` | none | 5/min | Create account; `ENABLE_SELF_REGISTRATION` is **not** checked here (only `REQUIRE_ACTIVATION` is, `auth.service.ts:49`) | 92 |
| POST | `/activate` | none | – | Activate by `activation_code` | 120 |
| POST | `/login` | none | 10/min | Returns `{user, userToken, refreshToken, imageToken}` + sets `Authorization` cookie | 154 |
| POST | `/demologin` | none | 20/min | Read-only anonymous demo session (`user_id:'demo'`) | 172 |
| POST | `/tokenlogin` | none | 20/min | Exchanges `AUTOMATION_TOKEN` for a **5-minute admin JWT with `user_id:''`** | 210 |
| POST | `/refresh` | none (refresh JWT in body) | – | New token triple | 240 |
| POST | `/getreset` | none | 5/min | Emails a password-reset token | 272 |
| POST | `/reset` | none (reset token in body) | – | Set new password | 299 |
| POST | `/logout` | user | – | Clears cookie only; JWT stays valid until expiry | 314 |
| POST | `/changepass` | user | – | Change own password. **Body carries `username` but the service ignores it and uses `req.user_id`** (`auth.controller.ts:142`) | 342 |

### Users (`server/src/routes/users.route.ts`, `path='/users'`) — admin only

| Method | Path | Auth | Purpose | Line |
|---|---|---|---|---|
| GET | `/users` | admin | List all users (projection `{username,user_id,is_admin}`, `users.service.ts:42`) | 36 |
| GET | `/users/:id` | admin | Find by Mongo `_id` | 67 |
| POST | `/users` | admin | Create user (`CreateUserDto`) | 105 |
| PUT | `/users/:id` | admin | Update — **buggy**: `findByIdAndUpdate(userId, { userData })` wraps the payload in a literal `userData` key (`users.service.ts:80`), so it writes nothing useful | 150 |
| DELETE | `/users/:id` | admin | Delete by `_id` | 174 |

There is **no** `GET /users/me`, no self-service profile endpoint, and no way for a non-admin to
enumerate or look up another account.

### Devices (`server/src/routes/device.route.ts`, `path='/device'`)

| Method | Path | Auth | Purpose | Line |
|---|---|---|---|---|
| GET | `/device/all` | admin | Every device document, unredacted | 45 |
| POST | `/device/create` | admin | Provision a device, returns plaintext password once | 73 |
| POST | `/device/register` | device-secret (`SELF_REGISTRATION_PASSWORD`) | Firmware self-registration | 106 |
| GET | `/device` | user | Devices owned by caller (or all demo devices) — projection at `device.service.ts:894-903` | 126 |
| POST | `/device` | user | **Claim** a device by `claim_code` | 157 |
| DELETE | `/device/:device_id` | owner | Unclaim (sets `owner_id:''`) | 180 |
| POST | `/device/configure` | owner | Write device configuration (JSON string) | 210 |
| POST | `/device/alarms` | owner | Replace the whole alarm array | 246 |
| POST | `/device/cloudsettings` | owner | Replace `cloudSettings` | 275 |
| POST | `/device/setname` | owner | Rename | 303 |
| GET | `/device/config/:device_id` | owner | Read configuration | 328 |
| GET | `/device/alarms/:device_id` | owner | Read alarms | 353 |
| GET | `/device/cloudsettings/:device_id` | owner (no route middleware; controller checks) | `DeviceAccessInfo` | 377 |
| GET | `/device/recipe/:device_id` | owner | The grow plan embedded in the device doc | 400 |
| POST | `/device/recipe` | owner | Write the grow plan | 431 |
| GET | `/device/recipes` | user | Recipe **templates**: `public:true` OR `owner_id === user` | 452 |
| POST | `/device/recipes` | user | Create template (name globally unique) | 486 |
| GET | `/device/recipes/:template_id` | user + doc-level check | Public, own, or admin | 511 |
| PUT | `/device/recipes/:template_id` | user + doc-level check | Own or admin | 551 |
| DELETE | `/device/recipes/:template_id` | user + doc-level check | Own or admin | 576 |
| POST | `/device/claimcode` | **none** (device password only if `hardwareInfo.claimcode_auth === 'on'`) | Mint a 6-char claim code | 606 |
| POST | `/auth/v0.0.1/device/claimcode` | same | Legacy firmware alias | 634 |
| GET | `/device/firmware` | admin | All firmware records | 654 |
| GET | `/device/firmwares/:device_id` | owner | Firmware list visible to the owner | 693 |
| GET | `/device/firmware/find` | admin | By name+version | 718 |
| GET | `/device/firmware/:firmware_id/:binary` | **none** | OTA binary download (device fetches it) | 745 |
| DELETE | `/device/firmware/:firmware_id` | admin | Delete firmware + binaries | 768 |
| PUT | `/device/firmware/:firmware_id` | admin | Rename version label | 802 |
| GET | `/auth/v0.0.1/device/firmware/:firmware_id/:binary` | **none** | Legacy OTA alias | 828 |
| POST | `/device/firmware/:firmware_id/:binary` | admin | Upload binary (max 2 MiB for `firmware.bin`, `device.service.ts:1591`) | 869 |
| POST | `/device/firmware` | admin | Create firmware record | 898 |
| GET | `/device/class` | admin | Device classes | 923 |
| GET | `/device/class/find/:class_name` | admin | Class by name | 946 |
| GET | `/device/class/:class_id` | admin | Class by id | 969 |
| POST | `/device/class` | admin | Create class | 1002 |
| POST | `/device/class/:class_id` | admin | Update class | 1039 |
| POST | `/device/test/:device_id` | owner | Test mode — force outputs | 1082 |
| DELETE | `/device/test/:device_id` | owner | Stop test mode | 1105 |
| GET | `/device/logs/:device_id` | owner\|share | Diary / log entries | 1147 |
| DELETE | `/device/logs/:device_id` | user + **owner filter only inside the service** | Soft-delete every log (see §8 gap) | 1170 |
| DELETE | `/device/logs/:device_id/:log_id` | owner | Hard-delete one log | 1197 |
| POST | `/device/logs/:device_id` | owner | Add a diary entry | 1241 |
| PUT | `/device/logs/:device_id/:log_id` | owner | Edit a diary entry | 1287 |
| GET | `/device/byserial` | admin | Device by serial number | 1310 |
| POST | `/device/maintenancemode` | owner | Suppress alarms + tell device | 1341 |
| POST | `/device/reboot` | owner | MQTT reboot command | 1369 |
| POST | `/device/auxcommand` | owner | Whitelisted socket/cam commands (`device.service.ts:859-891`) | 1419 |
| GET | `/device/onlinedevices` | admin | Fleet counters | 1439 |
| GET | `/device/firmwareversions` | admin | Rollout dashboard data | 1459 |

### Data (`server/src/routes/data.route.ts`, `path='/data'`)

| Method | Path | Auth | Purpose | Line |
|---|---|---|---|---|
| GET | `/data/series/:device_id/:measure` | owner\|share | Aggregated Influx series (`from`,`to`,`interval`,`method`) | 63 |
| GET | `/data/latest/:device_id/:measure` | owner\|share | Last 5-minute value | 94 |

### Images (`server/src/routes/image.route.ts`, `path='/image'`)

| Method | Path | Auth | Purpose | Line |
|---|---|---|---|---|
| GET | `/image/:device_id` | owner\|share, token type `'image'` (also accepts `?token=`) | Webcam still, timelapse mp4, or diary photo by `image_id` | 66 |
| POST | `/image/test/:device_id` | user + owner | Probe an RTSP URL, return one frame | 109 |
| POST | `/image/:device_id` | user + owner | Upload a diary photo (`format:'user/jpeg'`) | 148 |
| DELETE | `/image/:image_id` | user + owner (resolved via the image's `device_id`) | Delete an image | 173 |

### Shares (`server/src/routes/share.route.ts`, `path='/share'`)

| Method | Path | Auth | Purpose | Line |
|---|---|---|---|---|
| GET | `/share/resolve/:share_id` | **none** | Validate link, bump `openCount`/`lastOpenedAt`, return sanitised `DeviceAccessInfo` | 39 |
| GET | `/share` | user | Own share links, newest first | 59 |
| POST | `/share` | user + owner (`isUserDeviceMiddelware` inside, `share.controller.ts:29`) | Create link | 103 |
| POST | `/share/:share_id/revoke` | user (owner-scoped query) | Revoke | 129 |
| DELETE | `/share/inactive` | user | Delete all expired/revoked | 150 |
| DELETE | `/share/:share_id` | user | Delete one inactive link | 176 |

### Chart presets (`server/src/routes/chartpreset.route.ts`, `path='/chartpresets'`)

| Method | Path | Auth | Purpose | Line |
|---|---|---|---|---|
| GET | `/chartpresets` | user | Own presets | 34 |
| POST | `/chartpresets` | user | Create (max 50/user, name ≤60, query ≤2000) | 71 |
| DELETE | `/chartpresets/:preset_id` | user | Delete own | 96 |

### Infrastructure

| Method | Path | Auth | Purpose | Line |
|---|---|---|---|---|
| GET | `/` | none | Liveness | `index.route.ts:27` |
| GET | `/readycheck` | none | Ready when a user named `admin` exists — **hard-coded username**, so it 501s when `ADMINUSER_USERNAME` is anything else (`index.controller.ts:18`) | `index.route.ts:43` |
| GET | `/swagger.json`, `/api-docs` | none | OpenAPI spec + Swagger UI (`app.ts:96-102`) | – |
| POST | `/mqttauth/:secret/{user,vhost,topic,resource}` | shared secret (`MQTTAUTH_SHARED_SECRET`, constant-time compare) | RabbitMQ HTTP auth backend | `mqttauth.route.ts:17-21` |

**Total: ~70 HTTP endpoints.** Swagger default security is `bearerAuth` (`utils/swagger.ts:21`) with
per-route `security: []` overrides on public endpoints.

---

## 2. Data model and relationships

All eight-plus collections are **flat documents joined by string ids, never by `ObjectId` refs and
never with `populate()`**. There is not a single `Schema.Types.ObjectId` reference in the codebase.

```
User (users)                         Device (devices)
  user_id  (uuid, NOT unique!) ◄──────  owner_id  (string, optional, NOT indexed)
  username (unique, = email)            device_id (unique)   ◄──┐
  password (bcrypt)                     username  (unique, MQTT login)
  is_admin, is_active                   password  (bcrypt or legacy plaintext)
  activation_code                       class_id  ──► DeviceClass.class_id
                                        device_type ('controller'|'fridge'|'plug'|'fan'|'light')
                                        serialnumber (max+1 at create; racy)
                                        configuration (JSON **string**)
                                        lastseen (epoch ms; online = <10 min, ONLINE_TIMEOUT)
                                        current_firmware / pending_firmware(dep.) / fwupdate_start / fwupdate_end
                                        alarms: [Alarm]              (embedded array)
                                        cloudSettings: {...}         (embedded object)
                                        firmwareSettings: {autoUpdate} (deprecated)
                                        recipe: {steps[], activeStepIndex, activeSince, ...} (embedded)
                                        hardwareInfo: Mixed (flat key→string map)
                                        maintenance_mode_until
                                        demoDevice: boolean
                                                                     │
ClaimCode (claimcodes)      DeviceLog (devicelogs)                  │
  claim_code (unique)         device_id ───────────────────────────►┤
  device_id  (unique)         message/title/raw/severity/time       │
                              categories: [String]                  │
DeviceClass (deviceclasses)   deleted: boolean (soft delete)        │
  class_id (uuid, NOT unique) data: Mixed (DiaryEntryData)          │
  name, description           images: [String] (image_id list)      │
  concurrent, maxfails        idx {device_id, deleted, categories, time} (devicelog.model.ts:50)
  firmware_id / beta_firmware_id / alpha_firmware_id                │
                                                                    │
DeviceFirmware (devicefirmwares)   Image (images)                   │
  firmware_id (unique)               image_id (unique)              │
  class_id, name, version            device_id ────────────────────►┤
  createdAt, wasStable               timestamp / timestampEnd       │
DeviceFirmwareBinary                 data: Buffer  ← binary in Mongo│
  firmware_id (NOT unique) + name    format: 'jpeg'|'mp4'|'user/jpeg'
  data: Buffer                       duration: '1d'|'1w'|'1m'
                                     unique idx {device_id, format, timestamp, duration}
ShareLink (shares)                 ChartPreset (chartpresets)      │
  share_id (unique, 24 rnd bytes)     preset_id (unique)            │
  device_id (indexed) ──────────────► owner_id (indexed)            │
  owner_id  (indexed)                 name, device_type, query      │
  page: 'charts'|'diary'              createdAt                     │
  editable, webcam, charts                                          │
  query (≤2000 chars)               RecipeTemplate (recipetemplates)│
  createdAt/expiresAt/revokedAt       name (globally unique!)       │
  openCount/lastOpenedAt              owner_id (optional)           │
                                      public: boolean               │
PasswordToken (passwordtokens)        steps: [RecipeStep]           │
  user_id, token, createdAt           createdAt/updatedAt           │
```

### Where the time-series samples actually live

**Not in MongoDB.** Sensor/output samples go straight into **InfluxDB 2**:

- Write path: MQTT `/devices/<id>/status` and `/bulk` → `deviceService.statusMessage`
  (`device.service.ts:552-557`) → `dataService.addData` (`data.service.ts:34-63`).
- Measurement `status`, bucket `INFLUXDB_BUCKET`, tags `device_id` **and `user_id`**
  (`data.service.ts:38`) — the tag is the device's `owner_id` at write time.
- Fields: `VALID_SENSORS` = `temperature, humidity, avg, p, i, d, co2, rpm, day, sensor_type,
  leaf_temperature, lux` (`data.service.ts:12`); outputs are prefixed `out_` and drawn from
  `VALID_OUTPUTS` = `heater, dehumidifier, co2, light, fan, relais, fan-internal, fan-external,
  fan-backwall` (`data.service.ts:19`). **Anything not in those two whitelists is silently dropped.**
- Read path: Flux queries filtering only on `device_id` (`data.service.ts:80-89`), i.e. the
  `user_id` tag is written but never read for authorisation. `vpd*` and `ppfd` are **derived
  client-side of Influx** in `getSeriesVpd` / `getSeriesPpfd` (`data.service.ts:97-160`), not stored.
- The Influx client URL is **hard-coded** to `http://influxdb:8086` (`data.service.ts:11`), ignoring
  the `INFLUXDB_HOST` config value. `databases/index.ts:17-38` still exports a legacy `influxConnection`
  schema for the old `influx` v1 client — dead code.
- Diary entries, alarms state, config, recipes, images all live in **MongoDB**.
- Images and firmware binaries are stored **as `Buffer` inside Mongo documents**, not GridFS and not on
  disk (`images.model.ts:22`, `devicefirmware.model.ts:46`). Retention: 3 years, plus thinning tiers
  (`image.service.ts:62-73`).

---

## 3. Exactly how authorisation is done

Everything is in `server/src/middlewares/auth.middleware.ts`. There are **five** entry points.

**Token collection** (`:16-33`) — candidates are gathered from the `Authorization` cookie, the
`Authorization: Bearer` header, and (GET on `/image/…` only) `?token=`. Each is verified in turn
(`:39-52`); the first one whose `token_type` matches wins. `'user'` satisfies a request for `'image'`
(`:36-37`).

**`applyToken`** (`:54-59`) sets `req.user_id`, `req.is_demo`, and `req.is_admin = !is_demo && token.is_admin`.

**`authMiddleware`** (`:82-99`) — only proves "a session exists". It does **no** device check.

**`authAdminMiddleware`** (`:122-143`) — requires `is_admin && !is_demo && token_type==='user'`.
Note it does *not* use `getAuthorizationCandidates`, so it ignores the `?token=` path (fine) but also
only ever considers **one** token (cookie first, else header) — a stale cookie can shadow a valid
admin bearer header here.

**The device authorisation check — quoted in full** (`:145-184`):

```ts
export const isUserDeviceMiddelware = async (
  req: RequestWithUser,
  res: Response,
  device_id: string,
  tokenType: DataStoredInToken['token_type'] = 'user',
) => {
  try {
    if (getAuthorizationCandidates(req).length === 0) {
      res.status(401).send('Authentication token missing');
      return false;
    }

    const verificationResponse = await verifyFirstMatchingToken(req, tokenType);
    if (!verificationResponse) {
      res.status(401).send('Wrong authentication token');
      return false;
    }

    applyToken(req, verificationResponse);
    if (req.is_admin) {
      return true;
    }
    if (req.is_demo) {
      if (await isDemoDevice(device_id)) {
        return true;
      }
    } else {
      const devices: Device[] = await deviceModel.find({ owner_id: req.user_id, device_id: device_id }, { device_id: 1 });
      if (devices.length > 0) {
        return true;
      }
    }

    res.status(403).send(`Device ${device_id} not bound to user ${req.user_id}`);
    return false;
  } catch (error) {
    res.status(401).send('Wrong authentication token');
    return false;
  }
};
```

The single load-bearing line is `deviceModel.find({ owner_id: req.user_id, device_id })` at **line 172**.
That equality test *is* the authorisation model.

**`isUserDeviceOrShareMiddelware`** (`:186-228`) is the same check plus a share-token fallback at
line 214 (`findValidShare`), which sets `req.share` and returns true. It is used by exactly four
handlers: `getSeries`, `getLatest`, `getDeviceLogs`, `getDeviceImage`.

**Share token lookup** (`:70-80`): token comes from `?share=` or the `X-Share-Token` header; the
document must match `device_id`, have `revokedAt: null`, and either `expiresAt: null` or `expiresAt > now`.

**Note this is not real Express middleware** — it is an `await`-ed helper called *inside* each
controller that returns a boolean and writes the error response itself. Forgetting to call it is a
silent authorisation bypass (see §8).

**Defence in depth**: many services re-apply the owner filter in the query
(`device.service.ts:1140-1142, 1197-1198, 1214-1215, 1257-1258`) via
`deviceAccessFilter(device_id, user_id, is_admin, is_demo)` at `device.service.ts:1263-1267`:

```ts
private deviceAccessFilter(device_id: string, user_id: string, is_admin: boolean, is_demo: boolean) {
  if (is_admin) return { device_id: device_id };
  if (is_demo) return { device_id: device_id, demoDevice: true };
  return { device_id: device_id, owner_id: user_id };
}
```

**Demo sessions** are blocked from writing globally by `demoReadOnlyMiddleware` (`:107-120`), mounted
app-wide at `app.ts:86` — any non-GET/HEAD/OPTIONS request outside `DEMO_ALLOWED_PATHS` (`:103`) from a
token with `is_demo` gets 403.

---

## 4. Can a device be reached by more than one account with write rights today?

**No — not per-device. There is no mechanism at all.** Proof, exhaustively:

1. `Device.owner_id` is a **single `String`** (`device.model.ts:30-33`), not an array, not a subdocument
   list. `shared-types/index.d.ts:165` types it `owner_id: string`.
2. Every write path resolves to `isUserDeviceMiddelware`, whose only non-admin branch is the exact-match
   query on `owner_id` (`auth.middleware.ts:172`). There is no `$in`, no membership collection, no join.
3. Claiming **replaces** the owner unconditionally and silently:
   `device.service.ts:1123-1134` — `deviceModel.findOneAndUpdate({ device_id }, { owner_id: user_id })`.
   The previous owner is not consulted, not notified, and immediately loses all access. Claiming is
   therefore a *transfer*, never an *addition*.
4. Unclaiming clears it: `owner_id: ''` (`device.service.ts:1137`). An empty string is a valid
   `owner_id`, so a bug that leaves `req.user_id` empty would match all unclaimed devices.
5. **Share links are read-only.** `ShareLink.editable` (`shared-types/index.d.ts:79-80`) is documented
   as *"Visitors may change the view (time frame, measures, filters, webcam)"* — a **UI/view** flag, not
   a write grant. No write endpoint consults `req.share`; the four read endpoints listed in §3 are the
   entire share surface. Shares also grant only `charts` or `diary` pages
   (`share.model.ts:20-24`), never settings, alarms, recipes, test mode, or reboot.
6. **Two escape hatches do exist, both global not per-device:**
   - `is_admin: true` short-circuits every check (`auth.middleware.ts:164-166, 198-200`; also
     `deviceAccessFilter` line 1264). An admin can write to every device in the system.
   - `POST /tokenlogin` mints a **5-minute admin JWT with `user_id: ''`** for anyone holding
     `AUTOMATION_TOKEN` (`auth.service.ts:147-179`). That is a fleet-wide root key, not a user.

Conclusion: today, a device has exactly **one** writing account plus the global admin population.
Anything club-, team-, or household-shaped has to be built from scratch.

---

## 5. Everywhere `owner_id` is assumed singular (exhaustive, file:line)

**Schema / types**
- `server/src/models/device.model.ts:30-33` — `owner_id: { type: String, required: false }` (not indexed, not an array).
- `shared-types/index.d.ts:165` — `owner_id: string;` on `Device`.
- `server/src/models/share.model.ts:15-19`, `chartpreset.model.ts:10-14`, `recipe.model.ts:6` — same single-string pattern for the other owned entities.

**Authorisation**
- `server/src/middlewares/auth.middleware.ts:172` — the write check.
- `server/src/middlewares/auth.middleware.ts:207` — the read-or-share check.
- `server/src/services/device.service.ts:1263-1267` — `deviceAccessFilter`, the service-layer repeat.

**Listing / ownership transfer**
- `server/src/services/device.service.ts:912` — `findUserDevices`: `deviceModel.find({ owner_id: user_id }, projection)`. This is *the* "my devices" query.
- `server/src/services/device.service.ts:1128` — `claimDevice`: overwrites `owner_id`.
- `server/src/services/device.service.ts:1137` — `unClaimDevice`: `owner_id: ''`.
- `server/src/services/device.service.ts:988` and `:1034` — new devices created with `owner_id: ''`.
- `server/src/services/device.service.ts:999` — `deleteOne({ device_id, owner_id: '' })` treats `''` as "unclaimed".

**Owner-scoped writes/reads in the service layer**
- `server/src/services/device.service.ts:752` — `deleteDeviceLogs`.
- `server/src/services/device.service.ts:763` — `deleteDeviceLog` (non-admin branch).
- `server/src/services/device.service.ts:792` — `updateDeviceLog` (non-admin branch).
- `server/src/services/device.service.ts:1142` — `configureDevice`.
- `server/src/services/device.service.ts:1198` — `setDeviceAlarms`.
- `server/src/services/device.service.ts:1215` — `setDeviceCloudSettings`.
- `server/src/services/device.service.ts:1258` — `setDeviceName`.
- `server/src/services/device.service.ts:1266` — the non-admin non-demo branch of `deviceAccessFilter`.
- `server/src/services/device.service.ts:1336` — `getDeviceAccessInfo`: `device.owner_id === user_id`.

**Owned side-entities (would each need the same treatment)**
- `server/src/controllers/share.controller.ts:36, 56, 66, 83, 97` — shares are owned by one user; a second user with device access could neither see nor revoke a link the first created.
- `server/src/controllers/chartpreset.controller.ts:13, 31, 38, 53`.
- `server/src/controllers/device.controller.ts:627, 650, 669, 687, 718` — recipe templates.

**Time-series tagging**
- `server/src/services/data.service.ts:38` — `writeApi.useDefaultTags({ device_id, user_id })`; `user_id` here is `device.owner_id` at sample time (`device.service.ts:553-554`). Historic samples therefore carry whichever single owner held the device then. Re-owning a device leaves a mixed tag history — harmless today (queries never filter on it) but it is a lie waiting to be believed.
- `server/src/databases/index.ts:35` — legacy Influx schema lists `tags: ['device_id','user_id']`.

**Nowhere in the repo** is there a `role`, `member`, `team`, `club`, `organisation`, or `tenant`
concept — a grep across `server/src` for those words returns only the unrelated smart-socket `role`
parameter (`device.service.ts:865`).

### What multi-user/club access would concretely require

1. A membership collection (e.g. `DeviceAccess {device_id, user_id, role, grantedBy, grantedAt}`) or an array on `Device`; the `Device.owner_id` string stays as "billing/primary owner" or becomes derived.
2. Rewrite the two authorisation queries (`auth.middleware.ts:172, 207`) to a membership lookup, and change `deviceAccessFilter` (`device.service.ts:1263`) from a Mongo filter into an explicit permission decision — the current design *fuses* authorisation and the data query, so a membership model cannot be expressed as one filter object. Every call site listed above then needs its owner-scoped query loosened.
3. `findUserDevices` (`:912`) must become a two-step (memberships → device ids → `$in`) query, and the `Device` collection needs an index on the membership key (`owner_id` has **no index today**).
4. A read/write role split, because share links already prove the product wants "can look, cannot touch" — that logic currently lives only in which middleware a controller happens to call.
5. Ownership of shares, chart presets, and recipe templates becomes ambiguous (§5 list) — decide per entity whether it follows the user or the device/club.
6. `claimDevice` (`:1128`) must stop being a silent takeover; today anyone with a claim code steals the device outright.
7. Invitation/acceptance needs an account-lookup-by-email endpoint, which does not exist (users are admin-only readable, `users.route.ts:36`).
8. Audit: `DeviceLog` has no actor field — with several writers you can no longer tell who changed a setting. `configureDevice` logs a diff (`device.service.ts:1149-1157`) but records no user.

---

## 6. Migration mechanism for schema changes

**There is none.** No `migrate-mongo`, no `mongoose-migrate`, no versioned migration folder, no
`schemaVersion` field on any document. Confirmed by grepping the whole repo for `migrat*` — the only
hits are a code comment and an unrelated line in `RASPBERRY-PI.md`.

How breaking changes are actually handled, by observed precedent:

1. **Additive optional fields.** Every non-key field in every schema is `required: false`. New features
   just add an optional field and read it defensively.
2. **Deprecate-in-place, dual-read.** `Device.pending_firmware` → `cloudSettings.pendingFirmware`
   (`shared-types/index.d.ts:169-170`); both are read forever through
   `effectivePendingFirmware()` (`device.service.ts:231-233`) and both are matched in queries via
   `pendingFirmwareMatches` / `pendingFirmwareNotEquals` (`:335-343`). Same for
   `firmwareSettings.autoUpdate` → `cloudSettings.firmwareChannel`
   (`normalizeCloudSettings`, `device.service.ts:1280-1315` and `firmwareChannelQuery`, `:301-333`).
3. **Boot-time backfill.** `DeviceService.backfillFirmwareCreatedAt()` (`device.service.ts:115-142`) runs
   in the constructor **on every server start**, scanning for missing `createdAt` and deriving it from
   the `ObjectId` timestamp, then setting `wasStable`. This is the closest thing to a migration and it is
   idempotent-by-query, not tracked.
4. **Lazy migration on successful auth.** Plaintext device passwords are re-hashed the first time they
   authenticate (`mqttauth.service.ts:35-39`, `device.service.ts:952-955, 1106-1108`, helper at
   `utils/devicepassword.ts:24-29`). Same pattern would work for ownership data.
5. **Drop-the-bad-value.** Out-of-enum `cloudSettings.webcamModel` is deleted rather than allowed to fail
   the whole save (`device.service.ts:1308-1312`) — because Mongoose enum violations reject the entire
   document.
6. **Defaults injected at read time.** `normalizeCloudSettings` fills VPD offsets, transport, etc. on
   every read, so old documents behave like new ones.

Practical implication for a new feature: **any new required field is a breaking change with no tool to
apply it.** The house style is optional field + read-time normaliser + (if needed) an idempotent
backfill in a service constructor.

---

## 7. Existing webhook / outbound-integration machinery

Two things exist and one of them is genuinely reusable.

**a) Alarm webhooks — `server/src/services/alarm.service.ts:194-283`.** The only outbound HTTP in the
product. Per-alarm configuration lives on `Device.alarms[]` (`device.model.ts:66-95`):
`actionType: 'email'|'webhook'|'info'`, `actionTarget` (URL; supports a `|` separator so triggered and
resolved go to *different* targets, `:442-448`), `webhookMethod: GET|POST|PUT`, `webhookHeaders` (Mixed),
`webhookTriggeredPayload` / `webhookResolvedPayload`, `reportWebhookErrors`, `tunnelWebhook`,
`cooldownSeconds`, `retriggerSeconds`, `thresholdSeconds`.

Reusable pieces:
- **`applyWebhookTemplate`** (`server/src/utils/webhookTemplate.ts:13-30`) — `{{placeholder}}`
  substitution with `'json'` and `'url'` escaping modes. Variables available today at
  `alarm.service.ts:222-234`: `deviceId, deviceName, sensorType, value, upperThreshold, lowerThreshold,
  event, timestamp, alarmName, alarmId, extremeValue`.
- The **default JSON payload** shape at `alarm.service.ts:201-213`.
- **Error surfacing into the diary** — a failed webhook writes a `message-alarm-webhook-error` log entry
  when `reportWebhookErrors` is set (`:271-278`).
- **Tunnelled delivery** via `tunnelService.createTunnelProxyServer` (`:242`) — the request is routed
  *through the grower's own controller* over MQTT so it can reach a LAN endpoint (Home Assistant etc.).

Sharp edges if reused: raw `http`/`https` `request()` with **no timeout, no retry, no queue, no SSRF
guard, no allowlist, and fire-and-forget semantics** (`req.write` + `req.end`, no response body read).
It is triggered only by alarm state transitions — there is **no generic event bus** to hang a "grow
diary entry created" or "harvest logged" hook on.

**b) Outbound email — `server/src/services/auth.service.ts:29-39`** exports a shared nodemailer
`mailTransport`, reused by the alarm service (`alarm.service.ts:184`) and by recipe step notifications
(`device.service.ts:539-544`). Recipient addresses are per-alarm (`actionTarget`) or per-recipe
(`Recipe.email`) — **never taken from the user account**, which is why `demoRecipe`/`demoAlarms` strip them.

**c) Inbound**: none. There is no incoming-webhook endpoint, no API-key model, no OAuth, no per-user
personal access token. The only non-session credential is the fleet-wide `AUTOMATION_TOKEN`
(`/tokenlogin`). A published OpenAPI spec exists (`/swagger.json`, `utils/swagger.ts`) but nothing
consumes it programmatically.

**d) MQTT is the device bus only** — `databases/mqttclient.ts`, subscribed to `/devices/#`
(`device.service.ts:158`), dispatching on topic segment 4: `status`, `bulk`, `fetch`, `log`,
`configuration`, `tunnel_read`, `image`, plus outbound `command`, `firmware`, `configuration`,
`tunnel_write`. RabbitMQ authorises every device against MongoDB through the HTTP backend
(`mqttauth.service.ts`), restricting each device to routing keys starting `.devices.<its own id>.`
(`:84-87`). Not a general integration surface.

---

## 8. Rate limiting, validation, security posture — what a new feature must respect

**Rate limiting** — `express-rate-limit`, **only on `/auth` routes**, per IP, 1-minute windows
(`auth.route.ts:9-49`): tokenlogin 20, login 10, demologin 20, signup 5, getreset 5. Everything else —
device writes, log creation, image upload, chart series, share creation, share resolution — is
**unlimited**. `app.set('trust proxy', …)` is set twice and inconsistently: `true` at `app.ts:34`,
then `1` at `app.ts:72`; the later call wins for the limiter.

**Validation** — `class-validator` via `validationMiddleware` (`middlewares/validation.middleware.ts`),
configured `whitelist: true, forbidNonWhitelisted: true`, so unknown body keys are a **400**. Applied to
only 12 of ~70 endpoints (signup, activate, login, getreset, reset, changepass, users create/update,
device create/register/configure/setname/test, device class, device firmware). Everything else validates
by hand in the controller (`share.controller.ts:20-27`, `chartpreset.controller.ts:24-33`,
`device.controller.ts:471-479` and `:498-505`) or **not at all** (`/device/alarms`, `/device/cloudsettings`,
`/device/recipe`, `/device/maintenancemode`, `/device/reboot`, `/device/auxcommand`,
`/device/recipes` bodies).

**Hardening present**: `helmet`, `hpp`, `compression`, `cookie-parser`, `express-fileupload`
(`app.ts:79-85`); bcrypt cost 10 for both user and device passwords; constant-time compares for
`AUTOMATION_TOKEN` (`auth.service.ts:159`), `MQTTAUTH_SHARED_SECRET` (`mqttauth.middleware.ts:22`) and
legacy device passwords (`utils/devicepassword.ts:11-18`); `httpOnly`+`sameSite:lax` auth cookie with
`secure` derived from `req.secure` (`auth.controller.ts:18-26`); explicit whitelists for aux commands
(`device.service.ts:859-891`), `hardwareInfo` keys (`device.service.ts:603`, regex-bounded to stop Mongo
path traversal), Influx measures (`data.service.ts:12,19`) and Flux aggregation methods
(`data.service.ts:74-77`); OTA binary size cap 2 MiB (`device.service.ts:1591`); a whole demo-redaction
layer (`utils/demo.ts`) that strips RTSP URLs, socket IPs, alarm targets, recipe emails and URLs in logs.

**Weak spots a new feature must not repeat, and should ideally not depend on:**

1. **`cors()` with no options** (`app.ts:78`) — reflects any origin. The configured `ORIGIN`/`CREDENTIALS`
   call is commented out at `app.ts:77`. Combined with the `Authorization` **cookie**, only `sameSite:lax`
   stands between this and cross-site request forgery on state-changing POSTs.
2. **`POST /device/claimcode` is unauthenticated** (`device.route.ts:606, 634`). The device password is
   demanded **only** when `hardwareInfo.claimcode_auth === 'on'` (`device.service.ts:1097-1109`). For any
   device that has not reported that flag, knowing `device_id` is enough to mint a claim code and then
   `POST /device` it into your own account — silently taking it from its owner (`:1128`). Device ids are
   not secrets (they appear in URLs the webapp uses everywhere).
3. **`DELETE /device/logs/:device_id` skips the device check.** `device.controller.ts:443-451` calls the
   service directly with no `isUserDeviceMiddelware`; only `authMiddleware` guards the route
   (`device.route.ts:1170`). The service does filter by `owner_id` (`device.service.ts:752`), so it is not
   exploitable — but a non-owner gets a cheerful `200 {status:'ok'}` for a no-op, and an **admin cannot
   use it at all**. It is the one place the pattern was forgotten, which is exactly the failure mode of
   authorisation-as-a-helper-you-must-remember-to-call.
4. **`GET /readycheck` hard-codes `username: 'admin'`** (`index.controller.ts:18`) — false-negative
   readiness on any deployment with a different `ADMINUSER_USERNAME`.
5. **`user_id` has no unique index** (`users.model.ts:14-17`) — only `username` is unique. Nothing
   enforces distinct `user_id`s, and `PUT /users/:id` is broken anyway (`users.service.ts:80`).
6. **JWTs are stateless with no revocation list.** Logout only clears the cookie
   (`auth.controller.ts:132`); a captured `imageToken` is valid for **30 days**
   (`auth.service.ts:215`) and is deliberately URL-embeddable (`auth.middleware.ts:11, 28-30`).
   Changing a password does not invalidate anything.
7. **Alarm webhook fan-out is unbounded and un-sandboxed** (§7a) — no SSRF protection, so an alarm
   target of `http://169.254.169.254/…` or an internal host is delivered as written.
8. **`ENABLE_SELF_REGISTRATION` does not gate `/signup`** — it only gates *device* self-registration
   (`device.service.ts:920`). User signup is open whenever the server is reachable, throttled at 5/min/IP.
9. **Mongoose `set('debug', true)` outside production** (`app.ts:61-62`) logs every query.
10. **Serial numbers via `$max + 1`** (`device.service.ts:962-979, 1012-1022`) — racy under concurrency.
11. Test coverage is thin: `server/src/tests/` holds five files (auth, demo, image-auth,
    image-offline-overlay, index). **There is no test of `isUserDeviceMiddelware` for the write path**,
    and `auth.test.ts:16-18` still builds a `CreateUserDto` with an `email` field that the DTO no longer has.

---

## 9. Quick reference — files that matter most for anything new

| Concern | File |
|---|---|
| Who may touch a device | `server/src/middlewares/auth.middleware.ts` (lines 145-228) |
| Device document shape | `server/src/models/device.model.ts` + `shared-types/index.d.ts:156-181` |
| Shared contract with the webapp | `shared-types/index.d.ts` (278 lines, hand-maintained) |
| Everything device-related, server-side | `server/src/services/device.service.ts` (1743 lines — the god object) |
| Time-series read/write | `server/src/services/data.service.ts` |
| Diary/log storage | `server/src/models/devicelog.model.ts` + `device.service.ts:662-815` |
| Sharing | `server/src/models/share.model.ts`, `controllers/share.controller.ts`, `auth.middleware.ts:65-80` |
| Outbound integrations | `server/src/services/alarm.service.ts:194-283`, `server/src/utils/webhookTemplate.ts` |
| Demo redaction (copy this pattern for any new secret field) | `server/src/utils/demo.ts` |
| API docs | `server/src/utils/swagger.ts` + `@openapi` JSDoc blocks in every route file |
