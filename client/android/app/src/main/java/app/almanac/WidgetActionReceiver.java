package app.almanac;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;

// The box beside a task in the Today widget: checks the task off there at once (a second tap
// takes it back), for the app to check off the next time it opens. Not exported, so only the
// widget's own taps reach it.
public class WidgetActionReceiver extends BroadcastReceiver {
    static final String ACTION_TOGGLE = "app.almanac.widget.TOGGLE";

    @Override
    public void onReceive(Context context, Intent intent) {
        Uri data = intent.getData();
        if (!ACTION_TOGGLE.equals(intent.getAction()) || data == null || data.getLastPathSegment() == null) return;
        WidgetStore.toggle(context, data.getLastPathSegment());
        TodayWidget.refresh(context);
    }
}
