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
  class WifiApDash: public MenuItem {
    std::string ssid;
    std::string ip;

    std::function<void(void)> callback = nullptr;

  public:
    WifiApDash(std::string ssid, std::string ip, std::function<void(void)> callback);

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

bool initializeWifi();
void resetCredentials();
void wifiTick();
bool wifiIsConnected();
bool wifiIsConfigured();
void showWifiUi(fg::UserInterface* ui, fg::Fridgecloud* cloud);
void showSmartSocketsUi(fg::UserInterface* ui, fg::Fridgecloud* cloud);
void showTerpCamUi(fg::UserInterface* ui, fg::Fridgecloud* cloud);
bool sendSmartSocketPower(const std::string& role, bool turn_on);
void wifiReportSmartSocketOutputs(const SmartSocketOutputStates& states);
void wifiForceAllSmartSocketsOff();

// Reports the aux-device state (paired smart sockets, Terp Cam URL) to the
// cloud via hardware-info logs. Log messages are queued, so this is safe to
// call before the cloud connection is up (and without any network at all).
void wifiInitAuxCloudReporting(fg::Fridgecloud* cloud);

// Removes a paired smart socket by role. Idempotent for known roles: removing
// an unpaired role just re-reports the current state. Returns false only for
// unknown roles.
bool wifiRemoveSmartSocket(const std::string& role);

// Assigns/updates a socket by IP (cloud-managed, e.g. a foreign Tasmota plug
// that was never paired via the AP flow). Empty password keeps the default
// admin/mqtt_pass credentials; otherwise user+password are stored per role.
bool wifiSetSmartSocket(const std::string& role, const std::string& ip, const std::string& user, const std::string& password);

// Pulses a connected socket ON for ~2s and back OFF (blocking, watchdog-fed).
// The control loop re-asserts the desired state within its resend window.
bool wifiTestSmartSocket(const std::string& role);
