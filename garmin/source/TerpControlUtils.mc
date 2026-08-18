import Toybox.Graphics;
import Toybox.Math;
import Toybox.Lang;
import Toybox.Time.Gregorian;
import Toybox.Time;

class TerpControlUtils {
    (:glance)
    public static var TYPE_TO_UNIT = {
        "co2" => "ppm",
        "temperature" => "°C",
        "humidity" => "%",
        "out_light" => "%",
        "out_dehumidifier" => "%",
        "out_co2" => "%",
        "out_heater" => "%",
        "vpd" => "kPa",
    };

    (:glance)
    public static var TYPE_TO_SCALE = {
        "co2" => null,
        "temperature" => null,
        "humidity" => 100,
        "out_light" => 100,
        "out_dehumidifier" => 1,
        "out_co2" => 1,
        "out_heater" => 1,
        "vpd" => 2,
    };

    (:glance)
    static function parseISODate(date) {
        if (date.length() < 20) {
            return null;
        }

        var moment = Gregorian.moment({
            :year => date.substring( 0, 4).toNumber(),
            :month => date.substring( 5, 7).toNumber(),
            :day => date.substring( 8, 10).toNumber(),
            :hour => date.substring(11, 13).toNumber(),
            :minute => date.substring(14, 16).toNumber(),
            :second => date.substring(17, 19).toNumber()
        });
        var suffix = date.substring(19, date.length());

        // skip over to time zone
        var tz = 0;
        if (suffix.substring(tz, tz + 1).equals(".")) {
            while (tz < suffix.length()) {
                var first = suffix.substring(tz, tz + 1);
                if ("-+Z".find(first) != null) {
                    break;
                }
                tz++;
            }
        }

        if (tz >= suffix.length()) {
            // no timezone given
            return null;
        }

        var tzOffset = 0;
        if (!suffix.substring(tz, tz + 1).equals("Z")) {
            // +HH:MM
            if (suffix.length() - tz < 6) {
                return null;
            }
            tzOffset = suffix.substring(tz + 1, tz + 3).toNumber() * Gregorian.SECONDS_PER_HOUR;
            tzOffset += suffix.substring(tz + 4, tz + 6).toNumber() * Gregorian.SECONDS_PER_MINUTE;

            var sign = suffix.substring(tz, tz + 1);
            if (sign.equals("+")) {
                tzOffset = -tzOffset;
            } else if (sign.equals("-") && tzOffset == 0) {
                // -00:00 denotes unknown timezone
                return null;
            }
        }
        return moment.add(new Time.Duration(tzOffset));
    }

    (:glance)
    static function valueToDisplay(value as Number, type as String, longUnit as Boolean) as String {
        var unit = TYPE_TO_UNIT[type] as String;
        if (value == null) {
            return "...";
        } else if (value < 0) {
            return "n/a" + (longUnit || unit.length() < 3 ? " " + unit : "");
        }
        var scale = TYPE_TO_SCALE[type] as Number;
        if (scale == null || scale > 1) {
            var roundedValue;
            if (scale != null && scale > 1 && scale <= 2) {
                roundedValue = ((100 * value).toNumber().toFloat() / 100).format("%.2f");
            } else {
                roundedValue = Math.round(value).toNumber();
            }

            return roundedValue + (longUnit || unit.length() < 3 ? unit : "");
        } else if (value >= 1) {
            return "ON";
        } else if (value <= 0) {
            return "OFF";
        } else {
            return Math.round(value * 100.0).toNumber() + (longUnit || unit.length() < 3 ? unit : "");
        }
    }

    (:glance)
    static function join(parts as Array, separator as String) as String {
        var result = "";
        for (var i = 0; i < parts.size(); i++) {
            result += (i > 0 ? separator : "") + parts[i];
        }
        return result;
    }
}
