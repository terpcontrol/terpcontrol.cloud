#pragma once

#include "fghmi.h"

namespace fg {

  // Reboot-after-connection-loss watchdog: local, device-only settings
  // configured through the on-device menu (showRebootWatchdogUi below).
  // Deliberately NOT part of the cloud-synced configuration JSON.

  // Minutes the cloud connection may be down before the first recovery
  // reboot. 0 means the feature is switched off.
  int rebootWatchdogInitialMinutes();
  bool rebootWatchdogInitialLightsOffOnly();

  // Whether a once-a-day recovery reboot is attempted while an outage
  // persists, and whether it may only happen while the light output is off.
  bool rebootWatchdogDailyEnabled();
  bool rebootWatchdogDailyLightsOffOnly();

  void showRebootWatchdogUi(UserInterface* ui);

}
