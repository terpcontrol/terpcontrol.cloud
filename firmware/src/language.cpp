#include "language.h"
#include "settings.h"

namespace fg {

  static constexpr const char* LANGUAGE_NVS_KEY = "ui_lang";

  static const std::vector<std::string> LANGUAGE_OPTIONS{"English", "Deutsch"};

  void languageLoad() {
    setLanguage(settings().getU8(LANGUAGE_NVS_KEY) == (uint8_t)Lang::DE ? Lang::DE : Lang::EN);
  }

  bool languageIsSet() {
    return settings().has(LANGUAGE_NVS_KEY);
  }

  static void saveLanguage(uint32_t selected) {
    Lang lang = selected == 1 ? Lang::DE : Lang::EN;
    setLanguage(lang);
    // A write to a full settings partition aborts inside the NVS driver;
    // the choice then only lasts until the next reboot.
    if(settings().freeEntries() >= 2) {
      settings().setU8(LANGUAGE_NVS_KEY, (uint8_t)lang);
      settings().commit();
    }
  }

  void showLanguagePrompt(UserInterface* ui) {
    ui->push<SelectInput>("Language / Sprache", 0, LANGUAGE_OPTIONS, [ui](uint32_t selected) {
      saveLanguage(selected);
      ui->pop();
    });
  }

  void showSettingsUi(UserInterface* ui, std::function<void()> reopenMainMenu) {
    auto menu = ui->push<SelectMenu>();
    menu->addOption(tr(Text::BACK_MENU), [ui](){ ui->pop(); });

    menu->addOption(tr(Text::LANGUAGE), [ui, reopenMainMenu](){
      ui->push<SelectInput>(tr(Text::LANGUAGE), (uint32_t)language(), LANGUAGE_OPTIONS, [ui, reopenMainMenu](uint32_t selected) {
        saveLanguage(selected);
        ui->pop();
        ui->pop();
        ui->pop();
        reopenMainMenu();
      });
    });
  }

}
