import Toybox.WatchUi;
import Toybox.Lang;
import Toybox.Application.Storage;

// Handles the widget input: up/down page through the values, the chart periods, the
// webcam and the maintenance mode, select cycles the highlighted series or opens the
// maintenance durations, and the menu switches devices.
class TerpControlViewDelegate extends WatchUi.BehaviorDelegate {
    private var _api as TerpControlApi;
    private var _view;

    private static var CHART_TIME_PERIODS as Dictionary = {
        "10 mins" => 600,
        "30 mins" => 1800,
        "1 hour" => 3600,
        "12 hours" => 12 * 3600,
        "1 day" => 24 * 3600,
        "1 week" => 7 * 24 * 3600,
        "1 month" => 30 * 24 * 3600
    };
    private static var CHART_TIME_PERIODS_KEYS as Array = [
        "10 mins",
        "30 mins",
        "1 hour",
        "12 hours",
        "1 day",
        "1 week",
        "1 month"
    ];

    // Maintenance windows offered on the watch; 0 ends a running one.
    private static var MAINTENANCE_MINUTES as Array = [5, 10, 15, 20, 30, 45, 60, 90, 120];

    public function initialize(view) {
        _view = view;
        _api = new TerpControlApi(view);

        BehaviorDelegate.initialize();

        load();
    }

    public static function createInstance() as [WatchUi.View, TerpControlViewDelegate] {
        var view = createView(Storage.getValue(TerpControlDevices.stateKey("timePeriod")));
        return [view, new TerpControlViewDelegate(view)];
    }

    static function createView(timePeriod as String?) as WatchUi.View {
        if (timePeriod == null) {
            return new TerpControlValuesView();
        }
        if (timePeriod.equals("webcam")) {
            return new TerpControlWebcamView();
        }
        if (timePeriod.equals("maintenance")) {
            return new TerpControlMaintenanceView();
        }
        return new TerpControlChartView(timePeriod, Storage.getValue(TerpControlDevices.stateKey("highlight")) as String);
    }

    function onNextPage() as Boolean {
        if (_view instanceof TerpControlValuesView) {
            switchTo(CHART_TIME_PERIODS_KEYS[0] as String, WatchUi.SLIDE_UP);
        } else if (_view instanceof TerpControlWebcamView) {
            switchTo("maintenance", WatchUi.SLIDE_UP);
        } else if (_view instanceof TerpControlMaintenanceView) {
            switchTo(null, WatchUi.SLIDE_UP);
        } else {
            var nextPeriod = "webcam";
            for (var i = 0; i < CHART_TIME_PERIODS_KEYS.size(); i++) {
                if (CHART_TIME_PERIODS_KEYS[i].equals(_view.getTimePeriod()) && i + 1 < CHART_TIME_PERIODS_KEYS.size()) {
                    nextPeriod = CHART_TIME_PERIODS_KEYS[i + 1];
                    break;
                }
            }
            switchTo(nextPeriod, WatchUi.SLIDE_UP);
        }

        return true;
    }

    function onPreviousPage() as Boolean {
        if (_view instanceof TerpControlValuesView) {
            switchTo("maintenance", WatchUi.SLIDE_DOWN);
        } else if (_view instanceof TerpControlMaintenanceView) {
            switchTo("webcam", WatchUi.SLIDE_DOWN);
        } else if (_view instanceof TerpControlWebcamView) {
            switchTo(CHART_TIME_PERIODS_KEYS[CHART_TIME_PERIODS_KEYS.size() - 1] as String, WatchUi.SLIDE_DOWN);
        } else {
            var prevPeriod = null as String?;
            for (var i = CHART_TIME_PERIODS_KEYS.size() - 1; i >= 0; i--) {
                if (CHART_TIME_PERIODS_KEYS[i].equals(_view.getTimePeriod()) && i - 1 >= 0) {
                    prevPeriod = CHART_TIME_PERIODS_KEYS[i - 1];
                    break;
                }
            }
            switchTo(prevPeriod, WatchUi.SLIDE_DOWN);
        }

        return true;
    }

