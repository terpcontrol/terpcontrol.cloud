#include "wifi.h"
#include "lanscan.h"
#include "okamcam.h"

#include "settings.h"
#include <esp_task_wdt.h>

#include <WiFiClient.h>
#include <DNSServerAsync.h>
#include <WebServer.h>
#include <ESPmDNS.h>
#include "ESP32HTTPUpdateServer.h"
#include <Update.h>

#include <ArduinoJson.h>
#include <EEPROM.h>
#include <array>
#include <sstream>
#include <cctype>
#include <HTTPClient.h>

#include "fridgecloud.h"
#include "rebootwatchdog.h"

#include "html_compressed/index.html.h"

#define WIFI_SCAN_TIMEOUT 30000

static constexpr TickType_t SMART_SOCKET_RESEND_PERIOD = configTICK_RATE_HZ * 60;
static constexpr TickType_t SMART_SOCKET_MIN_SEND_INTERVAL = configTICK_RATE_HZ * 30;
static constexpr TickType_t SMART_SOCKET_FAILURE_BACKOFF = configTICK_RATE_HZ * 300;
static constexpr uint8_t SMART_SOCKET_FAILURES_BEFORE_BACKOFF = 3;

// A socket that keeps refusing commands has most likely been handed a different
// DHCP address. After this many failed commands it is looked up on the network
// again by its hardware id, instead of staying unreachable until somebody
// notices and pairs it a second time.
static constexpr uint8_t SMART_SOCKET_FAILURES_BEFORE_SEARCH = 10;
// Walking the subnet is not free, so one search covers every stale socket at
// once and no further search starts for a while afterwards.
static constexpr TickType_t SMART_SOCKET_SEARCH_COOLDOWN = configTICK_RATE_HZ * 900;
// Upper bound on the time one wifiTick() may spend commanding sockets. With a
// full table and an unreachable socket costing seconds, an exhaustive pass
// would starve the control loop.
static constexpr TickType_t SMART_SOCKET_TICK_BUDGET = configTICK_RATE_HZ * 2;
// Same idea for the pre-update flush, which runs in one go rather than per tick.
static constexpr TickType_t SMART_SOCKET_FLUSH_BUDGET = configTICK_RATE_HZ * 20;
// Sockets paired before this firmware carry no hardware id. Ask a reachable one
// for it now and then so it too can be found again after a DHCP change.
static constexpr TickType_t SMART_SOCKET_ID_PROBE_INTERVAL = configTICK_RATE_HZ * 600;
// A log message is serialised into a fixed 384 byte buffer, so every reported
// value has to stay well inside that. An address may be a 64 character
// hostname, which is what caps a socket_list chunk at three entries and bounds
// the role summary explicitly.
static constexpr size_t SOCKETS_PER_REPORT_CHUNK = 3;
static constexpr size_t MAX_REPORTED_VALUE_LEN = 288;


namespace fg {
  WifiApDash::WifiApDash(std::string ssid, std::string ip, std::function<void(void)> callback) :
    ssid(ssid), ip(ip), callback(callback) {}


  void WifiApDash::draw() {
    UserInterface::display.setTextColor(SSD1306_WHITE); // Draw white text
    UserInterface::display.setTextSize(1);

    std::stringstream value_print;
    value_print << "connect to:";
    UserInterface::display.setCursor(1, 1);
    UserInterface::display.write(value_print.str().c_str());

    value_print.str(std::string());
    value_print << "SSID: " << ssid;
    UserInterface::display.setCursor(1, 15);
    UserInterface::display.write(value_print.str().c_str());

    value_print.str(std::string());
    value_print << "IP:   " << ip;
    UserInterface::display.setCursor(1, 25);
    UserInterface::display.write(value_print.str().c_str());
  }

  void WifiApDash::prev() {}
  void WifiApDash::next() {}
  void WifiApDash::enter() {
    callback();
  }
  void WifiApDash::hold() {}

  WifiStaDash::WifiStaDash(std::string ssid, std::string ip, float rssi, std::function<void(void)> callback) :
    ssid(ssid), ip(ip), rssi(rssi), callback(callback) {}


  void WifiStaDash::draw() {
    UserInterface::display.setTextColor(SSD1306_WHITE); // Draw white text
    UserInterface::display.setTextSize(1);

    std::stringstream value_print;
    value_print << "current connection:";
    UserInterface::display.setCursor(1, 1);
    UserInterface::display.write(value_print.str().c_str());

    value_print.str(std::string());
    value_print << "SSID: " << ssid;
    UserInterface::display.setCursor(1, 15);
    UserInterface::display.write(value_print.str().c_str());

    value_print.str(std::string());
    value_print << "RSSI: " << rssi;
    UserInterface::display.setCursor(1, 25);
    UserInterface::display.write(value_print.str().c_str());

    value_print.str(std::string());
    value_print << "IP:   " << ip;
    UserInterface::display.setCursor(1, 35);
    UserInterface::display.write(value_print.str().c_str());
  }

  void WifiStaDash::prev() {}
  void WifiStaDash::next() {}
  void WifiStaDash::enter() {
    callback();
  }
  void WifiStaDash::hold() {}
}



#define GPIO_OUT_W1TS_REG (DR_REG_GPIO_BASE + 0x0008)
#define GPIO_OUT_W1TC_REG (DR_REG_GPIO_BASE + 0x000c)

#define DEFAULT_SSID_PREFIX "TERP_"
#define DEFAULT_HOSTNAME "terpcontrol"

static const std::array<std::string, 2> SMART_SOCKET_SSID_PREFIXES = {
  "cozylife-",
  "tasmota-",
};

// Terp Control Cam: the shipped unit is a VStarcam OEM ("O-KAM Pro"). In setup
// mode it broadcasts an open AP "@IPC-<n>" and exposes the VStarcam CGI API on
// TCP 81 at 192.168.168.1 (creds admin/888888). Provisioning mirrors
// provisionSmartSocket: join the AP, drive set_wifi.cgi to move it onto the home
// network, and remember its P2P device id (DID). Once on the home wifi the camera
// firewalls down to the proprietary P2P transport, so we key on the DID (not a
// LAN IP or RTSP url) — the server pulls stills over P2P. See
// docs/okam-webcam-reverse-engineering.md.
static const std::string TERP_CAM_SSID_PREFIX = "terpcam-";      // legacy placeholder
static const std::string OKAM_CAM_AP_PREFIX = "@IPC-";           // real VStarcam setup AP
static const char* OKAM_CAM_AP_BASE = "http://192.168.168.1:81"; // CGI server in AP mode
static const char* OKAM_CAM_AUTH = "loginuse=admin&loginpas=888888";
static const char* TERP_CAM_URL_NVS_KEY = "terpcam_url";         // legacy (RTSP url)
static const char* OKAM_CAM_DID_NVS_KEY = "webcam_did";          // VStarcam P2P device id
static const char* OKAM_CAM_IP_NVS_KEY = "webcam_ip";            // last address it answered on

std::string primary_ssid;
std::string primary_password;
std::string secondary_ssid;
std::string secondary_password;

bool loadWifiCredentials();
void saveWifiCredentials();
void InitalizeHTTPServer();
std::vector<std::string> scanWifiNetworks();
bool isHexSegment(const std::string& value, size_t expected_len);
bool isSmartSocketSsid(const std::string& value);
std::vector<std::string> scanSmartSocketSsids();
std::string smartSocketDisplayName(const std::string& ssid);
std::string sanitizeSettingString(const std::string& value);
std::string urlEncode(const std::string& value);
bool httpGet(const char* url, std::string* response = nullptr);
bool parseSmartSocketIp(const std::string& body, std::string& socket_ip);
void delayWithWatchdog(uint32_t delay_ms);
bool provisionSmartSocket(const std::string& socket_role, const std::string& home_ssid, const std::string& home_password, std::string& socket_ip, std::string& error_message, const std::function<void(const char*)>& progress_callback);
bool isSocketRoleConnected(const std::string& role);
static std::string legacySocketRoleKey(const std::string& role);
static std::string legacySocketUserKey(const std::string& role);
static std::string legacySocketPasswordKey(const std::string& role);
static std::string defaultSocketAuthQuery();
static std::string readSocketId(const std::string& ip, const std::string& auth_query);
static void ensureSmartSocketsLoaded();
static void persistSmartSockets();
static bool canStoreAnotherSocket();
const std::vector<std::string>& getSocketRolesList();
std::vector<std::string> getSocketRoleOptions();
static std::string connectedSocketRolesCsv();
static void reportSocketsHardwareInfo();
static bool isTerpCamSsid(const std::string& value);
static bool isKnownSocketRole(const std::string& role);
boolean createConfigurationAP();
bool connectToWifi(std::string ssid, std::string password);


void handleNotFound();
void handleRoot();
void handleGetScan();
String formatBytes(size_t bytes);
String toStringIp(IPAddress ip);
String GetEncryptionType(byte thisType);
boolean isIp(String str);
void handleConfig();
boolean captivePortal();



// DNS server
const byte DNS_PORT = 53;
DNSServer dnsServer;

// Web server
WebServer server(80);

/* Soft AP network parameters */
IPAddress apIP(172, 20, 0, 1);
IPAddress netMsk(255, 255, 255, 0);

std::string ssid = "";
std::string ip = "";
std::string netmask = "";

unsigned long currentMillis = 0;
unsigned long startMillis;

/** Current WLAN status */
short status = WL_IDLE_STATUS;
bool server_active = false;

bool wifi_configured = false;

// One paired smart socket. Any number of them may share a role: every socket
// of a role is driven with the same target state, so a grow with four heaters
// on four sockets needs no extra roles.
struct SmartSocket {
  std::string role;
  std::string id;        // Tasmota MAC (uppercase hex); empty until learned
  std::string ip;
  std::string user;      // empty -> default admin
  std::string password;  // empty -> default (provisioning mqtt password)

  bool initialized = false;
  bool last_target = false;
  bool id_probed = false;
  TickType_t last_send_tick = 0;
  TickType_t disabled_until_tick = 0;
  TickType_t id_probe_tick = 0;
  uint8_t consecutive_failures = 0;   // drives the send backoff
  uint8_t failures_since_seen = 0;    // drives the network search
};

static std::vector<SmartSocket> smart_sockets;
static bool smart_sockets_loaded = false;
static SmartSocketOutputStates smart_socket_output_states;
static bool smart_socket_outputs_reported = false;
static fg::Fridgecloud* smart_socket_cloud_handle = nullptr;

static fg::LanScan socket_search;
static TickType_t socket_search_allowed_tick = 0;
static bool socket_search_changed = false;

static TickType_t socketRoleMinSendInterval(const std::string& role);
static std::string socketAuthQuery(const SmartSocket& socket);
static bool sendSocketPower(const SmartSocket& socket, bool turn_on);
static void noteSocketCommandSent(SmartSocket& socket);
static void syncSmartSockets();
static void tickAuxDeviceSearch();
static std::vector<std::string> socketAuthQueries();
static bool applyDiscoveredSocketHost(const fg::LanScan::Host& host);
static void finishSocketSearch(unsigned matched);
static std::string smartSocketLabel(size_t index);

bool initializeWifi() {
  WiFi.persistent(false);
  WiFi.disconnect();
  WiFi.setAutoReconnect(true);
  WiFi.setAutoConnect(true);

  //handleRoot();

  WiFi.setHostname(DEFAULT_HOSTNAME); // Set the DHCP hostname assigned to ESP station.

  if (loadWifiCredentials()) // Load WLAN credentials for WiFi Settings
  {
    Serial.println(F("Valid Credentials found."));
    wifi_configured = true;
    WiFi.mode(WIFI_STA);

    Serial.println(primary_ssid.c_str());

    if(connectToWifi(primary_ssid, primary_password)) {
      return true;
    }
  }
  else {
    Serial.println(F("NO Valid Credentials found."));
  }
  return true;
}

