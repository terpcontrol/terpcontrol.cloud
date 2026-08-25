#pragma once

#define SSD1306_NO_SPLASH
#define SCREEN_WIDTH 128 // OLED display width, in pixels
#define SCREEN_HEIGHT 64 // OLED display height, in pixels

#include <SPI.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

#include <unordered_map>
#include <functional>
#include <memory>
#include <vector>

namespace fg {

  class UserInterface;

  // The ui loop runs ten times a second (UI_TICK_INTERVAL in main.cpp), and
  // idle limits are counted in those ticks rather than milliseconds because
  // that is what the loop has to hand.
  static constexpr unsigned int UI_TICKS_PER_SECOND = 10;
  static constexpr unsigned int MAX_IDLE_TICKS = UI_TICKS_PER_SECOND * 30;

  class MenuItem {
  protected:
  public:
    bool visible = true;
    bool editing = false;
    bool changed = false;
    virtual void draw() = 0;
    virtual void prev() = 0;
    virtual void next() = 0;
    virtual void enter() = 0;
    virtual void hold() = 0;

    /** How long the display stays lit on this screen with nobody turning the
     *  knob. Half a minute suits a screen somebody is standing in front of;
     *  one that sends them off to do something elsewhere can ask for longer. */
    virtual unsigned int idleTicks() const { return MAX_IDLE_TICKS; }

    virtual ~MenuItem();
  };


  enum UiAction {
    NONE, PREV, NEXT, ENTER, HOLD
  };

  class UserInterface {

    UiAction current_action = UiAction::NONE;

    std::vector<MenuItem*> items;
    std::vector<MenuItem*> delete_items;
    std::function<void(void)> change_listener;

    unsigned int idle_ticks = 0;

  public:
    static Adafruit_SSD1306 display;

    UserInterface();

    void init();
    void loop();

    template<class T, class... Args>
    T* push(Args... args) {
      auto item = new T(args...);
      items.push_back(reinterpret_cast<MenuItem*>(item));
      return item;
    }

    void pop();
    void cleanup();

    template<class T>
    void onChange(T&& fn) {
      change_listener = fn;
    }

    void prev() { current_action = UiAction::PREV; }
    void next() { current_action = UiAction::NEXT; }
    void enter() { current_action = UiAction::ENTER; }
    void hold() { current_action = UiAction::HOLD; }
    bool isIdle() const { return idle_ticks >= MAX_IDLE_TICKS; }
  };

  void printCentered(const char* text, uint8_t y);
}