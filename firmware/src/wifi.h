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
void showWifiUi(fg::UserInterface* ui, fg::Fridgecloud* cloud);
void showSmartSocketsUi(fg::UserInterface* ui, fg::Fridgecloud* cloud);
bool sendSmartSocketPower(const std::string& role, bool turn_on);
void wifiReportSmartSocketOutputs(const SmartSocketOutputStates& states);
