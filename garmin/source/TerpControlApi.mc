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

    function doLoadLatestValues(types as Array, result as Dictionary, startingView) as Void {
        if (startingView != _view || _device == null) {
            return;
        }

        var type = null;
        for (var i = 0; i < types.size(); i++) {
            if (result[types[i]] == null) {
                type = types[i];
                break;
            }
        }

        if (type == null) {
            var allNotAvailable = true;
            for (var i = 0; i < types.size(); i++) {
                if (result[types[i]] > -1) {
                    allNotAvailable = false;
                    break;
                }
            }
            if (allNotAvailable) {
                // The cached device is likely gone or renamed - fetch the list again.
                refreshDevices();
            }
            return;
        }

        var url = Properties.getValue("api_base_url_prop") + "/data/latest/" + _device["id"] + "/" + type;

        var options = {
            :method => Communications.HTTP_REQUEST_METHOD_GET,
            :headers => {
                "Authorization" => "Bearer " + _token,
            },
            :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON,
        };

        new WebRequestWithContext(url, null, options, method(:onReceiveValue), [types, type, result, startingView]);
    }

    // context is [types, type, result, startingView] - left untyped because the
    // starting view can be any of the views and they share no common interface.
    function onReceiveValue(responseCode as Number, data as Dictionary or String or Null, context as Array) as Void {
        if (responseCode == 201) {
            var types = context[0];
            var type = context[1];
            var result = context[2];
            var startingView = context[3];

            if (startingView != _view) {
                return;
            }

            result[type] = data["value"] == null ? -1 : data["value"];
            startingView.onLatestValuesLoaded(result);
            doLoadLatestValues(types, result, startingView);
        } else {
            onError(responseCode, "Failed to load values");
        }
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
        var url = Properties.getValue("api_base_url_prop") + "/data/series/" + _device["id"] + "/" + type + "?from=-" + timePeriodSeconds + "s&to=now()&interval=" + intervalSeconds + "s";

        var options = {
            :method => Communications.HTTP_REQUEST_METHOD_GET,
            :headers => {
                "Authorization" => "Bearer " + _token,
            },
            :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON,
        };

        new WebRequestWithContext(url, null, options, method(:onReceiveSeries), [types, type, timePeriodSeconds, result, startingView]);
    }

    // context is [types, type, timePeriodSeconds, result, startingView], untyped
    // for the same reason as onReceiveValue's.
    function onReceiveSeries(responseCode as Number, data as Dictionary or String or Null, context as Array) as Void {
        if (responseCode == 201) {
            var types = context[0];
            var type = context[1];
            var timePeriodSeconds = context[2];
            var result = context[3];
            var startingView = context[4];

            if (startingView != _view) {
                return;
            }

            var series = [];
            for (var i = 0; i < data.size(); i++) {
                series.add({
                    "time" => TerpControlUtils.parseISODate(data[i]["_time"]),
                    "value" => data[i]["_value"],
                });
            }

            result[type] = series;
            startingView.onSeriesLoaded(result);
            doLoadSeries(types, timePeriodSeconds, result, startingView);
        } else {
            onError(responseCode, "Failed to load series");
        }
    }

    function onTokenForWebcam(startingView) as Void {
        ensureDevices(method(:onDeviceForWebcam), startingView);
    }

    function onDeviceForWebcam(startingView) as Void {
        if (startingView != _view || _device == null) {
            return;
        }

        var url = Properties.getValue("api_base_url_prop")
            + "/image/" + _device["id"]
            + "?format=jpeg&token=" + _imageToken
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

        var url = Properties.getValue("api_base_url_prop") + "/login";

        var options = {
            :method => Communications.HTTP_REQUEST_METHOD_POST,
            :headers => {
                "Content-Type" => Communications.REQUEST_CONTENT_TYPE_JSON,
            },
            :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON,
        };

        var params = {
            "username" => Properties.getValue("username_prop"),
            "password" => Properties.getValue("password_prop"),
        };

        if (params["username"] == null || params["password"] == null) {
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
        if (responseCode == 200) {
            _token = data["userToken"]["token"];
            _imageToken = data["imageToken"]["token"];
            _tokenValidUntil = Time.now().add(new Time.Duration(data["userToken"]["expiresIn"] - 5));
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

        var url = Properties.getValue("api_base_url_prop") + "/device";

        var options = {
            :method => Communications.HTTP_REQUEST_METHOD_GET,
            :headers => {
                "Authorization" => "Bearer " + _token,
            },
            :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON,
        };

        new WebRequestWithContext(url, null, options, method(:onReceiveDevices), [onDevicesReady, onDevicesReadyArg]);
    }

    function onReceiveDevices(responseCode as Number, data as Dictionary or String or Null, context as [Method, Object]) as Void {
        if (responseCode == 200) {
            if (data.size() == 0) {
                onError(null, "No devices found");
                return;
            }

            var devices = [];
            for (var i = 0; i < data.size(); i++) {
                var type = data[i]["device_type"];
                var name = data[i]["name"];
                devices.add({
                    "id" => data[i]["device_id"],
                    "name" => name != null && name.length() > 0 ? name : TerpControlDevices.deviceTypeLabel(type),
                    "type" => type,
                });
            }
            _devices = devices;

            Storage.setValue("devices", _devices);
            Storage.setValue("devicesUsername", Properties.getValue("username_prop"));

            resolveDevice();
            context[0].invoke(context[1]);
        } else {
            onError(responseCode, "Failed loading device data");
            _token = null;
            _tokenValidUntil = null;
        }
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
