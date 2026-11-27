#pragma once

#include "fghmi.h"

namespace fg {

  // Daily recovery reboot while the cloud stays unreachable: local,
  // device-only settings configured through the on-device menu
  // (showRebootWatchdogUi below). Deliberately NOT part of the cloud-synced
  // configuration JSON.

  // Whether a once-a-day recovery reboot is attempted while an outage
  // persists, and whether it may only happen while the light output is off.
  bool rebootWatchdogDailyEnabled();
  bool rebootWatchdogDailyLightsOffOnly();

  void showRebootWatchdogUi(UserInterface* ui);

}
