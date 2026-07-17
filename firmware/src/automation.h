#pragma once

#include "fridgecloud.h"
#include "fghmi.h"
#include <memory>

namespace fg {

  // Overflow-safe "has this absolute tick deadline passed?" check. A plain
  // `deadline < xTaskGetTickCount()` breaks when the FreeRTOS tick counter
  // wraps (~49.7 days at 1 kHz). The signed modular difference stays correct
  // as long as the deadline is less than ~24 days away.
  inline bool tickPassed(TickType_t deadline) {
    return (int32_t)(xTaskGetTickCount() - deadline) > 0;
  }

  class AutomationController {
  public:
    virtual void init() = 0;
    virtual void loop() = 0;
    virtual void fastloop() = 0;
    virtual void initStatusMenu(UserInterface* ui) = 0;
    virtual void initSettingsMenu(UserInterface* ui) = 0;

    // Whether the device is currently driving a grow light (directly or via
    // a smart socket). The connection-loss reboot watchdog in main.cpp
    // (see rebootwatchdog.h) can optionally be restricted to only reboot
    // while this returns false, so it never interrupts the photoperiod.
    // Controllers without a light output keep the default.
    virtual bool isLightOn() { return false; }
  };

  std::unique_ptr<AutomationController> createController(Fridgecloud& cloud);


  class TestingController {
  public:
    virtual void init() = 0;
    virtual void loop() = 0;
    virtual void fastloop() = 0;
  };

  std::unique_ptr<TestingController> createTestingController(UserInterface* ui);

}