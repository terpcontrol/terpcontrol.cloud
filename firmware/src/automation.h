#pragma once

#include "fridgecloud.h"
#include "fghmi.h"
#include <memory>

namespace fg {

  class AutomationController {
  public:
    virtual void init() = 0;
    virtual void loop() = 0;
    virtual void fastloop() = 0;
    virtual void initStatusMenu(UserInterface* ui) = 0;
    virtual void initSettingsMenu(UserInterface* ui) = 0;

    // Whether the device is currently driving a grow light (directly or via
    // a smart socket). The connection-recovery watchdog in main.cpp only
    // performs its backup reboot while this returns false, so a reboot can
    // never interrupt the photoperiod. Controllers without a light output
    // keep the default.
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