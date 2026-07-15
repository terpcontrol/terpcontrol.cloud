#include "rebootwatchdog.h"
#include "settings.h"

#include <cstdio>

namespace fg {

  // "rbt_init_min" stores (index + 1), where index is the position in
  // initialTimeoutOptions() (0 = off, 1..40 = 15..600 min in 15 min steps).
  // The raw value 0 means "never configured on this device" and keeps the
  // original hardcoded 15 minute default so existing devices don't silently
  // lose the watchdog after a firmware update.
  static constexpr uint8_t INITIAL_MINUTES_STEP = 15;
  static constexpr uint8_t INITIAL_MINUTES_MAX_STEPS = 40; // 40 * 15 min = 10 h
  static constexpr uint32_t INITIAL_MINUTES_DEFAULT_INDEX = 1; // 15 min, legacy default

  static std::string formatMinutes(uint16_t minutes) {
    char buf[16];
    if(minutes < 60) {
      snprintf(buf, sizeof(buf), "%u min", minutes);
    }
    else if(minutes % 60 == 0) {
      snprintf(buf, sizeof(buf), "%u h", minutes / 60);
    }
    else {
      snprintf(buf, sizeof(buf), "%uh%02um", minutes / 60, minutes % 60);
    }
    return buf;
  }

  static std::vector<std::string> initialTimeoutOptions() {
    std::vector<std::string> options;
    options.push_back("off");
    for(uint8_t step = 1; step <= INITIAL_MINUTES_MAX_STEPS; step++) {
      options.push_back(formatMinutes((uint16_t)step * INITIAL_MINUTES_STEP));
    }
    return options;
  }

  static uint32_t initialTimeoutIndex() {
    uint8_t raw = fg::settings().getU8("rbt_init_min");
    return raw == 0 ? INITIAL_MINUTES_DEFAULT_INDEX : (uint32_t)(raw - 1);
  }

  int rebootWatchdogInitialMinutes() {
    uint32_t index = initialTimeoutIndex();
    return (int)(index * INITIAL_MINUTES_STEP);
  }

  bool rebootWatchdogInitialLightsOffOnly() {
    // Default off: matches the previous unconditional 15 minute watchdog.
    return fg::settings().getU8("rbt_init_lt") != 0;
  }

  bool rebootWatchdogDailyEnabled() {
    // "rbt_daily_dis" is a disable flag so the unset (0) default keeps the
    // daily recovery reboot enabled, matching prior hardcoded behavior.
    return fg::settings().getU8("rbt_daily_dis") == 0;
  }

  bool rebootWatchdogDailyLightsOffOnly() {
    // "rbt_daily_nlt" ("not lights-gated") so the unset (0) default keeps
    // the daily reboot restricted to lights-off, matching prior behavior.
    return fg::settings().getU8("rbt_daily_nlt") == 0;
  }

  void showRebootWatchdogUi(UserInterface* ui) {
    auto menu = ui->push<SelectMenu>();
    menu->addOption("back...", [ui](){ ui->pop(); });

    menu->addOption("Reboot Timeout", [ui](){
      ui->push<SelectInput>("Reboot after loss", initialTimeoutIndex(), initialTimeoutOptions(), [ui](uint32_t index) {
        fg::settings().setU8("rbt_init_min", (uint8_t)(index + 1));
        fg::settings().commit();
        ui->pop();
      });
    });

    menu->addOption("Timeout: Lights Off", [ui](){
      uint32_t current = rebootWatchdogInitialLightsOffOnly() ? 1 : 0;
      ui->push<SelectInput>("Only while lights off", current, std::vector<std::string>{"no", "yes"}, [ui](uint32_t selected) {
        fg::settings().setU8("rbt_init_lt", (uint8_t)selected);
        fg::settings().commit();
        ui->pop();
      });
    });

    menu->addOption("Daily Reboot", [ui](){
      uint32_t current = rebootWatchdogDailyEnabled() ? 1 : 0;
      ui->push<SelectInput>("Daily reboot", current, std::vector<std::string>{"off", "on"}, [ui](uint32_t selected) {
        fg::settings().setU8("rbt_daily_dis", selected == 0 ? 1 : 0);
        fg::settings().commit();
        ui->pop();
      });
    });

    menu->addOption("Daily: Lights Off", [ui](){
      uint32_t current = rebootWatchdogDailyLightsOffOnly() ? 1 : 0;
      ui->push<SelectInput>("Only while lights off", current, std::vector<std::string>{"no", "yes"}, [ui](uint32_t selected) {
        fg::settings().setU8("rbt_daily_nlt", selected == 0 ? 1 : 0);
        fg::settings().commit();
        ui->pop();
      });
    });
  }

}