void wifiTick() {
  static TickType_t last_conncheck = xTaskGetTickCount();
  static TickType_t last_reconnect_attempt = 0;

  if(server_active) {
    server.handleClient();
  }

  if(wifi_configured && xTaskGetTickCount() - last_conncheck > 30000) {
    last_conncheck = xTaskGetTickCount();
    if(!wifiIsConnected()) {
      Serial.printf("[wifi] disconnected, status=%d\n", WiFi.status());
      WiFi.mode(WIFI_STA);
      WiFi.setAutoReconnect(true);
      WiFi.reconnect();
      last_reconnect_attempt = xTaskGetTickCount();
    }
    else if(last_reconnect_attempt > 0) {
      Serial.println("[wifi] reconnected");
      last_reconnect_attempt = 0;
    }
  }

  // If the SDK auto-reconnect has not recovered after a while, restart the
  // station interface and issue a fresh begin().  Keep this path infrequent:
  // WiFi.begin() is blocking-ish and can starve other loop work if spammed.
  if(wifi_configured && !wifiIsConnected() && last_reconnect_attempt > 0 &&
     xTaskGetTickCount() - last_reconnect_attempt > 120000) {
    Serial.println("[wifi] reconnect timeout, restarting STA");
    WiFi.disconnect(false, false);
    WiFi.mode(WIFI_OFF);
    delay(100);
    WiFi.mode(WIFI_STA);
    WiFi.setAutoReconnect(true);
    WiFi.setAutoConnect(true);
    if(primary_password != "") {
      WiFi.begin(primary_ssid.c_str(), primary_password.c_str());
    }
    else {
      WiFi.begin(primary_ssid.c_str());
    }
    last_reconnect_attempt = xTaskGetTickCount();
  }

  if(smart_socket_outputs_reported) {
    syncSmartSockets();
  }

  tickAuxDeviceSearch();
}

void wifiReportSmartSocketOutputs(const SmartSocketOutputStates& states) {
  smart_socket_output_states = states;
  smart_socket_outputs_reported = true;
}

void wifiForceAllSmartSocketsOff() {
  // Called synchronously when a firmware update starts. The OTA download
  // blocks the single loop task until reboot, so wifiTick() will not run
  // again to flush the cached state via syncSmartSocketRole(). We therefore
  // push the OFF command to every socket right here, bypassing the rate
  // limiter / resend throttle. The cached state and per-role sync state are
  // also marked OFF so control resumes consistently if the update aborts
  // (updateFirmwareFromUrl returns without rebooting on failure).
  SmartSocketOutputStates off;  // all fields default to false
  smart_socket_output_states = off;
  smart_socket_outputs_reported = true;

  // Bounded like the regular control pass: a table full of unreachable sockets
  // would otherwise hold the update up for minutes. Whatever is not reached
  // here still switches itself off — every socket is provisioned with a
  // PulseTime watchdog that expires once our resends stop.
  const TickType_t deadline = xTaskGetTickCount() + SMART_SOCKET_FLUSH_BUDGET;
  for(auto& socket : smart_sockets) {
    esp_task_wdt_reset();
    sendSocketPower(socket, false);
    socket.last_target = false;
    socket.last_send_tick = xTaskGetTickCount();
    socket.initialized = true;
    socket.consecutive_failures = 0;
    socket.disabled_until_tick = 0;
    // Sockets past the budget keep their previous sync state on purpose: an
    // aborted update then still sees a state change (or a resend) for them,
    // instead of a cached OFF that matches a socket which is really still on.
    if((int32_t)(deadline - xTaskGetTickCount()) <= 0) {
      break;
    }
  }
  esp_task_wdt_reset();
}

// Learns a socket's hardware id from the socket itself. Anything paired before
// this firmware, and anything added by address from the cloud, starts without
// one — and without an id a socket cannot be found again once its address
// changes, so it is worth an occasional extra request.
static void ensureSocketId(SmartSocket& socket) {
  const TickType_t now = xTaskGetTickCount();
  if(!socket.id.empty()) {
    return;
  }
  if(socket.id_probed && (now - socket.id_probe_tick) < SMART_SOCKET_ID_PROBE_INTERVAL) {
    return;
  }
  socket.id_probed = true;
  socket.id_probe_tick = now;

  const std::string id = readSocketId(socket.ip, socketAuthQuery(socket));
  if(id.empty()) {
    return;
  }
  socket.id = id;
  persistSmartSockets();
  reportSocketsHardwareInfo();
}

static void syncSmartSocket(SmartSocket& socket, bool target_on) {
  const TickType_t now = xTaskGetTickCount();
  const bool state_changed = !socket.initialized || socket.last_target != target_on;
  const bool periodic_resend = socket.initialized && (now - socket.last_send_tick >= SMART_SOCKET_RESEND_PERIOD);

  // Tick comparisons are signed differences throughout: xTaskGetTickCount()
  // wraps every ~49 days, and comparing absolute values would leave a socket
  // backed off for weeks across the wrap.
  if((int32_t)(socket.disabled_until_tick - now) > 0) {
    return;
  }

  if(!state_changed && !periodic_resend) {
    return;
  }

  // Do not hammer HTTP smart sockets when an output oscillates around its
  // threshold (notably PID heater output >0 / ==0). During a bad uplink this
  // quickly exhausts LWIP sockets/buffers and shows up as errno 11 / socket
  // 105, followed by a LoadProhibited panic in WiFiClient/HTTPClient.
  if(socket.initialized && (now - socket.last_send_tick < socketRoleMinSendInterval(socket.role))) {
    return;
  }

  const bool ok = sendSocketPower(socket, target_on);
  if(ok) {
    socket.consecutive_failures = 0;
    socket.failures_since_seen = 0;
    ensureSocketId(socket);
  }
  else {
    if(socket.consecutive_failures < 255) {
      ++socket.consecutive_failures;
    }
    if(socket.failures_since_seen < 255) {
      ++socket.failures_since_seen;
    }
    if(smart_socket_cloud_handle != nullptr) {
      std::string message = std::string("message-smart-socket-cmd-failed:") + socket.role + ":" + (target_on ? "on" : "off");
      smart_socket_cloud_handle->log(message, 1);
    }
    if(socket.consecutive_failures >= SMART_SOCKET_FAILURES_BEFORE_BACKOFF) {
      Serial.printf("[smart-socket] backing off role=%s ip=%s failures=%u\n",
                    socket.role.c_str(), socket.ip.c_str(), (unsigned)socket.consecutive_failures);
      socket.disabled_until_tick = now + SMART_SOCKET_FAILURE_BACKOFF;
      socket.consecutive_failures = 0;
    }
  }
  socket.last_target = target_on;
  socket.last_send_tick = now;
  socket.initialized = true;
}

static bool socketTargetForRole(const std::string& role) {
  if(role == "dehumidifier") return smart_socket_output_states.dehumidifier_on;
  if(role == "heater") return smart_socket_output_states.heater_on;
  if(role == "light") return smart_socket_output_states.light_on;
  if(role == "secondary_light") return smart_socket_output_states.secondary_light_on;
  if(role == "co2") return smart_socket_output_states.co2_on;
  return false;
}

static void syncSmartSockets() {
  static size_t resend_cursor = 0;

  if(smart_sockets.empty()) {
    return;
  }

  // Every socket here is an HTTP request to a possibly-unreachable device, and
  // an unreachable one costs seconds. Bound the pass and feed the WDT between
  // sockets, so a table full of timeouts can neither starve the control loop
  // nor panic the task watchdog.
  const TickType_t deadline = xTaskGetTickCount() + SMART_SOCKET_TICK_BUDGET;

  // Changed targets first. The CO2 valve is opened and closed again within a
  // couple of seconds, and a plain round-robin over a full table would stretch
  // that pulse well past its intended length.
  for(auto& socket : smart_sockets) {
    const bool target = socketTargetForRole(socket.role);
    if(socket.initialized && socket.last_target == target) {
      continue;
    }
    esp_task_wdt_reset();
    syncSmartSocket(socket, target);
    esp_task_wdt_reset();
    if((int32_t)(deadline - xTaskGetTickCount()) <= 0) {
      return;
    }
  }

  // Then the periodic resend, round-robin so that running out of budget always
  // leaves a different part of the table for the next pass.
  for(size_t i = 0; i < smart_sockets.size(); ++i) {
    if(resend_cursor >= smart_sockets.size()) {
      resend_cursor = 0;
    }
    SmartSocket& socket = smart_sockets[resend_cursor++];
    esp_task_wdt_reset();
    syncSmartSocket(socket, socketTargetForRole(socket.role));
    esp_task_wdt_reset();
    if((int32_t)(deadline - xTaskGetTickCount()) <= 0) {
      return;
    }
  }
}

float rssi = 0;

std::string ui_ssid;
std::string ui_password;
fg::UserInterface* ui_handle;
std::vector<std::string> scanned_ssids;
std::vector<std::string> scanned_smart_socket_ssids;
std::string custom_mqtt_server;
std::string custom_mqtt_user;
std::string custom_mqtt_port;
std::string custom_mqtt_pass;
std::string custom_mqtt_id;
uint8_t custom_mqtt_enabled;

// Tasmota PulseTime watchdog value per role. Values follow the Tasmota
// encoding: 1..111 = 0.1s steps, 112..64900 = (value - 100) seconds.
// The controller resends Power commands every ~60s, so the timeout has to
// outlive normal operation but expire quickly enough to avoid damage when
// the controller drops off the network. Each Power command restarts the
// timer (per Tasmota docs).
uint16_t socketRolePulseTimeValue(const std::string& role) {
  if(role == "heater") return 400;            // 300s
  if(role == "dehumidifier") return 700;      // 600s
  if(role == "co2") return 220;               // 120s
  if(role == "light") return 1900;            // 1800s
  if(role == "secondary_light") return 1900;  // 1800s
  return 400;                                 // 300s default
}

// Minimum interval between two HTTP commands for a role. The 30s default
// throttles outputs that oscillate around their threshold (e.g. the heater
// PID) to avoid exhausting LWIP sockets. CO2 is exempt: it fires at most one
// ON+OFF pair per ~120s injection window, so it needs a short interval to
// deliver its ~2s valve pulse (the OFF must follow the ON within seconds).
static TickType_t socketRoleMinSendInterval(const std::string& role) {
  if(role == "co2") return configTICK_RATE_HZ * 1;  // 1s
  return SMART_SOCKET_MIN_SEND_INTERVAL;            // 30s
}

static std::string defaultSocketAuthQuery() {
  // The default auth segment is constant for the lifetime of the device — the
  // MQTT password is set at provisioning and never rotates. Cache its
  // URL-encoded form on first valid use.
  static std::string cached_auth_query;
  if(cached_auth_query.empty()) {
    std::string mqtt_password = sanitizeSettingString(fg::settings().getStr("mqtt_pass"));
    if(mqtt_password.empty()) {
      fg::SettingsManager provisioning(NVS_PART, "fg_provisioning");
      mqtt_password = sanitizeSettingString(provisioning.getStr("mqtt_password"));
    }
    if(!mqtt_password.empty()) {
      cached_auth_query = "user=admin&password=" + urlEncode(mqtt_password) + "&";
    }
  }
  return cached_auth_query;
}

// Per-socket auth. Foreign sockets (added by address from the cloud) carry
// their own credentials; everything paired through the AP flow uses the default
// admin/mqtt_pass set during provisioning.
static std::string socketAuthQuery(const SmartSocket& socket) {
  if(socket.password.empty()) {
    return defaultSocketAuthQuery();
  }
  return "user=" + urlEncode(socket.user.empty() ? "admin" : socket.user) + "&password=" + urlEncode(socket.password) + "&";
}