    function onSelect() as Boolean {
        if (_view instanceof TerpControlChartView) {
            if (_view.getSeries() != null) {
                var highlight = nextHighlight(_view.getHighlight());
                Storage.setValue(TerpControlDevices.stateKey("highlight"), highlight);
                _view.onHightlightChanged(highlight);
            }
        } else if (_view instanceof TerpControlWebcamView) {
            _api.loadWebcamImage();
        } else if (_view instanceof TerpControlMaintenanceView) {
            showMaintenanceMenu();
        } else {
            _api.loadLatestValues(false);
        }

        return true;
    }

    function onMenu() as Boolean {
        var devices = _api.getDevices();
        if (devices == null) {
            return false;
        }

        var selectedId = _api.getDevice() != null ? _api.getDevice()["id"] : null;
        var menu = new WatchUi.Menu2({ :title => "Devices" });
        for (var i = 0; i < devices.size(); i++) {
            var device = devices[i];
            var subLabel = TerpControlDevices.deviceTypeLabel(device["type"]);
            if (device["id"].equals(selectedId)) {
                subLabel = subLabel + " (shown)";
            }
            menu.addItem(new WatchUi.MenuItem(device["name"], subLabel, device["id"], {}));
        }
        menu.addItem(new WatchUi.MenuItem("Reload devices", null, TerpControlApi.REFRESH_DEVICES_ID, {}));

        WatchUi.pushView(menu, new TerpControlDeviceMenuDelegate(self), WatchUi.SLIDE_UP);
        return true;
    }

    // Called by the device menu once the user picked an entry.
    public function onDeviceSelected(deviceId as String) as Void {
        if (deviceId.equals(TerpControlApi.REFRESH_DEVICES_ID)) {
            _api.refreshDevices();
            load();
            return;
        }

        if (_api.getDevice() != null && _api.getDevice()["id"].equals(deviceId)) {
            return;
        }

        _api.selectDevice(deviceId);

        // Each device keeps its own page and highlight, so restore that device's view.
        _view = createView(Storage.getValue(TerpControlDevices.stateKey("timePeriod")));
        _api.setView(_view);
        WatchUi.switchToView(_view, self, WatchUi.SLIDE_IMMEDIATE);
        load();
    }

    // Called by the maintenance menu once the user picked a duration.
    public function onMaintenanceDurationSelected(durationMinutes as Number) as Void {
        if (_view instanceof TerpControlMaintenanceView) {
            _api.setMaintenance(durationMinutes);
        }
    }

    private function showMaintenanceMenu() as Void {
        var menu = new WatchUi.Menu2({ :title => "Maintenance" });
        menu.addItem(new WatchUi.MenuItem("End now", null, 0, {}));
        for (var i = 0; i < MAINTENANCE_MINUTES.size(); i++) {
            var minutes = MAINTENANCE_MINUTES[i] as Number;
            menu.addItem(new WatchUi.MenuItem(minutes.toString() + " minutes", null, minutes, {}));
        }

        WatchUi.pushView(menu, new TerpControlMaintenanceMenuDelegate(self), WatchUi.SLIDE_UP);
    }

    // Moves the highlight to the next series and, after the last one, to no
    // highlight at all before starting over.
    private function nextHighlight(current as String?) as String? {
        var types = _api.getSeriesTypes();
        if (types.size() == 0) {
            return null;
        }
        if (current == null) {
            return types[0];
        }
        for (var i = 0; i < types.size(); i++) {
            if (types[i].equals(current)) {
                return i + 1 < types.size() ? types[i + 1] : null;
            }
        }
        return types[0];
    }

    // Replaces the current page. `timePeriod` is null for the values page,
    // "webcam" for the webcam page, "maintenance" for the maintenance page and a
    // chart period otherwise.
    private function switchTo(timePeriod as String?, transition as WatchUi.SlideType) as Void {
        Storage.setValue(TerpControlDevices.stateKey("timePeriod"), timePeriod);
        _view = createView(timePeriod);
        _api.setView(_view);
        WatchUi.switchToView(_view, self, transition);
        load();
    }

    private function load() as Void {
        if (_view instanceof TerpControlChartView) {
            _api.loadSeries(CHART_TIME_PERIODS[_view.getTimePeriod()] as Number);
        } else if (_view instanceof TerpControlWebcamView) {
            _api.loadWebcamImage();
        } else if (_view instanceof TerpControlMaintenanceView) {
            _api.loadMaintenance();
        } else {
            _api.loadLatestValues(false);
        }
    }
}
