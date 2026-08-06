import Toybox.Graphics;
import Toybox.WatchUi;
import Toybox.System;
import Toybox.Communications;
import Toybox.Lang;
import Toybox.Time.Gregorian;
import Toybox.Time;
import Toybox.Math;

class TerpControlValuesView extends WatchUi.View {
    private var _latestValues as Dictionary?;
    private var _deviceType as String?;
    private var _error as String?;

    function initialize() {
        View.initialize();
    }

    // Load your resources here
    function onLayout(dc as Dc) as Void {
    }

    function onShow() as Void {
    }

    function onUpdate(dc as Dc) as Void {
        View.onUpdate(dc);
        dc.clear();

        if (_error != null) {
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(dc.getWidth() / 2, dc.getHeight() / 2, Graphics.FONT_XTINY, "Error: " + _error, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
            return;
        }

        if (_latestValues == null) {
            var icon = WatchUi.loadResource(Rez.Drawables.LauncherIcon);
            dc.drawBitmap((dc.getWidth() - icon.getWidth()) / 2, (dc.getHeight() - icon.getHeight()) / 2, icon);
            return;
        }

        var types = TerpControlDevices.valueTypes(_deviceType);
        var lines = [];
        for (var i = 0; i < types.size(); i++) {
            var type = types[i];
            lines.add(TerpControlDevices.label(type) + ": " + TerpControlUtils.valueToDisplay(_latestValues[type], type, true));
        }
        var message = TerpControlUtils.join(lines, "\n");

        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.drawText((dc.getWidth() - dc.getTextWidthInPixels("Temperature: 00°C", Graphics.FONT_XTINY)) / 2, dc.getHeight() / 2, Graphics.FONT_XTINY, message, Graphics.TEXT_JUSTIFY_LEFT | Graphics.TEXT_JUSTIFY_VCENTER);
    }

    function onHide() as Void {
    }

    function onDeviceResolved(device as Dictionary) as Void {
        _deviceType = device["type"];
    }

    function onLatestValuesLoaded(values as Dictionary) as Void {
        _latestValues = values;
        _error = null;
        WatchUi.requestUpdate();
    }

    function onError(error as String) as Void {
        _error = error;
        WatchUi.requestUpdate();
    }
}
