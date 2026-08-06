import Toybox.Graphics;
import Toybox.WatchUi;
import Toybox.System;
import Toybox.Communications;
import Toybox.Lang;
import Toybox.Time.Gregorian;
import Toybox.Time;
import Toybox.Math;
import Toybox.Application.Properties;

(:glance)
class TerpControlGlanceView extends WatchUi.GlanceView {
    private var _api as TerpControlApi;
    private var _latestValues as Dictionary?;
    private var _deviceType as String?;
    private var _error as String?;

    function initialize() {
        GlanceView.initialize();

        // The glance follows whichever device was last selected in the app.
        _api = new TerpControlApi(self);
        _api.loadLatestValues(true);
    }

    // Load your resources here
    function onLayout(dc as Dc) as Void {
    }

    function onShow() as Void {
    }

    function onUpdate(dc as Dc) as Void {
        View.onUpdate(dc);
        dc.clear();
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);

        var message = "Terp Control";

        if (_error != null) {
            message += "\nError: " + _error;
        } else if (_latestValues == null) {
            message += "\nLoading...\n";
        } else {
            if (TerpControlDevices.supports(_deviceType, "out_dehumidifier")) {
                message += " (" + display("out_dehumidifier") + ")";
            }

            var sensors = [];
            if (TerpControlDevices.supports(_deviceType, "temperature")) {
                sensors.add(display("temperature"));
            }
            if (TerpControlDevices.supports(_deviceType, "humidity")) {
                sensors.add(display("humidity"));
            }
            if (TerpControlDevices.supports(_deviceType, "co2")) {
                sensors.add(display("co2"));
            }

            var outputs = [];
            if (TerpControlDevices.supports(_deviceType, "out_light")) {
                outputs.add("Lights: " + display("out_light"));
            }
            if (TerpControlDevices.supports(_deviceType, "vpd")) {
                outputs.add("VPD: " + display("vpd"));
            }

            message += "\n" + TerpControlUtils.join(sensors, " | ") + "\n" + TerpControlUtils.join(outputs, " | ");

            if (isOutOfBounds("temperature", "threshold_temp_min_prop", "threshold_temp_max_prop")
                || isOutOfBounds("humidity", "threshold_humidity_min_prop", "threshold_humidity_max_prop")
                || isOutOfBounds("co2", "threshold_co2_min_prop", "threshold_co2_max_prop")) {
                dc.setColor(Graphics.COLOR_RED, Graphics.COLOR_BLACK);
            }
        }

        dc.drawText(0, dc.getHeight() / 2, Graphics.FONT_XTINY, message, Graphics.TEXT_JUSTIFY_LEFT | Graphics.TEXT_JUSTIFY_VCENTER);
    }

    function onHide() as Void {
    }

    function onDeviceResolved(device as Dictionary) as Void {
        _deviceType = device["type"];
    }

    function onLatestValuesLoaded(values as Dictionary) as Void {
        _latestValues = values;
        WatchUi.requestUpdate();
    }

    function onError(error as String) as Void {
        _error = error;
        WatchUi.requestUpdate();
    }

    private function display(type as String) as String {
        return TerpControlUtils.valueToDisplay(_latestValues[type], type, true);
    }

    private function isOutOfBounds(type as String, minProperty as String, maxProperty as String) as Boolean {
        var value = _latestValues[type];
        if (value == null) {
            return false;
        }
        return value <= Properties.getValue(minProperty) || value >= Properties.getValue(maxProperty);
    }
}
