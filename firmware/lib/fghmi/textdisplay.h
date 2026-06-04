#pragma once

#include "userinterface.h"

namespace fg {

  class TextDisplay: public MenuItem {
    std::string text;
    std::string name;
    uint8_t scale;
    std::function<void(void)> callback;
    uint32_t timeout_ms;
    uint32_t shown_at = 0;
    bool dismissed = false;
  public:
    TextDisplay(std::string text, uint8_t scale = 1, std::function<void(void)> callback = nullptr, uint32_t timeout_ms = 0);
    TextDisplay(std::string text, std::string name, uint8_t scale = 1, std::function<void(void)> callback = nullptr, uint32_t timeout_ms = 0);

    void draw() override;
    void prev() override;
    void next() override;
    void enter() override;
    void hold() override;
  };

}
