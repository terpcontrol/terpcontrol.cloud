#pragma once

#include "fridgecloud.h"
#include <SensirionI2CScd4x.h>
#include "SHTSensor.h"
#include "output.h"
#include "automation.h"

#include "fghmi.h"
#include "pid.h"


namespace fg {

  struct ControllerControllerSettings {

    // "full" (Big Plant) was removed on the controller. The constant is kept
    // only to map legacy settings to MODE_SMALL in loadSettings().
    static constexpr const char* MODE_FULL = "full";
    static constexpr const char* MODE_SMALL = "small";
    static constexpr const char* MODE_TEMP = "temp";
    static constexpr const char* MODE_DRY = "dry";
    static constexpr const char* MODE_BREED = "breed";
    static constexpr const char* MODE_OFF = "off";

    struct {
      uint32_t day = 21600;
      uint32_t night = 79200;
	  float maxDehumidifySeconds = 0;
      float targetHumidityDiff = 5.0;
      float useLongHumidityAvg = 1.0;
      uint32_t minimalDehumidifierOffTime = 240;
    } daynight;

    struct {
      float target = 300;
    } co2;

    // The cabinet heater is a smart socket (mains relay), so it is driven by
    // hysteresis instead of a duty cycle. The dwell times keep the relay and
    // the socket's HTTP uplink from being switched faster than they can
    // usefully follow; see the note on minOffTime in controlHeater().
    struct {
      float hysteresis = 0.5;
      float dehumidifyLimit = 1.0;
      float dehumidifyAssist = 1.0;
      // How far above the fridge's give-up point the heater starts assisting.
      // The heater's warmth arrives late — roughly 1 C of overrun measured on
      // the test cabinet — so starting it at the give-up point itself only
      // lands once the temperature has already fallen through.
      //
      // Defaults to 0, which reproduces the previous behaviour: assisting never
      // actually engages. Existing cabinets therefore keep running exactly as
      // before after an update, and the lead has to be dialled in deliberately.
      float assistLead = 0.0;
      float minOnTime = 60;
      float minOffTime = 120;
    } heater;

    struct {
      float temperature = 25.0;
      float humidity = 60.0;
    } day;

    struct {
      float temperature = 25.0;
      float humidity = 60.0;
    } night;

    String workmode = MODE_OFF;

    struct {
      float sunrise = 15.0;
      float sunset = 15.0;
      float limit = 100.0;
	  float maintenanceOn = 0;
    } lights;

    void print() const;

  };


  class ControllerController : public AutomationController {
    static constexpr uint8_t PIN_LIGHT = 21;


    static constexpr uint8_t PIN_SDA = 23;
    static constexpr uint8_t PIN_SCL = 22;

    static constexpr uint8_t PIN_SENSOR_I2CSCL = 4;
    static constexpr uint8_t PIN_SENSOR_I2CSDA = 15;
    static constexpr uint32_t SENSOR_I2C_FRQ = 10000;
	
	static constexpr uint8_t SENSOR_TYPE_NONE = 0;
    static constexpr uint8_t SENSOR_TYPE_SHT = 1;
    static constexpr uint8_t SENSOR_TYPE_SCD = 2;
    static constexpr uint8_t SENSOR_TYPE_SLAVE = 3;

    static constexpr float LIGHT_TEMP_HYST = 1.0f;
    static constexpr float LIGHT_TEMP_OFF_OFFSET = 5.0f;
    static constexpr float LIGHT_MIN_DIM = 0.15f;
    static constexpr float LIGHT_CONTROL_SPEED = 0.01f;

    static constexpr int CO2_SAMPLE_DELAY = 100;
    static constexpr int WARN_LEVEL_CO2_MIN = 100;

    // Re-arm band for the dehumidify temperature override. Once the fridge has
    // pulled the temperature down to the limit, it stays suspended until the
    // room has recovered this far above it again.
    static constexpr float DEHUMIDIFY_OVERRIDE_HYST = 1.0f;

    static constexpr TickType_t CO2_INJECT_PERIOD = configTICK_RATE_HZ * 120.0;
    static constexpr TickType_t CO2_INJECT_DURATION = configTICK_RATE_HZ * 2.0;
    static constexpr TickType_t CO2_INJECT_DELAY = configTICK_RATE_HZ * 120.0;
    static constexpr float CO2_LEVEL_CRITICAL = 200.0;
    static constexpr float CO2_OVERSWING_ABORT = 300.0;

    static constexpr float MAX_SENSOR_DEVIATION = 15.0;

    Fridgecloud& cloud;
    SensirionI2CScd4x scd4x;
    SHTSensor sht21;

    PwmOutput out_light;

    float co2_turnoff_value = 0.0f;
    uint32_t co2_turnoff_time = 0;
    uint32_t stuck_count = 0;
    uint8_t co2_low_count = 0;

    // CO2 valve is actuated via a smart socket (no physical pin). This is the
    // logical open/closed state the socket command is derived from.
    bool co2_valve_open = false;

    TickType_t co2_inject_start = 0;
    TickType_t co2_inject_end = 0;
    TickType_t co2_valve_close = 0;
    TickType_t pause_start_tick = 0;
    TickType_t pause_duration_ticks = 0;   // 0 == not paused

    Avg<100> humidity_avg_short;
    Avg<240> humidity_avg_long;
    Avg<20> co2_avg;

    ControllerControllerSettings settings;

    bool is_legacy_board = false;
    bool sensors_valid = false;
    bool co2_warning_triggered = false;
    bool sensor_deviation_logged = false;
    bool sensor_fail_logged = false;

    struct {
      bool is_day;
      uint32_t timeofday;
	  
	  uint8_t sensor_type = 0; // plug

      float temperature = 0;
      float humidity = 0;
      float co2 = 0;

      float out_heater = 0;
      float out_dehumidifier = 0;
      float out_light = 0;
      uint32_t out_co2 = 0;
    } state;

    // Tick of the last heater relay transition, for the dwell times. Compared
    // with the same overflow-safe modular difference as isPaused().
    TickType_t heater_last_change_tick = 0;

    // Overflow-safe maintenance-pause check. Comparing absolute ticks breaks
    // when xTaskGetTickCount() wraps (~49.7 days at 1 kHz); the modular
    // difference stays correct as long as the pause duration is < ~24 days.
    // Clears the duration once expired so a later tick rollover can't
    // re-trigger a long-finished pause.
    bool isPaused() {
      if (pause_duration_ticks == 0) return false;
      if ((xTaskGetTickCount() - pause_start_tick) < pause_duration_ticks) return true;
      pause_duration_ticks = 0;
      return false;
    }

    void updateSensors();
    void checkDayCycle();
    void controlCo2();
    void controlLight();
    void controlDehumidifier();
    void controlCooling();
    void controlHeater();
	bool initSensor();
	bool hasCo2Sensor();
	void checkLimits(uint8_t output);

  public:
    ControllerController(Fridgecloud& cloud);
    void init() override;
    void loop() override;
    void fastloop() override;
    void initStatusMenu(UserInterface* ui) override;
    void initSettingsMenu(UserInterface* ui) override;
    bool isLightOn() override { return state.out_light > 0; }
    void loadSettings(const String& settings);
    void saveAndUploadSettings();

  };

}
