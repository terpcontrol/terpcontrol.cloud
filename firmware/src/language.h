#pragma once

#include "fghmi.h"

namespace fg {

  // The display language is a device-only setting chosen on the device
  // itself, not part of the cloud-synced configuration.
  void languageLoad();
  bool languageIsSet();

  void showLanguagePrompt(UserInterface* ui);

  // The menus hold their labels as copied strings, so after a language
  // change the main menu underneath is closed and reopenMainMenu builds it anew.
  void showSettingsUi(UserInterface* ui, std::function<void()> reopenMainMenu);

}
