#include "dashboard.h"
#include "icons.h"

#include <sstream>
#include <iomanip>
#include <wifi.h>


namespace fg {
  Dashboard::Dashboard(float* temperature, float* humidity, float* light, bool* day) :
    temperature(temperature), humidity(humidity), light(light), day(day) {}


  void Dashboard::draw() {
    UserInterface::display.setTextColor(SSD1306_WHITE); // Draw white text
    UserInterface::display.setTextSize(1);

    // Until the sensor has given a reading both are NAN, drawn as dashes
    // rather than as "nan".
    std::stringstream value_print;
    UserInterface::display.drawBitmap(1, 1, ICON_TEMPERATURE, 16, 16, SSD1306_WHITE);
    if(isnan(*temperature)) {
      value_print << "--";
    }
    else {
      value_print << std::fixed << std::setprecision(1) << *temperature;
    }
    value_print << "C";
    UserInterface::display.setCursor(18, 4);
    UserInterface::display.write(value_print.str().c_str());

    value_print.str(std::string());
    UserInterface::display.drawBitmap(60, 1, ICON_HUMIDITY, 16, 16, SSD1306_WHITE);
    if(isnan(*humidity)) {
      value_print << "--";
    }
    else {
      value_print << std::fixed << std::setprecision(1) << *humidity;
    }
    value_print << "%";
    UserInterface::display.setCursor(78, 4);
    UserInterface::display.write(value_print.str().c_str());

    UserInterface::display.setCursor(50, 40);
    UserInterface::display.setTextSize(2);
    value_print.str(std::string());
    value_print << std::fixed << std::setprecision(0) << (*light) << "%";
    UserInterface::display.write(value_print.str().c_str());

    auto rssi = WiFi.RSSI();

    if(rssi == 0) {
      UserInterface::display.drawBitmap(110, 1, ICON_WIFI_NONE, 16, 16, SSD1306_WHITE);
    }
    else if(rssi > -60) {
      UserInterface::display.drawBitmap(110, 1, ICON_WIFI_FULL, 16, 16, SSD1306_WHITE);
    }
    else if (rssi > -80) {
      UserInterface::display.drawBitmap(110, 1, ICON_WIFI_MED, 16, 16, SSD1306_WHITE);
    }
    else {
      UserInterface::display.drawBitmap(110, 1, ICON_WIFI_LOW, 16, 16, SSD1306_WHITE);
    }


    if(*day) {
      UserInterface::display.drawBitmap(110, 21, ICON_DAY, 16, 16, SSD1306_WHITE);
    }
    else {
      UserInterface::display.drawBitmap(110, 21, ICON_NIGHT, 16, 16, SSD1306_WHITE);
    }
  }

  void Dashboard::prev() {}
  void Dashboard::next() {}
  void Dashboard::enter() {
    if(callback) {
      callback();
    }
  }
  void Dashboard::hold() {}

}