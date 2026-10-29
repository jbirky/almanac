package app.almanac;

import android.content.Context;
import android.content.SharedPreferences;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import org.json.JSONException;
import org.json.JSONObject;

// What the home-screen widget shows, kept where it can read it. The notes live in the app's web
// view, out of the widget's reach, so the app hands it a copy of the open tasks due within a week
// (see client/src/lib/widget.js) each time they change while it's open. Tasks checked off in the
// widget wait here until the app next opens and checks them off there, where they sync.
final class WidgetStore {
    private static final String PREFS = "almanac.widget";
    private static final String SNAPSHOT = "snapshot";
    private static final String PENDING = "pending";

    private WidgetStore() {}

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    // The app's latest copy: { at, tasks: [{ id, title, due, category }] }, `at` in milliseconds,
    // or null if the app hasn't given one yet.
    static JSONObject snapshot(Context context) {
        String json = prefs(context).getString(SNAPSHOT, null);
        if (json == null) return null;
        try {
            return new JSONObject(json);
        } catch (JSONException e) {
            return null;
        }
    }

    static void saveSnapshot(Context context, String json) {
        prefs(context).edit().putString(SNAPSHOT, json).apply();
    }

    // Ids of the tasks checked off in the widget that the app hasn't checked off yet.
    static synchronized Set<String> pending(Context context) {
        return new HashSet<>(prefs(context).getStringSet(PENDING, Collections.emptySet()));
    }

    // Checks a task off in the widget, or takes the check back.
    static synchronized void toggle(Context context, String id) {
        Set<String> ids = pending(context);
        if (!ids.remove(id)) ids.add(id);
        prefs(context).edit().putStringSet(PENDING, ids).commit();
    }

    // The tasks waiting to be checked off, handed to the app, which checks them off.
    static synchronized List<String> takePending(Context context) {
        List<String> ids = new ArrayList<>(pending(context));
        prefs(context).edit().remove(PENDING).commit();
        return ids;
    }

    // Today's date on this phone, as the app writes dates: "2026-10-28".
    static String today() {
        Calendar now = Calendar.getInstance();
        return String.format(Locale.ROOT, "%04d-%02d-%02d", now.get(Calendar.YEAR), now.get(Calendar.MONTH) + 1, now.get(Calendar.DAY_OF_MONTH));
    }

    // A date such as "2026-10-28" at noon that day, for formatting.
    static Calendar parse(String date) {
        Calendar day = Calendar.getInstance();
        String[] parts = date.split("-");
        day.set(Integer.parseInt(parts[0]), Integer.parseInt(parts[1]) - 1, Integer.parseInt(parts[2]), 12, 0, 0);
        return day;
    }
}
