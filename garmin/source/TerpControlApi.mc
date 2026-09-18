import Toybox.Graphics;
import Toybox.WatchUi;
import Toybox.System;
import Toybox.Communications;
import Toybox.Lang;
import Toybox.Time.Gregorian;
import Toybox.Time;
import Toybox.Application.Properties;
import Toybox.Application.Storage;

// Talks to the Terp Control cloud API and pushes the results into the view that
// started the request. Responses that arrive after the view has changed are
// dropped, so switching pages or devices cancels the previous load.
(:glance)
class TerpControlApi {
    // Sentinel identifier of the "reload devices" entry in the device menu.
    public static var REFRESH_DEVICES_ID = "__refresh__";

    private var _token as String?;
    private var _imageToken as String?;
    private var _tokenValidUntil as Time.Moment?;
    private var _devices as Array?;
    private var _device as Dictionary?;
    private var _view;

    private static var MAX_DATAPOINTS = 25;
    private static var INTERVAL_SECONDS = 20;
    // A device counts as offline after ten minutes, so a window that long holds
    // the newest sample of every device that is still reporting.
    private static var OUTPUT_WINDOW_SECONDS = 600;

    public function initialize(view) {
        _view = view;

        var username = Properties.getValue("username_prop");
        if (username != null) {
            if (username.equals(Storage.getValue("tokenUsername")) && Storage.getValue("tokenValidUntil") != null) {
                _token = Storage.getValue("token");
                _imageToken = Storage.getValue("imageToken");
                _tokenValidUntil = new Time.Moment(Storage.getValue("tokenValidUntil"));
            }
            if (username.equals(Storage.getValue("devicesUsername"))) {
                _devices = Storage.getValue("devices");
            }
        }
    }

    public function setView(view) as Void {
        _view = view;
    }

    public function getDevices() as Array? {
        return _devices;
    }

    public function getDevice() as Dictionary? {
        return _device;
    }

    public function getDeviceType() as String? {
        return _device != null ? _device["type"] : null;
    }

    public function getSeriesTypes() as Array {
        return TerpControlDevices.seriesTypes(getDeviceType());
    }

    public function selectDevice(deviceId as String) as Void {
        Storage.setValue("selectedDeviceId", deviceId);
        _device = null;
        resolveDevice();
    }

    // Drops the cached device list so the next load picks up devices that were
    // added, renamed or removed since the list was last fetched.
    public function refreshDevices() as Void {
        _devices = null;
        _device = null;
        Storage.setValue("devices", null);
        Storage.setValue("devicesUsername", null);
    }

    public function loadLatestValues(glance as Boolean) as Void {
        doObtainToken(method(:onTokenForValues), [glance, _view]);
    }

    public function loadSeries(timePeriodSeconds as Number) as Void {
        doObtainToken(method(:onTokenForSeries), [timePeriodSeconds, _view]);
    }

    public function loadWebcamImage() as Void {
        if (_view instanceof TerpControlWebcamView) {
            _view.onImageLoading();
        }
        doObtainToken(method(:onTokenForWebcam), _view);
    }

    public function loadMaintenance() as Void {
        if (_view instanceof TerpControlMaintenanceView) {
            _view.onMaintenanceLoading();
        }
        doObtainToken(method(:onTokenForMaintenance), _view);
    }

    // durationMinutes of 0 ends a running maintenance window.
    public function setMaintenance(durationMinutes as Number) as Void {
        if (_view instanceof TerpControlMaintenanceView) {
            _view.onMaintenanceLoading();
        }
        doObtainToken(method(:onTokenForSetMaintenance), [durationMinutes, _view]);
    }

    function onTokenForValues(context as Array) as Void {
        ensureDevices(method(:onDeviceForValues), context);
    }

    function onDeviceForValues(context as Array) as Void {
        var glance = context[0] as Boolean;
        var startingView = context[1];
        if (startingView != _view) {
            return;
        }

        var types = glance ? TerpControlDevices.glanceTypes(getDeviceType()) : TerpControlDevices.valueTypes(getDeviceType());
        var result = {};
        for (var i = 0; i < types.size(); i++) {
            result[types[i]] = null;
        }

        doLoadLatestValues(types, result, startingView);
    }

    // The sensors come from one live read, which carries every metric the device
    // reports. What its outputs are doing is not a live value but a series, so
    // the newest window of them is asked for separately.
    function doLoadLatestValues(types as Array, result as Dictionary, startingView) as Void {
        if (startingView != _view || _device == null) {
            return;
        }

        new WebRequestWithContext(apiUrl("/devices/" + _device["id"] + "/live"), null, readOptions(), method(:onReceiveLive), [types, result, startingView]);
    }

