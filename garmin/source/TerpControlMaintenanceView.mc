import Toybox.Graphics;
import Toybox.WatchUi;
import Toybox.Lang;
import Toybox.Time;
import Toybox.Timer;

// Shows whether the selected device is in maintenance mode and counts the window
// down while the page is open. Select opens the duration menu.
class TerpControlMaintenanceView extends WatchUi.View {
    // Epoch second the window ends at, null while the state is unknown.
    private var _endsAt as Number?;
    private var _busy as Boolean = false;
    private var _error as String?;
    private var _timer as Timer.Timer?;

    function initialize() {
        View.initialize();
    }

    function onLayout(dc as Dc) as Void {
    }

    function onShow() as Void {
        startTimer();
    }

    function onUpdate(dc as Dc) as Void {
        View.onUpdate(dc);
        dc.clear();
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);

        var centerX = dc.getWidth() / 2;
        var centerY = dc.getHeight() / 2;
        var offset = dc.getHeight() / 5;

        if (_error != null) {
            dc.drawText(centerX, centerY, Graphics.FONT_XTINY, "Error: " + _error, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
            return;
        }

        var remaining = remainingSeconds();
        var value;
        var hint;
        if (_busy || _endsAt == null) {
            value = "...";
            hint = "";
        } else if (remaining > 0) {
            value = TerpControlUtils.secondsToDuration(remaining);
            hint = "Start to change";
        } else {
            value = "OFF";
            hint = "Start to activate";
        }

        dc.drawText(centerX, centerY - offset, Graphics.FONT_XTINY, "Maintenance", Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        dc.drawText(centerX, centerY, Graphics.FONT_MEDIUM, value, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        dc.drawText(centerX, centerY + offset, Graphics.FONT_XTINY, hint, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
    }

    function onHide() as Void {
        stopTimer();
    }

    function onDeviceResolved(device as Dictionary) as Void {
    }

    // Called while the state is being fetched or a new duration is being sent.
    function onMaintenanceLoading() as Void {
        _busy = true;
        _error = null;
        WatchUi.requestUpdate();
    }

    function onMaintenanceLoaded(remaining as Number?) as Void {
        _endsAt = Time.now().value() + (remaining != null ? remaining : 0);
        _busy = false;
        _error = null;
        startTimer();
        WatchUi.requestUpdate();
    }

    function onError(error as String) as Void {
        _error = error;
        _busy = false;
        WatchUi.requestUpdate();
    }

    function onTick() as Void {
        if (remainingSeconds() <= 0) {
            stopTimer();
        }
        WatchUi.requestUpdate();
    }

    private function remainingSeconds() as Number {
        var endsAt = _endsAt;
        if (endsAt == null) {
            return 0;
        }
        var remaining = endsAt - Time.now().value();
        return remaining > 0 ? remaining : 0;
    }

    // The countdown only ticks while there is a window to count down.
    private function startTimer() as Void {
        if (_timer != null || remainingSeconds() <= 0) {
            return;
        }
        var timer = new Timer.Timer();
        timer.start(method(:onTick), 1000, true);
        _timer = timer;
    }

    private function stopTimer() as Void {
        var timer = _timer;
        if (timer != null) {
            timer.stop();
            _timer = null;
        }
    }
}
