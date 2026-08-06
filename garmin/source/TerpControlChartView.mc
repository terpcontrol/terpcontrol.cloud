import Toybox.Graphics;
import Toybox.WatchUi;
import Toybox.System;
import Toybox.Communications;
import Toybox.Lang;
import Toybox.Time.Gregorian;
import Toybox.Time;
import Toybox.Math;

class TerpControlChartView extends WatchUi.View {
    private var _series as Dictionary?;
    private var _highlight as String?;
    private var _timePeriod as String;
    private var _deviceType as String?;
    private var _error as String?;
    private static var TEXT_MARGIN = 3;

    private static var TYPE_TO_ICON = {
        "co2" => Rez.Drawables.icon_co2,
        "temperature" => Rez.Drawables.icon_temperature,
        "humidity" => Rez.Drawables.icon_humidity,
        "out_light" => Rez.Drawables.icon_light,
        "out_dehumidifier" => Rez.Drawables.icon_dehumidify,
        "out_co2" => Rez.Drawables.icon_co2_valve,
        "out_heater" => Rez.Drawables.icon_heating,
        "vpd" => Rez.Drawables.icon_vpd,
    };

    private static var TYPE_TO_COLOR = {
        "co2" => Graphics.COLOR_GREEN,
        "temperature" => Graphics.COLOR_RED,
        "humidity" => Graphics.COLOR_BLUE,
        "out_light" => Graphics.COLOR_YELLOW,
        "out_dehumidifier" => Graphics.COLOR_DK_BLUE,
        "out_co2" => Graphics.COLOR_DK_GREEN,
        "out_heater" => Graphics.COLOR_DK_RED,
        "vpd" => Graphics.COLOR_GREEN,
    };

    function initialize(timePeriod as String, highlight as String?) {
        _timePeriod = timePeriod;
        _highlight = highlight != null ? highlight : "temperature";
        View.initialize();
    }

    // Load your resources here
    function onLayout(dc as Dc) as Void {
        setLayout(Rez.Layouts.MainLayout(dc));
    }

    function onShow() as Void {
    }

    function onUpdate(dc as Dc) as Void {
        View.onUpdate(dc);

        dc.clear();

        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);

        var graphWidth = dc.getWidth() * 9 / 10;
        var graphHeight = dc.getHeight() * 2 / 5;
        var graphX = (dc.getWidth() - graphWidth) / 2;
        var graphY = (dc.getHeight() - graphHeight) / 2;

        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawLine(graphX, graphY + graphHeight, graphX + graphWidth, graphY + graphHeight);

