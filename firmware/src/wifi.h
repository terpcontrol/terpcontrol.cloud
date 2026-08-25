#pragma once

#include "fghmi.h"
#include "fridgecloud.h"

// Outgoing HTTP requests (Smart Socket control, claim/provisioning, etc.) are
// skipped when free heap is below this threshold to avoid tripping the task
// watchdog inside HTTPClient. The health watchdog in main.cpp uses the same
// value so a sustained shortage that keeps httpGet skipping also reboots the
// device, instead of leaving outputs uncontrolled indefinitely.
static constexpr uint32_t HTTP_MIN_FREE_HEAP = 45000;

namespace fg {
  // Tells someone holding a phone what to do: join this wifi, then open this
  // url. Both phone flows use it - the AP portal passes the ssid to join, the
  // change-server screen leaves it empty because the phone is already on the
  // same network as the device.
  class PhoneSetupDash: public MenuItem {
    std::string ssid;
    std::string ip;

    std::function<void(void)> callback = nullptr;

  public:
    PhoneSetupDash(std::string ip, std::function<void(void)> callback, std::string ssid = "");

    // This screen is read by somebody who then has to pick up a phone, join a
    // network and type a url. Half a minute takes the address away in the
    // middle of that, so it stays lit for three.
    unsigned int idleTicks() const override { return UI_TICKS_PER_SECOND * 180; }

    void draw() override;
    void prev() override;
    void next() override;
    void enter() override;
    void hold() override;
  };

  class WifiStaDash: public MenuItem {
    std::string ssid;
    std::string password;
    std::string ip;
    float rssi;

    std::function<void(void)> callback = nullptr;

  public:
    WifiStaDash(std::string ssid, std::string ip, float rssi, std::function<void(void)> callback);

    void draw() override;
    void prev() override;
    void next() override;
    void enter() override;
    void hold() override;
  };

}

struct SmartSocketOutputStates {
  bool dehumidifier_on = false;
  bool heater_on = false;
  bool light_on = false;
  bool secondary_light_on = false;
  bool co2_on = false;
};

// Upper bound on the number of paired smart sockets. Any number of them may
// share a role, so this — not the list of roles — is what limits how many
// sockets a module drives. It bounds NVS use and, together with the per-tick
// budget in wifi.cpp, the time one control pass can spend on HTTP.
static constexpr size_t MAX_SMART_SOCKETS = 32;

bool initializeWifi();
void resetCredentials();
void wifiTick();
bool wifiIsConnected();
bool wifiIsConfigured();
void showWifiUi(fg::UserInterface* ui, fg::Fridgecloud* cloud);
void showSmartSocketsUi(fg::UserInterface* ui, fg::Fridgecloud* cloud);
void showTerpCamUi(fg::UserInterface* ui, fg::Fridgecloud* cloud);

// Hands the display over so aux-device housekeeping (looking for smart sockets
// or the camera on the network) can wait for an idle display. A network sweep
// takes long enough that running it under somebody's fingers would show.
void wifiSetUserInterface(fg::UserInterface* ui);

// Commands every socket assigned to the role. True when they all accepted it
// (and when the role has no socket at all).
bool sendSmartSocketPower(const std::string& role, bool turn_on);
void wifiReportSmartSocketOutputs(const SmartSocketOutputStates& states);
void wifiForceAllSmartSocketsOff();

// Reports the aux-device state (paired smart sockets, Terp Cam URL) to the
// cloud via hardware-info logs. Log messages are queued, so this is safe to
// call before the cloud connection is up (and without any network at all).
void wifiInitAuxCloudReporting(fg::Fridgecloud* cloud);

// A `slot` of -1 in the calls below means "the sockets of this role" — every
// one of them for remove/test, and the single existing one for set. That is
// what a command could mean before a role could hold several sockets, so old
// callers keep working. A slot >= 0 addresses one socket by its position in
// the device's socket_list hardware report.

// Removes paired smart sockets. Idempotent for known roles: removing a role
// that has none just re-reports the current state. Returns false only for an
// unknown role or an out-of-range slot.
bool wifiRemoveSmartSocket(const std::string& role, int slot = -1);

// Assigns/updates a socket by IP (cloud-managed, e.g. a foreign Tasmota plug
// that was never paired via the AP flow), or adds one when the role has none.
// Empty password keeps the default admin/mqtt_pass credentials; otherwise
// user+password are stored with the socket. Returns false when the role
// already holds several sockets and no slot says which one is meant.
//
// `append` adds a socket to the role instead of configuring the one it has.
// A caller that wants a second heater has no slot to name yet — the socket
// does not exist — so it has to say so, and a slotless set keeps meaning
// "configure this role's socket" for everyone who called it before.
bool wifiSetSmartSocket(const std::string& role, const std::string& ip, const std::string& user, const std::string& password, int slot = -1, bool append = false);

// Pulses the addressed sockets ON for ~2s and back OFF (blocking, watchdog-fed).
// The control loop re-asserts the desired state within its resend window.
bool wifiTestSmartSocket(const std::string& role, int slot = -1);

// Handles the cloud aux-device commands shared by all socket-capable
// hwtypes (socket_remove / socket_set / socket_test). Returns true when the
// command was one of these actions; hwtype-specific commands stay with the
// caller.
bool wifiHandleAuxCommand(const JsonDocument& command, fg::Fridgecloud* cloud);