// The distinct credential sets in use, for a network search that has to try
// them against unknown hosts.
static std::vector<std::string> socketAuthQueries() {
  std::vector<std::string> queries;
  const std::string fallback = defaultSocketAuthQuery();
  if(!fallback.empty()) {
    queries.push_back(fallback);
  }
  for(const auto& socket : smart_sockets) {
    const std::string query = socketAuthQuery(socket);
    if(!query.empty()) {
      queries.push_back(query);
    }
  }
  return queries;
}

static bool sendSocketPower(const SmartSocket& socket, bool turn_on) {
  const std::string auth_query = socketAuthQuery(socket);
  if(socket.ip.empty() || auth_query.empty()) {
    return false;
  }

  // Big enough for the whole request: a socket's own credentials are up to 48
  // characters each, and url-encoding can triple that.
  char url[512];
  snprintf(url, sizeof(url), "http://%s/cm?%scmnd=%s",
           socket.ip.c_str(),
           auth_query.c_str(),
           turn_on ? "Power%20On" : "Power%20Off");
  return httpGet(url);
}

// Tasmota reports its MAC in `Status 5`; that is what a socket is recognised by
// once its address has changed.
static std::string readSocketId(const std::string& ip, const std::string& auth_query) {
  if(ip.empty() || auth_query.empty()) {
    return std::string();
  }

  char url[512];
  snprintf(url, sizeof(url), "http://%s/cm?%scmnd=Status%%205", ip.c_str(), auth_query.c_str());
  std::string body;
  if(!httpGet(url, &body)) {
    return std::string();
  }

  const auto mac = body.find("\"Mac\":\"");
  if(mac == std::string::npos) {
    return std::string();
  }
  return fg::socketIdFromMac(body.c_str() + mac + 7);
}

bool sendSmartSocketPower(const std::string& role, bool turn_on) {
  bool ok = true;
  for(const auto& socket : smart_sockets) {
    if(socket.role != role) {
      continue;
    }
    esp_task_wdt_reset();
    ok = sendSocketPower(socket, turn_on) && ok;
  }
  return ok;
}

// A socket that was just commanded by hand is in a known state and its backoff
// is stale. `last_target` deliberately stays untouched, so the control loop
// still sees a pending change and re-asserts what it actually wants.
static void noteSocketCommandSent(SmartSocket& socket) {
  socket.last_send_tick = xTaskGetTickCount();
  socket.initialized = true;
  socket.consecutive_failures = 0;
  socket.failures_since_seen = 0;
  socket.disabled_until_tick = 0;
}

// "3 slight 34CD": position, short role and the tail of the hardware id — two
// sockets sharing a role have to stay apart on a 21-character display.
static std::string smartSocketLabel(size_t index) {
  const SmartSocket& socket = smart_sockets[index];
  std::string label = std::to_string(index + 1) + " ";

  if(socket.role == "dehumidifier") label += "dehum";
  else if(socket.role == "secondary_light") label += "slight";
  else if(socket.role == "heater") label += "heat";
  else label += socket.role;

  if(socket.id.size() >= 4) {
    label += " " + socket.id.substr(socket.id.size() - 4);
  }
  return label;
}

static void showSmartSocketTestSelection(unsigned preselected_index) {
  if(smart_sockets.empty()) {
    ui_handle->push<fg::TextDisplay>("no socket paired", 1, []() {
      ui_handle->pop();
    });
    return;
  }

  std::vector<std::string> options;
  options.push_back("back");
  for(size_t i = 0; i < smart_sockets.size(); ++i) {
    options.push_back(smartSocketLabel(i));
  }

  if(preselected_index >= options.size()) {
    preselected_index = 0;
  }

  ui_handle->push<fg::SelectInput>("test socket", preselected_index, options, [](unsigned selected) {
    ui_handle->pop();

    if(selected == 0 || selected > smart_sockets.size()) {
      return;
    }

    const size_t socket_index = selected - 1;
    const unsigned index_for_return = selected;

    std::vector<std::string> actions = {"back", "turn on", "turn off"};
    ui_handle->push<fg::SelectInput>(smartSocketLabel(socket_index), 0, actions, [socket_index, index_for_return](unsigned action_selected) {
      ui_handle->pop();

      if(action_selected == 0) {
        showSmartSocketTestSelection(index_for_return);
        return;
      }

      bool ok = false;
      if(socket_index < smart_sockets.size()) {
        ok = sendSocketPower(smart_sockets[socket_index], action_selected == 1);
        if(ok) {
          noteSocketCommandSent(smart_sockets[socket_index]);
        }
      }

      ui_handle->push<fg::TextDisplay>(ok ? "command sent" : "command failed", 1, [index_for_return]() {
        ui_handle->pop();
        showSmartSocketTestSelection(index_for_return);
      });
    });
  });
}

// Manual counterpart to the background search. It blocks for as long as the
// sweep takes, which is why the background one waits for an idle display
// instead: somebody standing in this menu has asked for it and is watching,
// and the pairing flow above already blocks for longer than this.
static void runSocketSearchNow() {
  if(!wifiIsConnected()) {
    ui_handle->push<fg::TextDisplay>("no wifi", 1, []() { ui_handle->pop(); });
    return;
  }
  if(smart_sockets.empty()) {
    ui_handle->push<fg::TextDisplay>("no socket paired", 1, []() { ui_handle->pop(); });
    return;
  }

  socket_search.stop();
  if(!socket_search.start(socketAuthQueries())) {
    ui_handle->push<fg::TextDisplay>("search failed", 1, []() { ui_handle->pop(); });
    return;
  }

  ui_handle->push<fg::TextDisplay>("searching...");
  ui_handle->loop();

  unsigned matched = 0;
  socket_search_changed = false;
  while(!socket_search.tick([&matched](const fg::LanScan::Host& host) {
    matched += applyDiscoveredSocketHost(host) ? 1 : 0;
  })) {
    esp_task_wdt_reset();
  }
  finishSocketSearch(matched);

  ui_handle->pop();
  char message[32];
  snprintf(message, sizeof(message), "%u of %u found", matched, (unsigned)smart_sockets.size());
  ui_handle->push<fg::TextDisplay>(message, 1, []() {
    ui_handle->pop();
  });
}

static void runConnectSocketFlow() {
  if(!canStoreAnotherSocket()) {
    ui_handle->push<fg::TextDisplay>("socket limit\nreached", 1, []() {
      ui_handle->pop();
    });
    return;
  }

  ui_handle->push<fg::TextDisplay>("scanning...");
  ui_handle->loop();

  scanned_smart_socket_ssids = scanSmartSocketSsids();
  std::vector<std::string> socket_options;
  socket_options.reserve(scanned_smart_socket_ssids.size() + 1);
  socket_options.push_back("back");
  for(const auto& socket_ssid : scanned_smart_socket_ssids) {
    socket_options.push_back(smartSocketDisplayName(socket_ssid));
  }

  ui_handle->pop();

  if(scanned_smart_socket_ssids.empty()) {
    ui_handle->push<fg::TextDisplay>("no smart socket found", 1, []() {
      ui_handle->pop();
    });
    return;
  }

  ui_handle->push<fg::SelectInput>("select socket", 0, socket_options, [=](unsigned selected) {
    ui_handle->pop();

    if(selected == 0) {
      return;
    }

    std::string socket_ssid = scanned_smart_socket_ssids[selected - 1];
    if(!isSmartSocketSsid(socket_ssid)) {
      ui_handle->push<fg::TextDisplay>("invalid socket", 1, []() {
        ui_handle->pop();
      });
      return;
    }

    std::vector<std::string> role_options = getSocketRoleOptions();
    ui_handle->push<fg::SelectInput>("select role", 0, role_options, [=](unsigned role_selected) {
      ui_handle->pop();

      if(role_selected == 0) {
        return;
      }

      const std::vector<std::string>& roles = getSocketRolesList();
      std::string socket_role = roles[role_selected];

      ui_handle->push<fg::TextDisplay>("connecting...");
      ui_handle->loop();

      const std::string home_ssid = primary_ssid;
      const std::string home_password = primary_password;

      if(connectToWifi(socket_ssid, "")) {
        ui_handle->pop();
        ui_handle->push<fg::TextDisplay>("connected");
        ui_handle->loop();

        std::string socket_ip;
        std::string error_message;
        auto update_status = [](const char* message) {
          ui_handle->pop();
          ui_handle->push<fg::TextDisplay>(message);
          ui_handle->loop();
        };

        bool provisioned = provisionSmartSocket(socket_role, home_ssid, home_password, socket_ip, error_message, update_status);

        ui_handle->pop();
        if(provisioned) {
          ui_handle->push<fg::TextDisplay>("socket ready", 1, [socket_ip]() {
            Serial.print("smart socket ready: ");
            Serial.println(socket_ip.c_str());
            ui_handle->pop();
          });
        }
        else {
          ui_handle->push<fg::TextDisplay>(error_message.c_str(), 1, []() {
            ui_handle->pop();
          });
        }
      }
      else {
        ui_handle->pop();
        ui_handle->push<fg::TextDisplay>("conn failed", 1, []() {
          ui_handle->pop();
        });
      }
    });
  });
}

void showSmartSocketsUi(fg::UserInterface* ui, fg::Fridgecloud* cloud) {
  using namespace fg;
  ui_handle = ui;
  smart_socket_cloud_handle = cloud;
  ensureSmartSocketsLoaded();

  auto menu = ui->push<SelectMenu>();
  menu->addOption("back...", [ui]() { ui->pop(); });

  menu->addOption("test socket", []() {
    showSmartSocketTestSelection(0);
  });

  menu->addOption("connect socket", []() {
    if(!wifi_configured) {
      ui_handle->push<TextDisplay>("wifi not configured", 1, []() {
        ui_handle->pop();
      });
      return;
    }
    runConnectSocketFlow();
  });

  menu->addOption("find sockets", []() {
    runSocketSearchNow();
  });

  menu->addOption("disconnect", []() {
    if(smart_sockets.empty()) {
      ui_handle->push<TextDisplay>("no socket paired", 1, []() {
        ui_handle->pop();
      });
      return;
    }

    std::vector<std::string> disconnect_options;
    disconnect_options.push_back("back");
    for(size_t i = 0; i < smart_sockets.size(); ++i) {
      disconnect_options.push_back(smartSocketLabel(i));
    }

    ui_handle->push<SelectInput>("disconnect socket", 0, disconnect_options, [](unsigned selected) {
      ui_handle->pop();

      if(selected == 0 || selected > smart_sockets.size()) {
        return;
      }

      wifiRemoveSmartSocket(smart_sockets[selected - 1].role, (int)(selected - 1));

      ui_handle->push<TextDisplay>("socket disconnected", 1, []() {
        ui_handle->pop();
      });
    });
  });
}

static bool isTerpCamSsid(const std::string& value) {
  if(value.rfind(TERP_CAM_SSID_PREFIX, 0) != 0) {
    return false;
  }

  // Same "<6 hex>-<4 hex>" suffix convention as the smart sockets.
  std::string suffix = value.substr(TERP_CAM_SSID_PREFIX.size());
  auto divider_pos = suffix.find('-');
  if(divider_pos == std::string::npos || suffix.find('-', divider_pos + 1) != std::string::npos) {
    return false;
  }

  return isHexSegment(suffix.substr(0, divider_pos), 6) && isHexSegment(suffix.substr(divider_pos + 1), 4);
}

// The real camera advertises the VStarcam setup AP "@IPC-<n>".
static bool isOkamCamSsid(const std::string& value) {
  return value.rfind(OKAM_CAM_AP_PREFIX, 0) == 0;
}

// Pull `var <name>="value";` out of a VStarcam CGI response.
static std::string parseCamVar(const std::string& body, const char* name) {
  std::string needle = std::string("var ") + name + "=";
  auto pos = body.find(needle);
  if(pos == std::string::npos) {
    return "";
  }
  pos += needle.size();
  // value is either "quoted" or a bare token terminated by ';'
  if(pos < body.size() && body[pos] == '"') {
    auto end = body.find('"', pos + 1);
    if(end == std::string::npos) return "";
    return body.substr(pos + 1, end - pos - 1);
  }
  auto end = body.find(';', pos);
  return body.substr(pos, end == std::string::npos ? std::string::npos : end - pos);
}

