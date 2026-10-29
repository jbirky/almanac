package app.almanac;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// The page's side of the Today widget (client/src/lib/widget.js): it gives the widget its copy of
// the tasks, takes the tasks checked off there, hears where a tap on the widget asked to open the
// app, and asks the home screen to add the widget.
@CapacitorPlugin(name = "AlmanacWidget")
public class WidgetPlugin extends Plugin {

    // update({ snapshot }): the tasks to show, as JSON (see WidgetStore.snapshot).
    @PluginMethod
    public void update(PluginCall call) {
        String snapshot = call.getString("snapshot");
        if (snapshot == null) {
            call.reject("No snapshot");
            return;
        }
        WidgetStore.saveSnapshot(getContext(), snapshot);
        TodayWidget.refresh(getContext());
        call.resolve();
    }

    // takePending() -> { ids }: the tasks checked off in the widget, now the page's to check off.
    @PluginMethod
    public void takePending(PluginCall call) {
        JSObject result = new JSObject();
        result.put("ids", new JSArray(WidgetStore.takePending(getContext())));
        call.resolve(result);
        TodayWidget.refresh(getContext());
    }

    // takeLaunch() -> { place } if the app was opened from the widget, once.
    @PluginMethod
    public void takeLaunch(PluginCall call) {
        JSObject launch = launchOf(getActivity().getIntent());
        if (launch != null) getActivity().setIntent(new Intent(Intent.ACTION_MAIN));
        call.resolve(launch != null ? launch : new JSObject());
    }

    // pin() -> { asked }: asks the home screen to add the widget, where it can.
    @PluginMethod
    public void pin(PluginCall call) {
        boolean asked = false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            AppWidgetManager manager = getContext().getSystemService(AppWidgetManager.class);
            if (manager != null && manager.isRequestPinAppWidgetSupported()) {
                asked = manager.requestPinAppWidget(new ComponentName(getContext(), TodayWidget.class), null, null);
            }
        }
        JSObject result = new JSObject();
        result.put("asked", asked);
        call.resolve(result);
    }

    // Opened from the widget while already running: say where to.
    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        JSObject launch = launchOf(intent);
        if (launch != null) notifyListeners("launch", launch, true);
    }

    // Back in the app: the widget may have checked tasks off meanwhile.
    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        notifyListeners("resume", new JSObject());
    }

    // Where an intent from the widget opens the app: { place: "add" } or { place: "day", date }.
    private static JSObject launchOf(Intent intent) {
        if (intent == null || !TodayWidget.ACTION_OPEN.equals(intent.getAction()) || intent.getData() == null) return null;
        Uri data = intent.getData();
        JSObject launch = new JSObject();
        launch.put("place", data.getHost());
        if ("day".equals(data.getHost()) && data.getLastPathSegment() != null) launch.put("date", data.getLastPathSegment());
        return launch;
    }
}