    // context is [types, result, startingView] - left untyped because the
    // starting view can be any of the views and they share no common interface.
    function onReceiveLive(responseCode as Number, data as Dictionary or String or Null, context as Array) as Void {
        if (responseCode == 404) {
            // The cached device is gone - fetch the list again.
            refreshDevices();
            onError(responseCode, "Failed to load values");
            return;
        }
        if (responseCode != 200) {
            onError(responseCode, "Failed to load values");
            return;
        }

        var types = context[0];
        var result = context[1];
        var startingView = context[2];
        if (startingView != _view) {
            return;
        }

        var outputs = [];
        for (var i = 0; i < types.size(); i++) {
            var type = types[i];
            if (TerpControlDevices.isOutput(type)) {
                outputs.add(type);
                continue;
            }
            var reading = data["metrics"][TerpControlDevices.apiName(type)];
            result[type] = reading == null || reading["value"] == null ? -1 : reading["value"];
        }
        startingView.onLatestValuesLoaded(result);

        if (outputs.size() == 0) {
            return;
        }
        // One window wide enough to hold the newest sample of a device that is
        // still online, and one point per output to read it out of.
        var url = seriesUrl(outputs, OUTPUT_WINDOW_SECONDS, OUTPUT_WINDOW_SECONDS);
        new WebRequestWithContext(url, null, readOptions(), method(:onReceiveOutputs), [outputs, result, startingView]);
    }

    // context is [outputs, result, startingView].
    function onReceiveOutputs(responseCode as Number, data as Dictionary or String or Null, context as Array) as Void {
        if (responseCode != 200) {
            onError(responseCode, "Failed to load values");
            return;
        }

        var outputs = context[0];
        var result = context[1];
        var startingView = context[2];
        if (startingView != _view) {
            return;
        }

        for (var i = 0; i < outputs.size(); i++) {
            var points = seriesPoints(data, outputs[i]);
            var value = -1;
            for (var p = points.size() - 1; p >= 0; p--) {
                if (points[p]["value"] != null) {
                    value = points[p]["value"];
                    break;
                }
            }
            result[outputs[i]] = value;
        }
        startingView.onLatestValuesLoaded(result);
    }

    function onTokenForSeries(context as Array) as Void {
        ensureDevices(method(:onDeviceForSeries), context);
    }

    function onDeviceForSeries(context as Array) as Void {
        var timePeriodSeconds = context[0] as Number;
        var startingView = context[1];
        if (startingView != _view) {
            return;
        }

        var types = getSeriesTypes();
        var result = {};
        for (var i = 0; i < types.size(); i++) {
            result[types[i]] = null;
        }

        doLoadSeries(types, timePeriodSeconds, result, startingView);
    }

    function doLoadSeries(types as Array, timePeriodSeconds as Number, result as Dictionary, startingView) as Void {
        if (startingView != _view || _device == null) {
            return;
        }

        // Load the highlighted series first so the chart shows something useful early.
        var type = null;
        var highlight = _view instanceof TerpControlChartView ? _view.getHighlight() : null;
        if (highlight != null && result.hasKey(highlight) && result[highlight] == null) {
            type = highlight;
        } else {
            for (var i = 0; i < types.size(); i++) {
                if (result[types[i]] == null) {
                    type = types[i];
                    break;
                }
            }
        }

        if (type == null) {
            return;
        }

        var intervalSeconds = INTERVAL_SECONDS;
        while (timePeriodSeconds / intervalSeconds > MAX_DATAPOINTS) {
            intervalSeconds += INTERVAL_SECONDS;
        }

        // One series per request, although the route answers as many as it is
        // asked for: the chart draws each one as it arrives, and the watch never
        // holds a whole fleet's worth of points at once.
        var url = seriesUrl([type], timePeriodSeconds, intervalSeconds);

        new WebRequestWithContext(url, null, readOptions(), method(:onReceiveSeries), [types, type, timePeriodSeconds, result, startingView]);
    }

    // context is [types, type, timePeriodSeconds, result, startingView], untyped
    // for the same reason as onReceiveLive's.
    function onReceiveSeries(responseCode as Number, data as Dictionary or String or Null, context as Array) as Void {
        if (responseCode == 200) {
            var types = context[0];
            var type = context[1];
            var timePeriodSeconds = context[2];
            var result = context[3];
            var startingView = context[4];

            if (startingView != _view) {
                return;
            }

            var points = seriesPoints(data, type);
            var series = [];
            for (var i = 0; i < points.size(); i++) {
                series.add({
                    "time" => TerpControlUtils.parseISODate(points[i]["measuredAt"]),
                    "value" => points[i]["value"],
                });
            }

            result[type] = series;
            startingView.onSeriesLoaded(result);
            doLoadSeries(types, timePeriodSeconds, result, startingView);
        } else {
            onError(responseCode, "Failed to load series");
        }
    }