// From get_wifi_scan_result.cgi, find the WPA authtype (ap_security) advertised
// for `ssid`. VStarcam's set_wifi.cgi authtype uses the same table as the scan's
// ap_security (4 = WPA2/AES). Returns 4 (the common case) when not found.
static int parseCamWifiAuthtype(const std::string& body, const std::string& ssid) {
  std::string needle = std::string("=\"") + ssid + "\"";
  size_t pos = 0;
  while((pos = body.find(needle, pos)) != std::string::npos) {
    // walk back to the ap_ssid[<idx>] token that owns this match
    auto lb = body.rfind('[', pos);
    auto rb = body.find(']', lb == std::string::npos ? 0 : lb);
    if(lb != std::string::npos && rb != std::string::npos && rb > lb) {
      std::string idx = body.substr(lb + 1, rb - lb - 1);
      std::string sec_key = "ap_security[" + idx + "]=";
      auto sp = body.find(sec_key);
      if(sp != std::string::npos) {
        sp += sec_key.size();
        return atoi(body.c_str() + sp);
      }
    }
    pos += needle.size();
  }
  return 4;
}

// Provision the O-KAM/VStarcam camera onto the home wifi (caller must already be
// joined to the camera AP). Reads the camera's P2P DID, drives set_wifi.cgi, then
// returns to the home network. Mirrors provisionSmartSocket. On success `did` holds
// the camera's realdeviceid, which the server uses to reach it over P2P.
bool provisionOkamCam(const std::string& home_ssid, const std::string& home_password,
                      std::string& did, std::string& error_message,
                      const std::function<void(const char*)>& progress_callback) {
  auto emit_status = [&](const char* message) {
    Serial.println(message);
    if(progress_callback) progress_callback(message);
  };

  const std::string home_ssid_clean = sanitizeSettingString(home_ssid);
  const std::string home_password_clean = sanitizeSettingString(home_password);

  bool reconnected_to_home = false;
  auto reconnect_home = [&]() {
    if(reconnected_to_home) return true;
    emit_status("reconnect wifi");
    if(!connectToWifi(home_ssid_clean, home_password_clean)) return false;
    reconnected_to_home = true;
    return true;
  };
  auto fail_with_reconnect = [&](const char* message) {
    error_message = message;
    if(!reconnect_home()) error_message = "reconnect fail";
    return false;
  };

  emit_status("read cam id...");
  delayWithWatchdog(1500);
  std::string status_body;
  std::string status_url = std::string(OKAM_CAM_AP_BASE) + "/get_status.cgi?" + OKAM_CAM_AUTH;
  if(!httpGet(status_url.c_str(), &status_body)) {
    return fail_with_reconnect("cam not reachable");
  }
  did = sanitizeSettingString(parseCamVar(status_body, "realdeviceid"));
  if(did.empty()) {
    did = sanitizeSettingString(parseCamVar(status_body, "deviceid"));
  }
  if(did.empty()) {
    return fail_with_reconnect("cam id fail");
  }

  emit_status("scan cam wifi...");
  std::string scan_url = std::string(OKAM_CAM_AP_BASE) + "/wifi_scan.cgi?" + OKAM_CAM_AUTH;
  httpGet(scan_url.c_str());
  delayWithWatchdog(3000);
  std::string scan_body;
  std::string scan_result_url = std::string(OKAM_CAM_AP_BASE) + "/get_wifi_scan_result.cgi?" + OKAM_CAM_AUTH;
  httpGet(scan_result_url.c_str(), &scan_body);
  int authtype = parseCamWifiAuthtype(scan_body, home_ssid_clean);

  emit_status("join home wifi...");
  // set_wifi.cgi applies immediately and drops the AP, so this GET usually times
  // out — that is the success signal, not a failure. The PSK param is wpa_psk
  // (underscore); the WPA mode goes in authtype (encrypt is WEP-only).
  std::string set_url = std::string(OKAM_CAM_AP_BASE) + "/set_wifi.cgi?" + OKAM_CAM_AUTH
                      + "&enable=1&ssid=" + urlEncode(home_ssid_clean)
                      + "&channel=0&mode=0&authtype=" + std::to_string(authtype)
                      + "&encrypt=0&keyformat=0&defkey=0"
                      + "&key1=&key1_bits=0&key2=&key2_bits=0&key3=&key3_bits=0&key4=&key4_bits=0"
                      + "&wpa_psk=" + urlEncode(home_password_clean);
  httpGet(set_url.c_str());   // return value ignored: the AP drops before replying

  if(!reconnect_home()) {
    error_message = "reconnect fail";
    return false;
  }

  fg::settings().setStr(OKAM_CAM_DID_NVS_KEY, did.c_str());
  fg::settings().commit();
  if(smart_socket_cloud_handle != nullptr) {
    smart_socket_cloud_handle->log("message-terp-cam-connected", 0);
    smart_socket_cloud_handle->log(std::string("hardware-info:webcam_did=") + did, 0);
  }

  emit_status("cam configured");
  delayWithWatchdog(1500);
  return true;
}

void showTerpCamUi(fg::UserInterface* ui, fg::Fridgecloud* cloud) {
  using namespace fg;
  ui_handle = ui;
  smart_socket_cloud_handle = cloud;

  auto menu = ui->push<SelectMenu>();
  menu->addOption("back...", [ui]() { ui->pop(); });

  menu->addOption("connect cam", []() {
    if(!wifi_configured) {
      ui_handle->push<TextDisplay>("wifi not configured", 1, []() {
        ui_handle->pop();
      });
      return;
    }

    // Only one camera per module: refuse to provision a second one while a
    // camera is still connected (the user must disconnect it first).
    if(!sanitizeSettingString(fg::settings().getStr(OKAM_CAM_DID_NVS_KEY)).empty()) {
      ui_handle->push<TextDisplay>("cam already\nconnected -\ndisconnect first", 1, []() {
        ui_handle->pop();
      });
      return;
    }

    ui_handle->push<TextDisplay>("scanning...");
    ui_handle->loop();

    std::vector<std::string> all_ssids = scanWifiNetworks();
    std::string cam_ssid;
    for(const auto& network_ssid : all_ssids) {
      if(isOkamCamSsid(network_ssid) || isTerpCamSsid(network_ssid)) {
        cam_ssid = network_ssid;
        break;
      }
    }

    ui_handle->pop();
    if(cam_ssid.empty()) {
      ui_handle->push<TextDisplay>("no cam found", 1, []() {
        ui_handle->pop();
      });
      return;
    }

    ui_handle->push<TextDisplay>("connecting...");
    ui_handle->loop();

    const std::string home_ssid = primary_ssid;
    const std::string home_password = primary_password;

    // Join the camera's open AP, provision it onto the home wifi, remember the DID.
    if(!connectToWifi(cam_ssid, "")) {
      ui_handle->pop();
      ui_handle->push<TextDisplay>("conn failed", 1, []() { ui_handle->pop(); });
      return;
    }

    ui_handle->pop();
    ui_handle->push<TextDisplay>("connected");
    ui_handle->loop();

    std::string did;
    std::string error_message;
    auto update_status = [](const char* message) {
      ui_handle->pop();
      ui_handle->push<TextDisplay>(message);
      ui_handle->loop();
    };

    bool provisioned = provisionOkamCam(home_ssid, home_password, did, error_message, update_status);

    ui_handle->pop();
    if(provisioned) {
      ui_handle->push<TextDisplay>("cam ready", 1, [did]() {
        Serial.print("terp cam ready: ");
        Serial.println(did.c_str());
        ui_handle->pop();
      });
    }
    else {
      ui_handle->push<TextDisplay>(error_message.c_str(), 1, []() {
        ui_handle->pop();
      });
    }
  });

  menu->addOption("disconnect cam", []() {
    if(sanitizeSettingString(fg::settings().getStr(OKAM_CAM_DID_NVS_KEY)).empty()) {
      ui_handle->push<TextDisplay>("no cam connected", 1, []() {
        ui_handle->pop();
      });
      return;
    }

    // Disconnecting loses the camera pairing (it has to be re-provisioned from
    // its AP), so confirm first — same idiom as the "sockets will be cleared" flow.
    std::vector<std::string> confirm_options = {"cancel", "disconnect"};
    ui_handle->push<fg::SelectInput>("disconnect cam?", 0, confirm_options, [](unsigned selected) {
      ui_handle->pop();
      if(selected == 0) {
        return;
      }

      // Factory-reset the camera so it drops back to its `@IPC-<n>` setup AP and
      // can be paired again. Without this it stays joined to a network it is no
      // longer paired with, and the only way back is the physical reset button.
      //
      // Best effort on purpose: a camera that is powered off or out of range
      // must not make disconnecting impossible, so the module forgets it either
      // way. The reset is also what makes the *next* pairing work — after it the
      // camera answers `loginpas=888888` again.
      ui_handle->push<TextDisplay>("resetting cam...", 0, [](){});
      const bool reset_ok = fg::okamCamFactoryReset(smart_socket_cloud_handle);
      ui_handle->pop();

      fg::settings().erase(OKAM_CAM_DID_NVS_KEY);
      fg::settings().erase(OKAM_CAM_IP_NVS_KEY);    // and where it used to answer
      fg::settings().erase(TERP_CAM_URL_NVS_KEY);   // clear legacy slot too
      fg::settings().commit();

      if(smart_socket_cloud_handle != nullptr) {
        // Both slots are erased above, so report both as cleared — otherwise a
        // device that once had the legacy RTSP url keeps advertising it.
        smart_socket_cloud_handle->log("hardware-info:webcam_did=none", 0);
        smart_socket_cloud_handle->log("hardware-info:webcam_url=none", 0);
      }

      ui_handle->push<TextDisplay>(reset_ok ? "cam disconnected\nand reset"
                                            : "cam disconnected\ncam did not\nanswer - reset\nit by hand",
                                   1, []() {
        ui_handle->pop();
      });
    });
  });

  menu->addOption("show id", []() {
    std::string did = sanitizeSettingString(fg::settings().getStr(OKAM_CAM_DID_NVS_KEY));
    if(did.empty()) {
      did = "none";
    }
    ui_handle->push<TextDisplay>(did.c_str(), 1, []() {
      ui_handle->pop();
    });
  });
}

