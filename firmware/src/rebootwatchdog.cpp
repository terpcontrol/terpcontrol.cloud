#include "rebootwatchdog.h"
#include "settings.h"

namespace fg {

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