    function onTokenForMaintenance(startingView) as Void {
        // Past the cache: how much of the window is left is only true in a fresh
        // device list.
        loadDevices(method(:onDeviceForMaintenance), startingView);
    }

    function onDeviceForMaintenance(startingView) as Void {
        if (startingView != _view || _device == null || !(_view instanceof TerpControlMaintenanceView)) {
            return;
        }

        _view.onMaintenanceLoaded(_device["maintenance"]);
    }

    function onTokenForSetMaintenance(context as Array) as Void {
        ensureDevices(method(:onDeviceForSetMaintenance), context);
    }

    function onDeviceForSetMaintenance(context as Array) as Void {
        var durationMinutes = context[0] as Number;
        var startingView = context[1];
        if (startingView != _view || _device == null) {
            return;
        }

        var url = apiUrl("/devices/" + _device["id"] + "/commands");

        var options = {
            :method => Communications.HTTP_REQUEST_METHOD_POST,
            :headers => {
                "Content-Type" => Communications.REQUEST_CONTENT_TYPE_JSON,
                "Authorization" => "Bearer " + _token,
            },
            :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON,
        };

        // Maintenance is one of the commands a device takes; a duration of zero
        // ends the window that is running.
        var params = {
            "kind" => "maintenance",
            "forSeconds" => durationMinutes * 60,
        };

        new WebRequestWithContext(url, params, options, method(:onReceiveSetMaintenance), context);
    }

    function onReceiveSetMaintenance(responseCode as Number, data as Dictionary or String or Null, context as Array) as Void {
        if (responseCode == 200 || responseCode == 201) {
            var durationMinutes = context[0] as Number;
            var startingView = context[1];
            if (startingView != _view || _device == null || !(_view instanceof TerpControlMaintenanceView)) {
                return;
            }
            // The window starts when the server accepts the request, so there is no
            // need to ask for the state that was just set - but the cached list has
            // to learn about it, or a later page visit shows the old window again.
            var secondsLeft = durationMinutes * 60;
            _device["maintenance"] = secondsLeft;
            Storage.setValue("devices", _devices);
            _view.onMaintenanceLoaded(secondsLeft);
        } else {
            onError(responseCode, "Failed to set maintenance mode");
        }
    }

    function onTokenForWebcam(startingView) as Void {
        ensureDevices(method(:onDeviceForWebcam), startingView);
    }

    function onDeviceForWebcam(startingView) as Void {
        if (startingView != _view || _device == null) {
            return;
        }

        if (!_device.hasKey("camera")) {
            // A device list cached before cameras were records of their own
            // knows of none, so it is read again rather than shown as empty.
            refreshDevices();
            loadDevices(method(:onDeviceForWebcam), startingView);
            return;
        }

        if (_device["camera"] == null) {
            onError(null, "No camera on this device");
            return;
        }

        // The newest frame of that camera, which is a picture like any other and
        // is fetched from the media route by its id.
        var url = apiUrl("/cameras/" + _device["camera"] + "/frames") + "?limit=1";
        new WebRequestWithContext(url, null, readOptions(), method(:onReceiveFrames), startingView);
    }

    function onReceiveFrames(responseCode as Number, data as Dictionary or String or Null, context) as Void {
        if (responseCode != 200) {
            onError(responseCode, "Failed to load webcam image");
            return;
        }
        if (context != _view) {
            return;
        }

        var items = data["items"];
        if (items.size() == 0) {
            onError(null, "No picture yet");
            return;
        }

        // Pictures carry their own token in the URL, because an image request
        // sends no headers of ours.
        var url = apiUrl("/media/" + items[0]["id"] + "/content")
            + "?token=" + _imageToken
            + "&width=" + Toybox.System.getDeviceSettings().screenWidth
            + "&height=" + Toybox.System.getDeviceSettings().screenHeight;

        var options = {
            :packagingFormat => Communications.PACKING_FORMAT_JPG,
        };

        Communications.makeImageRequest(url, null, options, method(:onReceiveWebcamImage));
    }

    function onReceiveWebcamImage(responseCode as Lang.Number, data as WatchUi.BitmapResource or Graphics.BitmapReference or Null) as Void {
        if (responseCode == 200 && data != null) {
            if (_view instanceof TerpControlWebcamView) {
                _view.onImageLoaded(data);
            }
        } else {
            onError(responseCode, "Failed to load webcam image");
        }
    }