void showWifiUi(fg::UserInterface* ui, fg::Fridgecloud* cloud) {
  using namespace fg;

  ui_handle = ui;

  auto menu = ui->push<SelectMenu>();

  menu->addOption("back...", [ui](){ ui->pop(); });

  if(wifi_configured) {

    menu->addOption("Show Wifi Status", [ui](){
      ui->push<WifiStaDash>(WiFi.SSID().c_str(), WiFi.localIP().toString().c_str(), static_cast<float>(WiFi.RSSI()), [ui]() {
        ui->pop();
      });
    });

    menu->addOption("clear saved wifi", [ui](){
      auto perform_clear = []() {
        resetCredentials();
        ui_handle->push<TextDisplay>("wifi connection cleared");
        ui_handle->loop();
        vTaskDelay(10000 / portTICK_PERIOD_MS);
        ESP.restart();
      };

      bool any_socket_configured = false;
      const std::vector<std::string>& roles = getSocketRolesList();
      for(size_t i = 0; i < roles.size(); ++i) {
        if(roles[i] == "back") continue;
        if(isSocketRoleConnected(roles[i])) {
          any_socket_configured = true;
          break;
        }
      }

      if(!any_socket_configured) {
        perform_clear();
        return;
      }

      std::vector<std::string> confirm_options = {"cancel", "clear anyway"};
      ui_handle->push<fg::SelectInput>("sockets will be cleared", 0, confirm_options, [perform_clear](unsigned selected) {
        ui_handle->pop();
        if(selected == 1) {
          perform_clear();
        }
      });
    });

#ifdef ENABLE_CUSTOM_MQTT
    menu->addOption("custom connection", [ui, cloud](){
      custom_mqtt_server = fg::settings().getStr("mqtt_server");
      custom_mqtt_user = fg::settings().getStr("mqtt_user");
      custom_mqtt_port = fg::settings().getStr("mqtt_port");
      custom_mqtt_pass = fg::settings().getStr("mqtt_pass");
      custom_mqtt_id = fg::settings().getStr("mqtt_id");
      custom_mqtt_enabled = fg::settings().getU8("mqtt_enabled");

      if(custom_mqtt_port == "") {
        custom_mqtt_port = "1883";
      }
      if(custom_mqtt_id == "") {
        custom_mqtt_id = "plantalytix";
      }

      auto mqttmenu = ui_handle->push<SelectMenu>();
      mqttmenu->addOption("back...", [ui](){ ui->pop(); });

      if(custom_mqtt_enabled) {
        mqttmenu->addOption("disconnect", [ui](){
          ui_handle->pop();
          fg::settings().setU8("mqtt_enabled", 0);
          ESP.restart();
        });
      }
      else {
        mqttmenu->addOption("MQTT Server", [ui](){
          ui_handle->push<TextEntry>("MQTT Server", custom_mqtt_server, [](std::string _mqtt_server) {
            custom_mqtt_server = _mqtt_server;
            ui_handle->pop();
          });
        });
        mqttmenu->addOption("MQTT User", [ui](){
          ui_handle->push<TextEntry>("MQTT User", custom_mqtt_user, [](std::string _mqtt_user) {
            custom_mqtt_user = _mqtt_user;
            ui_handle->pop();
          });
        });
        mqttmenu->addOption("MQTT Port", [ui](){
          ui_handle->push<TextEntry>("MQTT Port", custom_mqtt_port, [](std::string _mqtt_port) {
            custom_mqtt_port = _mqtt_port;
            ui_handle->pop();
          });
        });
        mqttmenu->addOption("MQTT Password", [ui](){
          ui_handle->push<TextEntry>("MQTT Password", custom_mqtt_pass, [](std::string _mqtt_pass) {
            custom_mqtt_pass = _mqtt_pass;
            ui_handle->pop();
          });
        });
        mqttmenu->addOption("MQTT Identifier", [ui](){
          ui_handle->push<TextEntry>("MQTT Identifier", custom_mqtt_id, [](std::string _mqtt_id) {
            custom_mqtt_id = _mqtt_id;
            ui_handle->pop();
          });
        });
        mqttmenu->addOption("connect", [ui](){
          ui_handle->pop();
          fg::settings().setStr("mqtt_server", custom_mqtt_server.c_str());
          fg::settings().setStr("mqtt_user", custom_mqtt_user.c_str());
          fg::settings().setStr("mqtt_pass", custom_mqtt_pass.c_str());
          fg::settings().setStr("mqtt_port", custom_mqtt_port.c_str());
          fg::settings().setStr("mqtt_id", custom_mqtt_id.c_str());

          auto client = new EspMQTTClient(
            custom_mqtt_server.c_str(),  // MQTT Broker server ip
            atoi(custom_mqtt_port.c_str()),              // The MQTT port, default to 1883. this line can be omitted
            custom_mqtt_user.c_str(),   // Can be omitted if not needed
            custom_mqtt_pass.c_str(),   // Can be omitted if not needed
            "fridge"     // Client name that uniquely identify your device
          );

          TickType_t connection_timeout = xTaskGetTickCount();
          while(xTaskGetTickCount() - connection_timeout < configTICK_RATE_HZ * 5.0) {
            client->loop();
            if(client->isMqttConnected()) {
              fg::settings().setU8("mqtt_enabled", 1);
              ui_handle->push<TextDisplay>("connected", 1, []() {
                ESP.restart();
              });
              while(1) { ui_handle->loop(); }
            }
          }
          ui_handle->push<TextDisplay>("connection failed", 1, []() {
            ui_handle->pop();
          });
        });
      }
    });
#endif

  if(!custom_mqtt_enabled) {

      menu->addOption("change server", [=](){
        ui_handle->push<TextEntry>("server url", "#API_URL_EXTERNAL#", [=](std::string url) {
          ui_handle->pop();
          ui_handle->push<TextEntry>("join password", [=](std::string password) {
            ui_handle->pop();
            ui_handle->push<TextDisplay>("connecting...");
            ui_handle->loop();

            cloud->registerWithCloud(url, password);

            ui_handle->pop();
            ui_handle->push<TextDisplay>("connection failed!", 1, []() {
              ui_handle->pop();
            });
            ui_handle->loop();
          });
        });
      });

      menu->addOption("connect to portal", [=](){
        ui_handle->push<TextDisplay>("connecting...");
        ui_handle->loop();
        std::string code = cloud->requestPairingCode();
        ui_handle->pop();
        if(code.size()) {
          ui_handle->push<TextDisplay>(code.c_str(), "pairing code", 2, [](){
            ui_handle->pop();
          });
        }
        else {
          ui_handle->push<TextDisplay>("failed to connect to cloud", 1, [](){
            ui_handle->pop();
          });
        }
      });
    }

  }

  else {

    menu->addOption("use mobile phone", [ui](){
      createConfigurationAP();
      ui->push<WifiApDash>(ssid, ip, [ui]() {
        ui->pop();
      });
    });

    menu->addOption("use display", [=](){
      ui_handle->push<TextDisplay>("scanning...");
      ui_handle->loop();
      scanned_ssids = scanWifiNetworks();
      scanned_ssids.insert(scanned_ssids.begin(), "back");
      ui_handle->pop();
      ui_handle->push<fg::SelectInput>("select network", 0, scanned_ssids, [=](unsigned selected) {
        primary_ssid = scanned_ssids[selected].c_str();
        ui_handle->pop();
        if(selected != 0) {
          ui_handle->push<TextEntry>("enter password", [=](std::string password) {
            primary_password = password.c_str();
            Serial.println(primary_ssid.c_str());
            Serial.println(primary_password.c_str());
            ui_handle->pop();
            ui_handle->push<TextDisplay>("connecting...");
            ui_handle->loop();
            if(connectToWifi(primary_ssid, primary_password)) {
              ui_handle->pop();
              Serial.println(primary_ssid.c_str());
              Serial.println(primary_password.c_str());

              saveWifiCredentials();
              ui_handle->push<TextDisplay>("connected!", 1, []() {
                ESP.restart();
              });
            }
            else {
              ui_handle->pop();
              ui_handle->push<TextDisplay>("connection failed", 1, []() {
                ui_handle->pop();
              });
            }
          });

        }
      });
    });

  }

  menu->addOption("reboot", [ui](){
    ui_handle->push<TextDisplay>("rebooting...", 1, []() {
      ESP.restart();
    }, 1500);
  });

  menu->addOption("Conn. Loss Reboot", [ui](){
    showRebootWatchdogUi(ui);
  });

}


std::string randomSsid() {
  std::string ssid(DEFAULT_SSID_PREFIX);
  srand(time(NULL));
  for(auto i = 0; i < 6; i++) {
    auto c = random(16);
    if(c < 10) {
      ssid.push_back('0' + c);
    }
    else {
      ssid.push_back('A' + c);
    }
  }
  return ssid;
}

void handleNotFound() {
  server.sendHeader("Location", "/portal");
  server.send(302, "text/plain", "redirect to captive portal");
}

void InitalizeHTTPServer() {
  server.on("/config", handleConfig);
  server.on("/portal", handleRoot);
  server.on("/scan", handleGetScan);
  server.onNotFound ( handleNotFound );

  server.begin();
}

boolean createConfigurationAP()
{
  ip = apIP.toString().c_str();
  netmask = netMsk.toString().c_str();

  WiFi.disconnect();
  WiFi.mode(WIFI_AP_STA);
  Serial.print(F("Initalize SoftAP "));
  ssid = randomSsid();

  if (WiFi.softAP(ssid.c_str()))
  {
    delay(2000);
    //WiFi.softAPConfig(apIP, apIP, netMsk);
    dnsServer.start();
    Serial.println(F("successful."));
    InitalizeHTTPServer();
    server_active = true;
    return true;
  }
  else {
    Serial.println(F("Soft AP Error."));
    return false;
  }
}

bool connectToWifi(std::string ssid, std::string password) {
  Serial.print(F("Connecting to wifi network "));
  Serial.println(ssid.c_str());
  delay(1000);
  WiFi.setAutoReconnect(true);
  WiFi.setAutoConnect(true);

  if(wifiIsConnected()) {
    WiFi.disconnect(false, false);
    while(wifiIsConnected()) {
      vTaskDelay(1000 / portTICK_PERIOD_MS);
      status = WiFi.status();
      Serial.println(F("Status:"));
      Serial.println(status);
    }
  }
  //WiFi.scanDelete();

  if(password != "") {
    WiFi.begin(ssid.c_str(), password.c_str());
  }
  else {
    WiFi.begin(ssid.c_str());
  }

  Serial.println(F("Status:"));
  Serial.println(status);

  wl_status_t status = WL_IDLE_STATUS;
  unsigned int timeout = 0;

  do {
    delay(10);
    status = WiFi.status();
    switch(status) {
      case WL_NO_SHIELD :
      case WL_IDLE_STATUS :
      case WL_CONNECTED :
      case WL_SCAN_COMPLETED :
      case WL_DISCONNECTED :
        break;
      case WL_NO_SSID_AVAIL :
      case WL_CONNECT_FAILED :
      case WL_CONNECTION_LOST :
      default:
        Serial.println(F("Connection failed."));
        Serial.println(status);
        WiFi.disconnect(false, false);
        return false;
    }

    if(timeout++ > 1000) {
      Serial.println(F("Connection timeout."));
      WiFi.disconnect(false, false);
      return false;
    }
    delay(10);
    esp_task_wdt_reset();
  } while(status != WL_CONNECTED);

  Serial.println(F("Connection successful."));
  Serial.println("IP address: ");
  Serial.print(WiFi.localIP());
  Serial.print(" / ");
  Serial.println(WiFi.macAddress());
  WiFi.setAutoConnect(true);
  return true;
}

bool wifiIsConfigured() {
  return wifi_configured;
}

bool wifiIsConnected() {
  auto wifi_status = WiFi.status();
  switch(wifi_status) {
    case WL_CONNECTED :
      return true;
    case WL_NO_SHIELD :
    case WL_IDLE_STATUS :
    case WL_SCAN_COMPLETED :
    case WL_DISCONNECTED :
    case WL_NO_SSID_AVAIL :
    case WL_CONNECT_FAILED :
    case WL_CONNECTION_LOST :
    default:
      return false;
  }
}




bool loadWifiCredentials()
{
  // fg::settings().setStr("pssid", "TESTNET");
  // fg::settings().setStr("ppassword", "aaaaaaaa");
  if(fg::settings().has("pssid")) {
    primary_ssid = fg::settings().getStr("pssid");
    primary_password = fg::settings().getStr("ppassword");
    secondary_ssid = fg::settings().getStr("sssid");
    secondary_password = fg::settings().getStr("spassword");
    return true;
  }
  else {
    return false;
  }
}

/** Store WLAN credentials to EEPROM */

void saveWifiCredentials() {
  Serial.println("saving credentials");
  Serial.println(primary_ssid.c_str());
  Serial.println(primary_password.c_str());
  fg::settings().setStr("pssid", primary_ssid.c_str());
  fg::settings().setStr("ppassword", primary_password.c_str());
  fg::settings().commit();
}

void resetCredentials() {
  fg::settings().erase("pssid");

  smart_socket_outputs_reported = false;
  smart_sockets.clear();
  smart_sockets_loaded = true;
  persistSmartSockets();   // erases every slot and the legacy per-role keys

  fg::settings().erase("sock_oth1");
  fg::settings().erase("sock_oth2");
  fg::settings().erase("sock_oth3");
  fg::settings().erase("sock_misc");

  fg::settings().commit();
}

