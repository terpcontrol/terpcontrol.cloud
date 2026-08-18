import Toybox.Graphics;
import Toybox.WatchUi;
import Toybox.System;
import Toybox.Communications;
import Toybox.Lang;
import Toybox.Time.Gregorian;
import Toybox.Time;
import Toybox.Math;

class TerpControlWebcamView extends WatchUi.View {
    private var _image as Graphics.BitmapReference or WatchUi.BitmapResource or Null;
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
        } else if (_image != null) {
            dc.drawBitmap((dc.getWidth() - _image.getWidth()) / 2, (dc.getHeight() - _image.getHeight()) / 2, _image);
        } else {
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(dc.getWidth() / 2, dc.getHeight() / 2, Graphics.FONT_XTINY, "Loading...", Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        }
    }

    function onHide() as Void {
    }

    function onDeviceResolved(device as Dictionary) as Void {
    }

    function onImageLoading() as Void {
        _image = null;
        _error = null;
        WatchUi.requestUpdate();
    }

    function onImageLoaded(data as Graphics.BitmapReference or WatchUi.BitmapResource) as Void {
        _image = data;
        _error = null;
        WatchUi.requestUpdate();
    }

    function onError(error as String) as Void {
        _error = error;
        WatchUi.requestUpdate();
    }
}