    function doObtainToken(onTokenReceived as Method, onTokenReceivedArg) as Void {
        if (_token != null && _tokenValidUntil != null && Time.now().value() < _tokenValidUntil.value()) {
            onTokenReceived.invoke(onTokenReceivedArg);
            return;
        }

        var url = apiUrl("/sessions");

        var options = {
            :method => Communications.HTTP_REQUEST_METHOD_POST,
            :headers => {
                "Content-Type" => Communications.REQUEST_CONTENT_TYPE_JSON,
            },
            :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON,
        };

        // The login identity is the e-mail address; the setting is still called
        // "username" because that is what the watch's settings screen shows.
        var params = {
            "email" => Properties.getValue("username_prop"),
            "password" => Properties.getValue("password_prop"),
        };

        if (params["email"] == null || params["password"] == null) {
            onError(null, "Please set login in settings");
            return;
        }

        Storage.setValue("token", null);
        Storage.setValue("imageToken", null);
        Storage.setValue("tokenValidUntil", null);
        Storage.setValue("tokenUsername", params["username"]);

        new WebRequestWithContext(url, params, options, method(:onReceiveToken), [onTokenReceived, onTokenReceivedArg]);
    }

    function onReceiveToken(responseCode as Number, data as Dictionary or String or Null, context as [Method, Object]) as Void {
        if (responseCode == 200 || responseCode == 201) {
            _token = data["userToken"]["token"];
            // Pictures are fetched with a token of their own, because their URL
            // carries it rather than a header.
            _imageToken = data["mediaToken"]["token"];
            // The answer names the instant the token stops working; a few
            // seconds are kept back so a request never starts on an expired one.
            // An instant that cannot be read counts as expired, which costs a
            // login per request rather than a session that never renews.
            var validUntil = TerpControlUtils.parseISODate(data["userToken"]["validUntil"]);
            _tokenValidUntil = validUntil != null ? validUntil.subtract(new Time.Duration(5)) : Time.now();
            Storage.setValue("token", _token);
            Storage.setValue("imageToken", _imageToken);
            Storage.setValue("tokenValidUntil", _tokenValidUntil.value());
            context[0].invoke(context[1]);
        } else {
            onError(responseCode, "Failed authenticating");
            _token = null;
            _imageToken = null;
            _tokenValidUntil = null;
            Storage.setValue("token", null);
            Storage.setValue("imageToken", null);
            Storage.setValue("tokenValidUntil", null);
        }
    }

    function ensureDevices(onDevicesReady as Method, onDevicesReadyArg) as Void {
        if (_devices != null) {
            resolveDevice();
            if (_device != null) {
                onDevicesReady.invoke(onDevicesReadyArg);
                return;
            }
            refreshDevices();
        }

        loadDevices(onDevicesReady, onDevicesReadyArg);
    }

    function loadDevices(onDevicesReady as Method, onDevicesReadyArg) as Void {
        new WebRequestWithContext(apiUrl("/devices"), null, readOptions(), method(:onReceiveDevices), [onDevicesReady, onDevicesReadyArg]);
    }

    function onReceiveDevices(responseCode as Number, data as Dictionary or String or Null, context as [Method, Object]) as Void {
        if (responseCode == 200) {
            // Lists answer one page and the cursor to continue it with. A watch
            // shows a handful of devices, so the first page is the whole fleet.
            var items = data["items"];
            if (items.size() == 0) {
                onError(null, "No devices found");
                return;
            }

            var devices = [];
            for (var i = 0; i < items.size(); i++) {
                var type = items[i]["type"];
                var name = items[i]["name"];
                devices.add({
                    "id" => items[i]["id"],
                    "name" => name != null && name.length() > 0 ? name : TerpControlDevices.deviceTypeLabel(type),
                    "type" => type,
                    // Seconds left of the maintenance window, counted from the
                    // instant the device carries, so the page can tick it down.
                    "maintenance" => secondsUntil(items[i]["state"]["maintenanceUntil"]),
                    // Filled in by the camera list below; a picture belongs to a
                    // camera and no longer to the device it hangs in.
                    "camera" => null,
                });
            }
            _devices = devices;

            loadCameras(context);
        } else {
            onError(responseCode, "Failed loading device data");
            _token = null;
            _tokenValidUntil = null;
        }
    }

