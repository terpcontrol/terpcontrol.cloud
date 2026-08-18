import Toybox.WatchUi;
import Toybox.Lang;

class TerpControlDeviceMenuDelegate extends WatchUi.Menu2InputDelegate {
    private var _delegate as TerpControlViewDelegate;

    public function initialize(delegate as TerpControlViewDelegate) {
        _delegate = delegate;
        Menu2InputDelegate.initialize();
    }

    function onSelect(item as WatchUi.MenuItem) as Void {
        WatchUi.popView(WatchUi.SLIDE_DOWN);
        _delegate.onDeviceSelected(item.getId() as String);
    }
}
