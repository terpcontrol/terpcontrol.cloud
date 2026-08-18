import Toybox.Lang;
import Toybox.Communications;

(:glance)
class WebRequestWithContext {
    private var _context;
    private var _callback as Method;

    function initialize(url as String, params as Dictionary or Null, options as Dictionary, callback as Method, context) {
        _context = context;
        _callback = callback;

        Communications.makeWebRequest(url, params, options, method(:onReceive));
    }

    function onReceive(responseCode as Number, data as Dictionary or String or Null) as Void {
        _callback.invoke(responseCode, data, _context);
    }
    
}