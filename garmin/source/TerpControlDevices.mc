import Toybox.Lang;
import Toybox.Application.Storage;

// Knowledge about the Terp Control device types: which measurements each type
// reports, how they are labelled and in which order they are presented.
(:glance)
class TerpControlDevices {
    // Order used for the chart pages and when cycling the highlighted series.
    private static var SERIES_ORDER as Array = [
        "temperature",
        "humidity",
        "vpd",
        "co2",
        "out_heater",
        "out_dehumidifier",
        "out_co2",
        "out_light",
    ];

    // Order used for the list of latest values.
    private static var VALUES_ORDER as Array = [
        "co2",
        "humidity",
        "temperature",
        "out_light",
        "out_dehumidifier",
        "out_heater",
        "out_co2",
        "vpd",
    ];

    // Order used for the glance, which only has room for a handful of values.
    private static var GLANCE_ORDER as Array = [
        "temperature",
        "humidity",
        "co2",
        "out_light",
        "out_dehumidifier",
        "vpd",
    ];

    // Measurements reported per device type. Mirrors the measure/type mapping the
    // cloud webapp uses for its charts; types the hardware never sends are left out
    // so they don't show up as "n/a".
    private static var SUPPORTED as Dictionary = {
        "fridge" => ["temperature", "humidity", "vpd", "co2", "out_heater", "out_dehumidifier", "out_co2", "out_light"],
        "fridge2" => ["temperature", "humidity", "vpd", "co2", "out_heater", "out_dehumidifier", "out_co2", "out_light"],
        "controller" => ["temperature", "humidity", "vpd", "co2", "out_heater", "out_dehumidifier", "out_co2", "out_light"],
        "dryer" => ["temperature", "humidity", "vpd", "out_heater", "out_dehumidifier"],
        "light" => ["temperature", "humidity", "vpd", "out_light"],
        "plug" => ["temperature", "humidity", "vpd", "co2"],
        "fan" => ["temperature", "humidity", "vpd"],
    };

    // Every device type reports the ambient values, so they are a safe fallback for
    // hardware this version doesn't know about yet.
    private static var DEFAULT_SUPPORTED as Array = ["temperature", "humidity", "vpd"];

    private static var TYPE_TO_LABEL as Dictionary = {
        "co2" => "CO2",
        "humidity" => "Humidity",
        "temperature" => "Temperature",
        "out_light" => "Lights",
        "out_dehumidifier" => "Dehumidifier",
        "out_heater" => "Heater",
        "out_co2" => "CO2 Valve",
        "vpd" => "VPD",
    };

    private static var DEVICE_TYPE_TO_LABEL as Dictionary = {
        "fridge" => "Fridge",
        "fridge2" => "Fridge",
        "controller" => "Controller",
        "dryer" => "Dryer",
        "light" => "Light",
        "plug" => "Smart Socket",
        "fan" => "Fan",
    };

    static function seriesTypes(deviceType as String?) as Array {
        return supportedOf(SERIES_ORDER, deviceType);
    }

    static function valueTypes(deviceType as String?) as Array {
        return supportedOf(VALUES_ORDER, deviceType);
    }

    static function glanceTypes(deviceType as String?) as Array {
        return supportedOf(GLANCE_ORDER, deviceType);
    }

    static function supports(deviceType as String?, type as String) as Boolean {
        return contains(supportedTypes(deviceType), type);
    }

    static function label(type as String) as String {
        return TYPE_TO_LABEL.hasKey(type) ? TYPE_TO_LABEL[type] : type;
    }

    static function deviceTypeLabel(deviceType as String?) as String {
        if (deviceType == null) {
            return "Device";
        }
        return DEVICE_TYPE_TO_LABEL.hasKey(deviceType) ? DEVICE_TYPE_TO_LABEL[deviceType] : deviceType;
    }

    static function contains(list as Array, value as String) as Boolean {
        for (var i = 0; i < list.size(); i++) {
            if (list[i].equals(value)) {
                return true;
            }
        }
        return false;
    }

    // View state (selected chart period, highlighted series) is kept per device so
    // switching devices restores what was last looked at on that device.
    static function stateKey(key as String) as String {
        var deviceId = Storage.getValue("selectedDeviceId");
        return deviceId != null ? key + "_" + deviceId : key;
    }

    private static function supportedTypes(deviceType as String?) as Array {
        if (deviceType != null && SUPPORTED.hasKey(deviceType)) {
            return SUPPORTED[deviceType];
        }
        return DEFAULT_SUPPORTED;
    }

    private static function supportedOf(order as Array, deviceType as String?) as Array {
        var supported = supportedTypes(deviceType);
        var result = [];
        for (var i = 0; i < order.size(); i++) {
            if (contains(supported, order[i])) {
                result.add(order[i]);
            }
        }
        return result;
    }
}
