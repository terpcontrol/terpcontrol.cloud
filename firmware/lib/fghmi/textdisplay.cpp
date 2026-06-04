#include "textdisplay.h"

#include <sstream>
#include <iomanip>
namespace fg {

  TextDisplay::TextDisplay(std::string text, uint8_t scale, std::function<void(void)> callback, uint32_t timeout_ms)
    : text(text), name(""), scale(scale), callback(callback), timeout_ms(timeout_ms) {}

  TextDisplay::TextDisplay(std::string text, std::string name, uint8_t scale, std::function<void(void)> callback, uint32_t timeout_ms)
    : text(text), name(name), scale(scale), callback(callback), timeout_ms(timeout_ms) {}


  void TextDisplay::draw() {
    UserInterface::display.setTextColor(SSD1306_WHITE); // Draw white text

    UserInterface::display.setTextSize(1);
    printCentered(name.c_str(), 10);

    // display.setFont(&FONT_VALUE);
    UserInterface::display.setTextSize(scale);
    printCentered(text.c_str(), 30);

    UserInterface::display.setTextSize(1);

    if(timeout_ms && !dismissed) {
      uint32_t now = millis();
      if(shown_at == 0) {
        shown_at = now;
      }
      else if(now - shown_at >= timeout_ms) {
        dismissed = true;
        if(callback) {
          callback();
        }
      }
    }
  }

  void TextDisplay::prev() {}
  void TextDisplay::next() {}
  void TextDisplay::enter() {
    if(callback) {
      callback();
    }
  }
  void TextDisplay::hold() {}

}