void handleRoot() {
  // Sent as-is from flash; the browser inflates it, so the device needs
  // neither a decoder nor a buffer for the expanded page.
  server.sendHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  server.sendHeader("Pragma", "no-cache");
  server.sendHeader("Expires", "-1");
  server.sendHeader("Content-Encoding", "gzip");
  server.send_P(200, "text/html", reinterpret_cast<PGM_P>(INDEX_HTML_GZ), INDEX_HTML_GZ_SIZE);

  server.client().stop();
}

/** Wifi config page handler */
void handleConfig() {
  String body = server.arg("plain");
  Serial.println(body);

  StaticJsonDocument<200> config_data;
  if(auto error = deserializeJson(config_data, body)) {
    Serial.print(F("deserializeJson() failed: "));
    Serial.println(error.f_str());
    return;
  }

  primary_ssid = config_data["primary"]["ssid"].as<std::string>();
  primary_password = config_data["primary"]["password"].as<std::string>();

  bool connected = connectToWifi(primary_ssid, primary_password);

  if(connected) {
    saveWifiCredentials();
    server.send ( 200, "text/html", "ok" );
    server.client().stop();
    delay(10000);
    ESP.restart();
  }
  else {
    server.send ( 200, "text/html", "error" );
    server.client().stop();
  }
}

void handleGetScan() {
  auto ssids = scanWifiNetworks();
  StaticJsonDocument<1024> response;

  server.sendHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  server.sendHeader("Pragma", "no-cache");
  server.sendHeader("Expires", "-1");

  for(auto ssid : ssids) {
    response.add(ssid);
  }

  std::stringstream stream;
  serializeJson(response, stream);

  server.send (200, "application/json", stream.str().c_str());
}


/** Is this an IP? */
boolean isIp(String str) {
  for (int i = 0; i < str.length(); i++) {
    int c = str.charAt(i);
    if (c != '.' && (c < '0' || c > '9')) {
      return false;
    }
  }
  return true;
}

String GetEncryptionType(byte thisType) {
  String Output = "";
   // read the encryption type and print out the name:
   switch (thisType) {
     case 5:
       Output = "WEP";
       return Output;
       break;
     case 2:
       Output = "WPA";
       return Output;
       break;
     case 4:
       Output = "WPA2";
       return Output;
       break;
     case 7:
       Output = "None";
       return Output;
       break;
     default:
     case 8:
       Output = "Auto";
       return Output;
      break;
   }
}

/** IP to String? */
String toStringIp(IPAddress ip) {
  String res = "";
  for (int i = 0; i < 3; i++) {
    res += String((ip >> (8 * i)) & 0xFF) + ".";
  }
  res += String(((ip >> 8 * 3)) & 0xFF);
  return res;
}

String formatBytes(size_t bytes) {            // lesbare Anzeige der Speichergrößen
   if (bytes < 1024) {
     return String(bytes) + " Byte";
   } else if (bytes < (1024 * 1024)) {
     return String(bytes / 1024.0) + " KB";
   } else  {
     return String(bytes / 1024.0 / 1024.0) + " MB";
   }
}

std::string sanitizeSettingString(const std::string& value) {
  return std::string(value.c_str());
}