    // Which camera answers for which device. Read once with the device list and
    // cached with it, so the webcam page knows what to ask for a picture of.
    function loadCameras(context as [Method, Object]) as Void {
        new WebRequestWithContext(apiUrl("/cameras"), null, readOptions(), method(:onReceiveCameras), context);
    }

    function onReceiveCameras(responseCode as Number, data as Dictionary or String or Null, context as [Method, Object]) as Void {
        if (responseCode == 200) {
            var items = data["items"];
            for (var i = 0; i < items.size(); i++) {
                var deviceId = items[i]["deviceId"];
                if (deviceId == null || items[i]["removedAt"] != null) {
                    continue;
                }
                for (var d = 0; d < _devices.size(); d++) {
                    if (_devices[d]["id"].equals(deviceId) && _devices[d]["camera"] == null) {
                        _devices[d]["camera"] = items[i]["id"];
                    }
                }
            }
        }

        // A fleet without cameras is not an error - the rest of the app works
        // without one, and only the webcam page has nothing to show.
        Storage.setValue("devices", _devices);
        Storage.setValue("devicesUsername", Properties.getValue("username_prop"));

        resolveDevice();
        context[0].invoke(context[1]);
    }

    // Picks the device the user last selected, falling back to the first one. The
    // resolved id is persisted so the glance and the per-device view state agree
    // with what the app shows.
    private function resolveDevice() as Void {
        if (_devices == null || _devices.size() == 0) {
            _device = null;
            return;
        }

        var selectedId = Storage.getValue("selectedDeviceId");
        _device = null;
        if (selectedId != null) {
            for (var i = 0; i < _devices.size(); i++) {
                if (_devices[i]["id"].equals(selectedId)) {
                    _device = _devices[i];
                    break;
                }
            }
        }
        if (_device == null) {
            _device = _devices[0];
            Storage.setValue("selectedDeviceId", _device["id"]);
        }

        _view.onDeviceResolved(_device);
    }

    // Everything this widget calls lives under /v1; the device protocol's own
    // routes are the firmware's and are never spoken here.
    private function apiUrl(path as String) as String {
        return Properties.getValue("api_base_url_prop") + "/v1" + path;
    }

    private function readOptions() as Dictionary {
        return {
            :method => Communications.HTTP_REQUEST_METHOD_GET,
            :headers => {
                "Authorization" => "Bearer " + _token,
            },
            :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON,
        };
    }

    // How much of a window is left, from the instant it ends. Null is "not in
    // one", and a window that has run out is over rather than negative.
    private function secondsUntil(instant as String?) as Number {
        if (instant == null) {
            return 0;
        }
        var moment = TerpControlUtils.parseISODate(instant);
        if (moment == null) {
            return 0;
        }
        var seconds = moment.value() - Time.now().value();
        return seconds > 0 ? seconds : 0;
    }

    // One series request. The route takes the series it should answer as
    // repeated query parameters - `metrics=` for a sensor, `outputs=` for what
    // the controller is driving - and answers one list per kind.
    private function seriesUrl(types as Array, periodSeconds as Number, stepSeconds as Number) as String {
        var now = Time.now();
        var url = apiUrl("/devices/" + _device["id"] + "/series")
            + "?startsAt=" + TerpControlUtils.toISODate(now.subtract(new Time.Duration(periodSeconds)))
            + "&endsAt=" + TerpControlUtils.toISODate(now)
            + "&stepSeconds=" + stepSeconds;
        for (var i = 0; i < types.size(); i++) {
            url += (TerpControlDevices.isOutput(types[i]) ? "&outputs=" : "&metrics=") + TerpControlDevices.apiName(types[i]);
        }
        return url;
    }

    private function seriesPoints(data as Dictionary, type as String) as Array {
        var isOutput = TerpControlDevices.isOutput(type);
        var series = isOutput ? data["outputs"] : data["metrics"];
        var key = isOutput ? "output" : "metric";
        var name = TerpControlDevices.apiName(type);
        for (var i = 0; i < series.size(); i++) {
            if (series[i][key].equals(name)) {
                return series[i]["points"];
            }
        }
        return [];
    }

    function onError(responseCode as Number or Null, fallbackError as String) as Void {
        var message;
        if (responseCode == Communications.NETWORK_REQUEST_TIMED_OUT || responseCode == Communications.REQUEST_CANCELLED || responseCode == Communications.REQUEST_CONNECTION_DROPPED) {
            message = "Request timeout";
        } else if (responseCode == Communications.BLE_CONNECTION_UNAVAILABLE) {
            message = "No connection";
        } else {
            message = fallbackError + "\n" + (responseCode != null ? "(" + responseCode.toString() + ")" : "");
        }

        _view.onError(message);
    }
}