        var anyDataDrawn = false;
        if (_error != null) {
            dc.drawText(dc.getWidth() / 2, dc.getHeight() / 2, Graphics.FONT_XTINY, "Error: " + _error, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
            anyDataDrawn = true;
        } else if (_series == null) {
            dc.drawText(dc.getWidth() / 2, dc.getHeight() / 2, Graphics.FONT_XTINY, "Loading...", Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
            anyDataDrawn = true;
        } else {
            for (var i = 0; i < _series.keys().size(); i++) {
                var type = _series.keys()[i] as String;
                if (_series[type] != null && !type.equals(_highlight)) {
                    dc.setColor(Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
                    anyDataDrawn = drawGraphLine(dc, type, graphWidth, graphHeight, graphX, graphY) || anyDataDrawn;
                }
            }
        }

        if (_highlight != null) {
            if (_series != null && _series[_highlight] != null) {
                dc.setColor(TYPE_TO_COLOR[_highlight], Graphics.COLOR_TRANSPARENT);
                anyDataDrawn = drawGraphLine(dc, _highlight, graphWidth, graphHeight, graphX, graphY) || anyDataDrawn;
            }

            if (TYPE_TO_ICON.hasKey(_highlight)) {
                dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_WHITE);
                var rectangleHeight = graphY - 15;
                dc.fillRectangle(0, 0, dc.getWidth(), rectangleHeight);
                var icon = WatchUi.loadResource(TYPE_TO_ICON[_highlight]);
                var iconHeight = rectangleHeight - 2 * TEXT_MARGIN;
                var iconWidth = icon.getWidth() * iconHeight / icon.getHeight();
                dc.drawScaledBitmap((dc.getWidth() - iconWidth) / 2, (rectangleHeight - iconHeight) / 2, iconWidth, iconHeight, icon);
            }
        }

        if (!anyDataDrawn) {
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(dc.getWidth() / 2, dc.getHeight() / 2, Graphics.FONT_XTINY, "No data", Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        }

        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(dc.getWidth() / 2, (graphY + graphHeight + 3 * TEXT_MARGIN + dc.getFontHeight(Graphics.FONT_XTINY) * 2 + dc.getHeight()) / 2, Graphics.FONT_TINY, _timePeriod, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
    }

    function drawGraphLine(dc as Dc, type as String, graphWidth as Number, graphHeight as Number, graphX as Number, graphY as Number) as Boolean {
        var seriesData = _series[type] as Array;

        var minTime = null as Time.Moment;
        var maxTime = null as Time.Moment;
        var minValue = null as Number;
        var maxValue = null as Number;
        var latestValue = null as Number;
        var meanValueCount = 0;
        var meanValueSum = 0;
        for (var i = 0; i < seriesData.size(); i++) {
            var time = seriesData[i]["time"] as Time.Moment;
            if (minTime == null || time.value() < minTime.value()) {
                minTime = time;
            }
            if (maxTime == null || time.value() > maxTime.value()) {
                maxTime = time;
            }

            var value = seriesData[i]["value"] as Number;
            if (value == null) {
                continue;
            }
            if (minValue == null || value < minValue) {
                minValue = value;
            }
            if (maxValue == null || value > maxValue) {
                maxValue = value;
            }
            latestValue = value;
            meanValueSum += value;
            meanValueCount++;
        }
        var meanValue = meanValueCount > 0 ? meanValueSum / meanValueCount : null;

        if (minValue == null || maxValue == null || minTime == null || maxTime == null) {
            return false;
        }

        var minScale = 0;
        if (minScale == null || minScale > minValue) {
            minScale = minValue;
        }
        var maxScale = TerpControlUtils.TYPE_TO_SCALE[type];
        if (maxScale == null || maxScale < maxValue) {
            maxScale = maxValue;
        }


        var previousX = null as Number;
        var previousY = null as Number;
        for (var i = 0; i < seriesData.size(); i++) {
            var value = seriesData[i]["value"] as Number;
            if (value == null) {
                previousX = null;
                previousY = null;
                continue;
            }

            var time = seriesData[i]["time"] as Time.Moment;
            var x = graphX + 1 + ((time.value() - minTime.value()).toDouble() / (maxTime.value() - minTime.value().toDouble())) * (graphWidth.toDouble() - 2.0);
            var y = graphY + 1 + graphHeight - ((value - minScale).toDouble() / (maxScale - minScale).toDouble()) * (graphHeight.toDouble() - 2.0);
            dc.drawCircle(x, y, type.equals(_highlight) ? 2 : 1);
            if (previousX != null && previousY != null) {
                dc.drawLine(previousX, previousY, x, y);
            }

            previousX = x;
            previousY = y;
        }

        if (type.equals(_highlight)) {
            var minMaxText = "min: " + TerpControlUtils.valueToDisplay(minValue, type, false) + " max: " + TerpControlUtils.valueToDisplay(maxValue, type, false);
            var nowText = "avg: " + TerpControlUtils.valueToDisplay(meanValue, type, true) + " last: " + TerpControlUtils.valueToDisplay(latestValue, type, true);
            dc.drawText(dc.getWidth() / 2, graphY + graphHeight + TEXT_MARGIN, Graphics.FONT_XTINY, nowText + "\n" + minMaxText, Graphics.TEXT_JUSTIFY_CENTER);
        }

        return true;
    }


    function onHide() as Void {
    }

    function onDeviceResolved(device as Dictionary) as Void {
        _deviceType = device["type"];

        // A highlight stored for a device that doesn't report that measurement
        // would leave the chart without a legend, so fall back to the first series.
        if (_highlight != null && !TerpControlDevices.supports(_deviceType, _highlight)) {
            var types = TerpControlDevices.seriesTypes(_deviceType);
            _highlight = types.size() > 0 ? types[0] : null;
        }
    }

    function onSeriesLoaded(series as Dictionary) as Void {
        _series = series;
        WatchUi.requestUpdate();
    }

    function onHightlightChanged(highlight as String?) as Void {
        _highlight = highlight;
        WatchUi.requestUpdate();
    }

    function getHighlight() as String? {
        return _highlight;
    }

    function getSeries() as Dictionary? {
        return _series;
    }

    function getTimePeriod() as String {
        return _timePeriod;
    }

    function onError(error as String) as Void {
        _error = error;
        WatchUi.requestUpdate();
    }
}