std::string urlEncode(const std::string& value) {
  static const char* hex = "0123456789ABCDEF";
  std::string encoded;
  encoded.reserve(value.size() * 3);

  for(unsigned char c : value) {
    if((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '-' || c == '_' || c == '.' || c == '~') {
      encoded.push_back(static_cast<char>(c));
    }
    else {
      encoded.push_back('%');
      encoded.push_back(hex[(c >> 4) & 0x0F]);
      encoded.push_back(hex[c & 0x0F]);
    }
  }

  return encoded;
}

bool httpGet(const char* url, std::string* response) {
  if(ESP.getFreeHeap() < HTTP_MIN_FREE_HEAP) {
    Serial.printf("[httpGet] skip (low heap free=%u largest=%u): %s\n",
                  (unsigned)ESP.getFreeHeap(),
                  (unsigned)ESP.getMaxAllocHeap(),
                  url);
    return false;
  }

  // Persistent so the internal Arduino Strings (_host, _uri, _protocol) get
  // reassigned in place across calls rather than reallocated each time —
  // similar-length URLs (like the Smart Socket commands we issue most often)
  // then reuse the existing String capacity. end() below still closes the
  // TCP socket cleanly every call, so no keep-alive / host-tracking
  // gymnastics are needed: Smart Socket commands alternate between hosts,
  // which would invalidate keep-alive on every call anyway.
  //
  // httpGet only runs on the loop task; single-threaded, static is safe.
  static HTTPClient http;

  if(!http.begin(url)) {
    return false;
  }

  // Bound both the TCP connect and the read so an unreachable smart-socket
  // can never block the main loop long enough to trip the task watchdog.
  http.setConnectTimeout(3000);
  http.setTimeout(3000);
  int code = http.GET();
  if(response != nullptr && code > 0) {
    *response = std::string(http.getString().c_str());
  }
  http.end();

  return code >= 200 && code < 300;
}

bool parseSmartSocketIp(const std::string& body, std::string& socket_ip) {
  StaticJsonDocument<256> response;
  if(deserializeJson(response, body.c_str())) {
    return false;
  }

  std::string ip_field = response["IPAddress1"].as<std::string>();
  if(ip_field.empty()) {
    return false;
  }

  ip_field = sanitizeSettingString(ip_field);
  auto start = ip_field.find('(');
  auto end = ip_field.find(')', start == std::string::npos ? 0 : start + 1);

  std::string parsed = ip_field;
  if(start != std::string::npos && end != std::string::npos && end > start + 1) {
    parsed = ip_field.substr(start + 1, end - start - 1);
  }

  if(!isIp(parsed.c_str())) {
    return false;
  }

  socket_ip = parsed;
  return true;
}

void delayWithWatchdog(uint32_t delay_ms) {
  uint32_t remaining = delay_ms;
  while(remaining > 0) {
    uint32_t step = remaining > 200 ? 200 : remaining;
    vTaskDelay(step / portTICK_PERIOD_MS);
    esp_task_wdt_reset();
    remaining -= step;
  }
}

static size_t socketCountForRole(const std::string& role) {
  size_t count = 0;
  for(const auto& socket : smart_sockets) {
    if(socket.role == role) {
      ++count;
    }
  }
  return count;
}

bool isSocketRoleConnected(const std::string& role) {
  return socketCountForRole(role) > 0;
}

// Pre-multi-socket storage: one address per role, plus its credentials. The
// table has replaced it, but it is still written (see persistSmartSockets) so
// that a firmware rollback finds the first socket of each role where it expects
// it instead of an empty configuration.
static std::string legacySocketRoleKey(const std::string& role) {
  // NVS key length is limited, keep all keys <= 15 chars.
  if(role == "dehumidifier") return "sock_dehum";
  if(role == "heater") return "sock_heat";
  if(role == "light") return "sock_light";
  if(role == "secondary_light") return "sock_slight";
  if(role == "co2") return "sock_co2";
  if(role == "other1") return "sock_oth1";
  if(role == "other2") return "sock_oth2";
  if(role == "other3") return "sock_oth3";
  return "sock_misc";
}

static std::string legacySocketUserKey(const std::string& role) {
  return "su_" + legacySocketRoleKey(role).substr(5);   // e.g. su_dehum, <= 15 chars
}

static std::string legacySocketPasswordKey(const std::string& role) {
  return "sp_" + legacySocketRoleKey(role).substr(5);   // e.g. sp_dehum, <= 15 chars
}

// One NVS key per socket rather than one blob for the whole table: a change
// then rewrites a few dozen bytes instead of the lot, which matters on a 16 KB
// NVS partition.
static std::string socketSlotKey(size_t slot) {
  return "sk" + std::to_string(slot);
}

// Room for one more socket. The count is the headline limit; the free NVS
// entries matter just as much, because writing to a full settings partition
// aborts inside the NVS driver instead of returning an error.
static bool canStoreAnotherSocket() {
  static constexpr size_t NVS_ENTRY_MARGIN = 24;
  return smart_sockets.size() < MAX_SMART_SOCKETS &&
         fg::settings().freeEntries() >= NVS_ENTRY_MARGIN;
}

static void persistSmartSockets() {
  for(size_t slot = 0; slot < MAX_SMART_SOCKETS; ++slot) {
    const std::string key = socketSlotKey(slot);
    if(slot >= smart_sockets.size()) {
      fg::settings().erase(key.c_str());
      continue;
    }

    const SmartSocket& socket = smart_sockets[slot];
    // Sized for the longest accepted record — a 64 character address plus 48
    // character credentials. An overflowing document would serialise to
    // truncated JSON and be dropped again on the next boot.
    StaticJsonDocument<512> record;
    record["r"] = socket.role;
    record["i"] = socket.id;
    record["a"] = socket.ip;
    if(!socket.user.empty()) {
      record["u"] = socket.user;
    }
    if(!socket.password.empty()) {
      record["p"] = socket.password;
    }

    char buffer[320];
    serializeJson(record, buffer, sizeof(buffer));
    fg::settings().setStr(key.c_str(), buffer);
  }

  for(const auto& role : getSocketRolesList()) {
    if(role == "back") {
      continue;
    }
    const SmartSocket* primary = nullptr;
    for(const auto& socket : smart_sockets) {
      if(socket.role == role) {
        primary = &socket;
        break;
      }
    }

    if(primary == nullptr) {
      fg::settings().erase(legacySocketRoleKey(role).c_str());
      fg::settings().erase(legacySocketUserKey(role).c_str());
      fg::settings().erase(legacySocketPasswordKey(role).c_str());
      continue;
    }

    fg::settings().setStr(legacySocketRoleKey(role).c_str(), primary->ip.c_str());
    if(primary->password.empty()) {
      fg::settings().erase(legacySocketUserKey(role).c_str());
      fg::settings().erase(legacySocketPasswordKey(role).c_str());
    }
    else {
      fg::settings().setStr(legacySocketUserKey(role).c_str(), primary->user.c_str());
      fg::settings().setStr(legacySocketPasswordKey(role).c_str(), primary->password.c_str());
    }
  }

  fg::settings().commit();
}

// Adopts sockets stored the old way. Skipping anything already in the table
// keeps this a no-op after the first run, which it has to be: persistSmartSockets()
// keeps those same keys up to date for rollback safety.
static void migrateLegacySmartSockets() {
  bool adopted = false;

  for(const auto& role : getSocketRolesList()) {
    if(role == "back" || smart_sockets.size() >= MAX_SMART_SOCKETS) {
      continue;
    }
    const std::string ip = sanitizeSettingString(fg::settings().getStr(legacySocketRoleKey(role).c_str()));
    if(ip.empty()) {
      continue;
    }

    bool known = false;
    for(const auto& socket : smart_sockets) {
      known = known || (socket.role == role && socket.ip == ip);
    }
    if(known) {
      continue;
    }

    SmartSocket socket;
    socket.role = role;
    socket.ip = ip;
    socket.user = sanitizeSettingString(fg::settings().getStr(legacySocketUserKey(role).c_str()));
    socket.password = sanitizeSettingString(fg::settings().getStr(legacySocketPasswordKey(role).c_str()));
    smart_sockets.push_back(socket);
    adopted = true;
  }

  if(adopted) {
    persistSmartSockets();
  }
}

static void ensureSmartSocketsLoaded() {
  if(smart_sockets_loaded) {
    return;
  }
  smart_sockets_loaded = true;
  smart_sockets.clear();

  for(size_t slot = 0; slot < MAX_SMART_SOCKETS; ++slot) {
    const std::string raw = sanitizeSettingString(fg::settings().getStr(socketSlotKey(slot).c_str()));
    if(raw.empty()) {
      continue;
    }

    StaticJsonDocument<512> record;
    if(deserializeJson(record, raw.c_str())) {
      continue;
    }

    SmartSocket socket;
    socket.role = record["r"] | "";
    socket.id = record["i"] | "";
    socket.ip = record["a"] | "";
    socket.user = record["u"] | "";
    socket.password = record["p"] | "";
    if(socket.ip.empty() || !isKnownSocketRole(socket.role)) {
      continue;
    }
    smart_sockets.push_back(socket);
  }

  migrateLegacySmartSockets();
}

// Points a socket at the address its hardware id has just been found on.
// Returns true when the host belongs to one of ours.
static bool applyDiscoveredSocketHost(const fg::LanScan::Host& host) {
  bool matched = false;

  for(auto& socket : smart_sockets) {
    if(socket.id.empty() || socket.id != host.id) {
      continue;
    }
    matched = true;

    if(socket.ip != host.ip) {
      Serial.printf("[smart-socket] %s moved from %s to %s\n",
                    socket.id.c_str(), socket.ip.c_str(), host.ip.c_str());
      if(smart_socket_cloud_handle != nullptr) {
        smart_socket_cloud_handle->log(std::string("message-smart-socket-readdressed:") + socket.role, 0);
      }
      socket.ip = host.ip;
      socket_search_changed = true;
      // Re-assert the target on the new address rather than waiting out the
      // resend period.
      socket.initialized = false;
    }

    socket.failures_since_seen = 0;
    socket.consecutive_failures = 0;
    socket.disabled_until_tick = 0;
  }

  return matched;
}

static void finishSocketSearch(unsigned matched) {
  socket_search.stop();
  socket_search_allowed_tick = xTaskGetTickCount() + SMART_SOCKET_SEARCH_COOLDOWN;

  // Whether or not a socket was found, its failure count starts over: the
  // cooldown is what keeps the next search from following immediately.
  for(auto& socket : smart_sockets) {
    socket.failures_since_seen = 0;
  }

  Serial.printf("[smart-socket] search finished, %u socket(s) located\n", matched);
  if(socket_search_changed) {
    socket_search_changed = false;
    persistSmartSockets();
    reportSocketsHardwareInfo();
  }
}

static bool auxDisplayIsIdle() {
  return ui_handle == nullptr || ui_handle->isIdle();
}

// Aux devices are addressed on the LAN and DHCP can move them. Finding them
// again means sweeping the subnet, which takes long enough to be noticeable, so
// it only ever runs while the display is idle and never while the AP portal is
// serving.
static void tickAuxDeviceSearch() {
  static unsigned matched = 0;

  // A sweep opens a TCP connection per address; the same heap floor that makes
  // httpGet refuse to run applies to it.
  const bool healthy = wifiIsConnected() && auxDisplayIsIdle() && ESP.getFreeHeap() >= HTTP_MIN_FREE_HEAP;

  if(socket_search.running()) {
    if(!healthy) {
      socket_search.stop();
      return;
    }
    const bool done = socket_search.tick([](const fg::LanScan::Host& host) {
      matched += applyDiscoveredSocketHost(host) ? 1 : 0;
    });
    if(done) {
      finishSocketSearch(matched);
    }
    return;
  }

  if(server_active || !healthy) {
    return;
  }
  if((int32_t)(socket_search_allowed_tick - xTaskGetTickCount()) > 0) {
    return;
  }

  // The camera announces itself, so looking for it is a longer discovery round
  // rather than a sweep — cheap enough to do before starting one.
  if(fg::okamCamNeedsSearch()) {
    fg::okamCamSearch(smart_socket_cloud_handle);
    socket_search_allowed_tick = xTaskGetTickCount() + SMART_SOCKET_SEARCH_COOLDOWN;
    return;
  }

  // Only a socket whose hardware id is known can be recognised again; without
  // one a sweep would find nothing however often it ran.
  bool stale = false;
  for(const auto& socket : smart_sockets) {
    stale = stale || (!socket.id.empty() && socket.failures_since_seen >= SMART_SOCKET_FAILURES_BEFORE_SEARCH);
  }
  if(!stale) {
    return;
  }

  matched = 0;
  socket_search_changed = false;
  if(!socket_search.start(socketAuthQueries())) {
    socket_search_allowed_tick = xTaskGetTickCount() + SMART_SOCKET_SEARCH_COOLDOWN;
    return;
  }
  Serial.println("[smart-socket] searching the network for moved sockets");
}

const std::vector<std::string>& getSocketRolesList() {
  static const std::vector<std::string> roles = {
    "back",
    "dehumidifier",
    "heater",
    "light",
    "secondary_light",
    "co2",
  };
  return roles;
}

static std::string connectedSocketRolesCsv() {
  const std::vector<std::string>& roles = getSocketRolesList();
  std::string csv;
  for(const auto& role : roles) {
    if(role == "back" || !isSocketRoleConnected(role)) {
      continue;
    }
    if(!csv.empty()) {
      csv += ",";
    }
    csv += role;
  }

  // "none" (instead of an empty value) lets the cloud distinguish "nothing
  // paired" from "old firmware that never reports".
  if(csv.empty()) {
    csv = "none";
  }
  return csv;
}

// role@ip pairs for the cloud UI ("heater@192.168.1.60,..."); addresses are
// sanitized on write and never contain ',' or '@'. One entry per role, even
// when several sockets share it: this is the summary older readers understand,
// and the full table travels in the socket_list chunks below.
static std::string connectedSocketIpsCsv() {
  const std::vector<std::string>& roles = getSocketRolesList();
  std::string csv;
  for(const auto& role : roles) {
    for(const auto& socket : smart_sockets) {
      if(role == "back" || socket.role != role) {
        continue;
      }
      const std::string entry = role + "@" + socket.ip;
      // Addresses may be long hostnames; keep the summary inside what a log
      // message can carry and let the socket_list chunks be the complete
      // picture.
      if(csv.size() + entry.size() + 1 > MAX_REPORTED_VALUE_LEN) {
        break;
      }
      if(!csv.empty()) {
        csv += ",";
      }
      csv += entry;
      break;
    }
  }
  if(csv.empty()) {
    csv = "none";
  }
  return csv;
}

static void reportSocketsHardwareInfo() {
  if(smart_socket_cloud_handle == nullptr) {
    return;
  }
  smart_socket_cloud_handle->log("hardware-info:sockets=" + connectedSocketRolesCsv(), 0);
  smart_socket_cloud_handle->log("hardware-info:socket_ips=" + connectedSocketIpsCsv(), 0);

  // The full table, chunked. A log message is serialised into a fixed-size
  // buffer, so a table of 32 sockets cannot travel as one value. Entry N of
  // chunk K describes the socket in slot K * SOCKETS_PER_REPORT_CHUNK + N, and
  // sockets_n says how many slots are live — chunks left over from a larger
  // table are then ignored rather than mistaken for current ones.
  smart_socket_cloud_handle->log("hardware-info:sockets_n=" + std::to_string(smart_sockets.size()), 0);

  for(size_t chunk = 0; chunk * SOCKETS_PER_REPORT_CHUNK < smart_sockets.size(); ++chunk) {
    std::string value;
    for(size_t i = 0; i < SOCKETS_PER_REPORT_CHUNK; ++i) {
      const size_t slot = chunk * SOCKETS_PER_REPORT_CHUNK + i;
      if(slot >= smart_sockets.size()) {
        break;
      }
      if(!value.empty()) {
        value += ",";
      }
      value += smart_sockets[slot].role + "|" + smart_sockets[slot].id + "|" + smart_sockets[slot].ip;
    }
    smart_socket_cloud_handle->log("hardware-info:socket_list" + std::to_string(chunk) + "=" + value, 0);
  }
}

void wifiSetUserInterface(fg::UserInterface* ui) {
  ui_handle = ui;
}

void wifiInitAuxCloudReporting(fg::Fridgecloud* cloud) {
  smart_socket_cloud_handle = cloud;
  ensureSmartSocketsLoaded();
  reportSocketsHardwareInfo();

  if(cloud != nullptr) {
    // Report the camera state on every boot, INCLUDING when there is none.
    // Staying silent when nothing is paired cannot clear a stale value in the
    // cloud — it would keep whatever it last heard, so a camera disconnected
    // while the module was offline would appear connected forever. "none" is
    // the same sentinel the disconnect path sends.
    const std::string cam_did = sanitizeSettingString(fg::settings().getStr(OKAM_CAM_DID_NVS_KEY));
    cloud->log("hardware-info:webcam_did=" +
               ((!cam_did.empty() && cam_did.size() < 64) ? cam_did : std::string("none")), 0);
    // legacy: also surface a stored RTSP url if one was configured before
    const std::string cam_url = sanitizeSettingString(fg::settings().getStr(TERP_CAM_URL_NVS_KEY));
    cloud->log("hardware-info:webcam_url=" +
               ((!cam_url.empty() && cam_url.size() < 200) ? cam_url : std::string("none")), 0);
  }
}

static bool isKnownSocketRole(const std::string& role) {
  const std::vector<std::string>& roles = getSocketRolesList();
  for(const auto& candidate : roles) {
    if(candidate != "back" && candidate == role) {
      return true;
    }
  }
  return false;
}

// Resolves the sockets a cloud command addresses: one slot when the caller
// named it, otherwise every socket of the role (which is what the command
// meant back when a role could only have one).
static std::vector<size_t> addressedSockets(const std::string& role, int slot) {
  std::vector<size_t> indexes;

  if(slot >= 0) {
    if((size_t)slot < smart_sockets.size()) {
      indexes.push_back((size_t)slot);
    }
    return indexes;
  }

  for(size_t i = 0; i < smart_sockets.size(); ++i) {
    if(smart_sockets[i].role == role) {
      indexes.push_back(i);
    }
  }
  return indexes;
}

bool wifiRemoveSmartSocket(const std::string& role, int slot) {
  ensureSmartSocketsLoaded();

  if(slot >= 0 ? (size_t)slot >= smart_sockets.size() : !isKnownSocketRole(role)) {
    return false;
  }

  std::vector<size_t> victims = addressedSockets(role, slot);

  // Back to front, so the indexes still to be removed stay valid.
  for(size_t i = victims.size(); i-- > 0;) {
    const SmartSocket socket = smart_sockets[victims[i]];
    smart_sockets.erase(smart_sockets.begin() + victims[i]);

    if(smart_socket_cloud_handle != nullptr) {
      smart_socket_cloud_handle->log(std::string("message-smart-socket-disconnected:") + socket.role, 0);
    }

    // Best effort: factory-reset the socket so it reopens its pairing AP.
    // httpGet is heap-guarded and simply fails when offline.
    const std::string auth_query = socketAuthQuery(socket);
    if(!socket.ip.empty() && !auth_query.empty()) {
      const std::string reset_url = "http://" + socket.ip + "/cm?" + auth_query + "cmnd=Reset%201";
      httpGet(reset_url.c_str());
      esp_task_wdt_reset();
    }
  }

  persistSmartSockets();
  reportSocketsHardwareInfo();
  return true;
}

bool wifiSetSmartSocket(const std::string& role, const std::string& ip, const std::string& user, const std::string& password, int slot) {
  ensureSmartSocketsLoaded();

  if(!isKnownSocketRole(role)) {
    return false;
  }

  const std::string clean_ip = sanitizeSettingString(ip);
  if(clean_ip.empty() || clean_ip.size() > 64 || clean_ip.find(' ') != std::string::npos) {
    return false;
  }

  const std::string clean_user = sanitizeSettingString(user);
  const std::string clean_password = sanitizeSettingString(password);
  if(clean_user.size() > 48 || clean_password.size() > 48) {
    return false;
  }

  SmartSocket* target = nullptr;
  if(slot >= 0) {
    if((size_t)slot >= smart_sockets.size()) {
      return false;
    }
    target = &smart_sockets[(size_t)slot];
  }
  else {
    // Without a slot the command still means "configure the socket of this
    // role"; with several of them the caller has to say which one.
    const std::vector<size_t> existing = addressedSockets(role, -1);
    if(existing.size() > 1) {
      return false;
    }
    if(existing.size() == 1) {
      target = &smart_sockets[existing[0]];
    }
  }

  if(target == nullptr) {
    if(!canStoreAnotherSocket()) {
      return false;
    }
    smart_sockets.push_back(SmartSocket());
    target = &smart_sockets.back();
  }

  // A different address is a different device until it says otherwise: drop the
  // learned hardware id so it is read back from whatever answers there now.
  if(target->ip != clean_ip) {
    target->id.clear();
    target->id_probed = false;
  }
  target->role = role;
  target->ip = clean_ip;
  target->user = clean_password.empty() ? std::string() : clean_user;
  target->password = clean_password;
  target->initialized = false;
  target->consecutive_failures = 0;
  target->failures_since_seen = 0;
  target->disabled_until_tick = 0;

  persistSmartSockets();

  if(smart_socket_cloud_handle != nullptr) {
    smart_socket_cloud_handle->log(std::string("message-smart-socket-connected:") + role, 0);
  }
  reportSocketsHardwareInfo();
  return true;
}

bool wifiTestSmartSocket(const std::string& role, int slot) {
  ensureSmartSocketsLoaded();

  const std::vector<size_t> targets = addressedSockets(role, slot);
  if(targets.empty()) {
    return false;
  }

  bool ok = true;
  for(size_t index : targets) {
    // Short ON pulse ending OFF; the control loop re-asserts the desired state
    // within its regular resend window afterwards.
    ok = sendSocketPower(smart_sockets[index], true) && ok;
    delayWithWatchdog(2000);
    ok = sendSocketPower(smart_sockets[index], false) && ok;
    noteSocketCommandSent(smart_sockets[index]);
  }
  return ok;
}

bool wifiHandleAuxCommand(const JsonDocument& command, fg::Fridgecloud* cloud) {
  if(!command["action"]) {
    return false;
  }

  if(command["action"] == std::string("cam_capture")) {
    // Grab a still from the paired camera and stream it to the cloud. Runs on
    // the loop task; okamCamCapture() is bounded and feeds the watchdog.
    if(!okamCamCapture(cloud) && cloud) {
      cloud->log("message-aux-command-failed:cam_capture", 1);
    }
    return true;
  }

  // Optional: addresses one socket of a role, as reported in socket_list.
  // Absent means "the socket of this role", which is all a command could mean
  // before a role could have several.
  const int slot = command["slot"].isNull() ? -1 : command["slot"].as<int>();

  if(command["action"] == std::string("socket_remove")) {
    const std::string role = command["role"] | "";
    if(!wifiRemoveSmartSocket(role, slot) && cloud) {
      cloud->log(std::string("message-aux-command-failed:socket_remove:") + role, 1);
    }
    return true;
  }

  if(command["action"] == std::string("socket_set")) {
    const std::string role = command["role"] | "";
    const std::string ip = command["ip"] | "";
    const std::string user = command["user"] | "";
    const std::string password = command["password"] | "";
    if(!wifiSetSmartSocket(role, ip, user, password, slot) && cloud) {
      cloud->log(std::string("message-aux-command-failed:socket_set:") + role, 1);
    }
    return true;
  }

  if(command["action"] == std::string("socket_test")) {
    const std::string role = command["role"] | "";
    if(!wifiTestSmartSocket(role, slot)) {
      if(cloud) {
        cloud->log(std::string("message-smart-socket-cmd-failed:") + role + ":test", 1);
      }
    }
    else if(cloud) {
      cloud->log(std::string("message-smart-socket-tested:") + role, 0);
    }
    return true;
  }

  return false;
}

std::vector<std::string> getSocketRoleOptions() {
  const std::vector<std::string>& base_roles = getSocketRolesList();

  std::vector<std::string> role_options;
  role_options.reserve(base_roles.size());

  for(const auto& role : base_roles) {
    if(role == "back") {
      role_options.push_back(role);
    }
    else {
      std::string display_name = role;
      if(isSocketRoleConnected(role)) {
        display_name = "* " + display_name;
      }
      role_options.push_back(display_name);
    }
  }

  return role_options;
}

bool provisionSmartSocket(const std::string& socket_role, const std::string& home_ssid, const std::string& home_password, std::string& socket_ip, std::string& error_message, const std::function<void(const char*)>& progress_callback) {
  auto emit_status = [&](const char* message) {
    Serial.println(message);
    if(progress_callback) {
      progress_callback(message);
    }
  };

  const std::string home_ssid_clean = sanitizeSettingString(home_ssid);
  const std::string home_password_clean = sanitizeSettingString(home_password);
  const std::string socket_name = "socket_" + socket_role;

  bool reconnected_to_home = false;
  auto reconnect_home = [&]() {
    if(reconnected_to_home) {
      return true;
    }
    emit_status("reconnect wifi");
    if(!connectToWifi(home_ssid_clean, home_password_clean)) {
      return false;
    }
    reconnected_to_home = true;
    return true;
  };

  auto fail_with_reconnect = [&](const char* message) {
    error_message = message;
    if(!reconnect_home()) {
      error_message = "reconnect fail";
    }
    return false;
  };

  std::string mqtt_password = sanitizeSettingString(fg::settings().getStr("mqtt_pass"));
  if(mqtt_password.empty()) {
    fg::SettingsManager provisioning(NVS_PART, "fg_provisioning");
    mqtt_password = sanitizeSettingString(provisioning.getStr("mqtt_password"));
  }

  if(mqtt_password.empty()) {
    return fail_with_reconnect("mqtt pass miss");
  }

  if(!canStoreAnotherSocket()) {
    return fail_with_reconnect("socket limit");
  }

  emit_status("config socket...");
  delayWithWatchdog(2000);
  const uint16_t pulse_value = socketRolePulseTimeValue(socket_role);
  std::string config_url = "http://192.168.4.1/cm?cmnd=Backlog%20"
                         + urlEncode("DeviceName " + socket_name + "; ")
                         + urlEncode("Hostname " + socket_name + "; ")
                         + urlEncode("PowerOnState 0; ")
                         + urlEncode("PulseTime " + std::to_string(pulse_value) + "; ")
                         + urlEncode("WiFiTest2 " + home_ssid_clean + "+" + home_password_clean + "; ")
                         + urlEncode("WebPassword " + mqtt_password);

  if(!httpGet(config_url.c_str())) {
    return fail_with_reconnect("config fail");
  }

  emit_status("config sent");
  delayWithWatchdog(2000);

  const std::string auth_query = "user=admin&password=" + urlEncode(mqtt_password) + "&";

  emit_status("wait for ip...");
  delayWithWatchdog(8000);

  std::string ip_response;
  std::string ip_url = "http://192.168.4.1/cm?" + auth_query + "cmnd=IPAddress1";
  bool ip_command_ok = httpGet(ip_url.c_str(), &ip_response);

  // Read the hardware id while the socket's own AP still answers: from here on
  // it is what identifies the socket if its address ever changes.
  const std::string socket_id = readSocketId("192.168.4.1", auth_query);

  std::string ap_url = "http://192.168.4.1/cm?" + auth_query + "cmnd=Ap%202";
  bool ap_command_ok = httpGet(ap_url.c_str());

  if(!reconnect_home()) {
    error_message = "reconnect fail";
    return false;
  }

  if(!ip_command_ok || !parseSmartSocketIp(ip_response, socket_ip)) {
    error_message = "ip lookup fail";
    return false;
  }

  if (!ap_command_ok) {
    emit_status("  failed disabling\n  ap mode - ignoring");
    delayWithWatchdog(2000);
  }

  SmartSocket socket;
  socket.role = socket_role;
  socket.ip = socket_ip;
  socket.id = socket_id;
  socket.id_probed = !socket_id.empty();
  smart_sockets.push_back(socket);
  persistSmartSockets();

  if(smart_socket_cloud_handle != nullptr) {
    smart_socket_cloud_handle->log(std::string("message-smart-socket-connected:") + socket_role, 0);
  }
  reportSocketsHardwareInfo();


  emit_status("socket configured");
  delayWithWatchdog(2000);

  return true;
}

bool isHexSegment(const std::string& value, size_t expected_len) {
  if(value.size() != expected_len) {
    return false;
  }

  for(unsigned char c : value) {
    if(!std::isxdigit(c)) {
      return false;
    }
  }

  return true;
}

static const std::string* findSmartSocketPrefix(const std::string& value) {
  for(const auto& prefix : SMART_SOCKET_SSID_PREFIXES) {
    if(value.rfind(prefix, 0) == 0) {
      return &prefix;
    }
  }
  return nullptr;
}

bool isSmartSocketSsid(const std::string& value) {
  const std::string* prefix = findSmartSocketPrefix(value);
  if(prefix == nullptr) {
    return false;
  }

  std::string suffix = value.substr(prefix->size());
  auto divider_pos = suffix.find('-');
  if(divider_pos == std::string::npos || suffix.find('-', divider_pos + 1) != std::string::npos) {
    return false;
  }

  return isHexSegment(suffix.substr(0, divider_pos), 6) && isHexSegment(suffix.substr(divider_pos + 1), 4);
}

std::vector<std::string> scanSmartSocketSsids() {
  std::vector<std::string> all_ssids = scanWifiNetworks();
  std::vector<std::string> smart_socket_ssids;

  for(const auto& network_ssid : all_ssids) {
    if(isSmartSocketSsid(network_ssid)) {
      smart_socket_ssids.push_back(network_ssid);
    }
  }

  return smart_socket_ssids;
}

std::string smartSocketDisplayName(const std::string& ssid) {
  const std::string* prefix = findSmartSocketPrefix(ssid);
  if(prefix != nullptr) {
    return ssid.substr(prefix->size());
  }

  return ssid;
}

std::vector<std::string> scanWifiNetworks() {
  WiFi.scanNetworks(true);
  int n = 0;
  auto scanstart = xTaskGetTickCount();
  while(n <= 0) {
    n = WiFi.scanComplete();
    esp_task_wdt_reset();
    if(xTaskGetTickCount() - scanstart > WIFI_SCAN_TIMEOUT) {
      n = 0;
    }
  }

  std::vector<std::string> ssids;

  Serial.println("Scan done");
  if (n == 0) {
      Serial.println("no networks found");
  } else {
      Serial.print(n);
      Serial.println(" networks found");
      Serial.println("Nr | SSID                             | RSSI | CH | Encryption");
      for (int i = 0; i < n; ++i) {
          // Print SSID and RSSI for each network found
          Serial.printf("%2d",i + 1);
          Serial.print(" | ");
          Serial.printf("%-32.32s", WiFi.SSID(i).c_str());
          Serial.print(" | ");
          Serial.printf("%4d", WiFi.RSSI(i));
          Serial.print(" | ");
          Serial.printf("%2d", WiFi.channel(i));
          Serial.print(" | ");
          switch (WiFi.encryptionType(i))
          {
          case WIFI_AUTH_OPEN:
              Serial.print("open");
              break;
          case WIFI_AUTH_WEP:
              Serial.print("WEP");
              break;
          case WIFI_AUTH_WPA_PSK:
              Serial.print("WPA");
              break;
          case WIFI_AUTH_WPA2_PSK:
              Serial.print("WPA2");
              break;
          case WIFI_AUTH_WPA_WPA2_PSK:
              Serial.print("WPA+WPA2");
              break;
          case WIFI_AUTH_WPA2_ENTERPRISE:
              Serial.print("WPA2-EAP");
              break;
          default:
              Serial.print("unknown");
          }
          Serial.println();
          ssids.push_back(WiFi.SSID(i).c_str());
          delay(10);
      }
  }
  Serial.println("");

  // Delete the scan result to free memory for code below.
  WiFi.scanDelete();
  return ssids;
}
