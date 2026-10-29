package app.almanac;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.text.SpannableString;
import android.text.Spanned;
import android.text.format.DateFormat;
import android.text.style.StrikethroughSpan;
import android.view.View;
import android.widget.RemoteViews;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;

// The Today widget: what's due today and overdue, as the app's Due panel shows it, from the copy
// the app last gave (WidgetStore). The box beside a task checks it off; the task opens its day in
// the app; + opens the app's task box. It works out what's due from the phone's date, so it stays
// right as days pass while the app is closed.
public class TodayWidget extends AppWidgetProvider {
    // Opens the app at a place: almanac://day/2026-10-28, or almanac://add.
    static final String ACTION_OPEN = "app.almanac.OPEN";

    // Heights in the widget, in dp: its heading and padding, a task, the "Overdue" line and the
    // "+3 more" line (see the layouts).
    private static final int HEADER_DP = 62;
    private static final int ROW_DP = 36;
    private static final int LABEL_DP = 26;
    private static final int MORE_DP = 34;
    private static final int DEFAULT_DP = HEADER_DP + 5 * ROW_DP;

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        for (int id : ids) manager.updateAppWidget(id, render(context, manager, id));
    }

    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager, int id, Bundle options) {
        manager.updateAppWidget(id, render(context, manager, id));
    }

    // Draws every Today widget again, after the app or a check-off changed what it shows.
    static void refresh(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        for (int id : manager.getAppWidgetIds(new ComponentName(context, TodayWidget.class))) {
            manager.updateAppWidget(id, render(context, manager, id));
        }
    }

    static RemoteViews render(Context context, AppWidgetManager manager, int widgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_today);
        String today = WidgetStore.today();
        views.setOnClickPendingIntent(R.id.widget_heading, open(context, "day/" + today));
        views.setOnClickPendingIntent(R.id.widget_add, open(context, "add"));
        views.removeAllViews(R.id.widget_rows);

        JSONObject snapshot = WidgetStore.snapshot(context);
        String day = formatDay(context, today, "EEEMMMd");
        if (snapshot == null) {
            views.setTextViewText(R.id.widget_subtitle, day);
            note(context, views, R.string.widget_open_once, today);
            return views;
        }
        views.setTextViewText(R.id.widget_subtitle, day + " · " + updated(context, snapshot.optLong("at", 0), today));

        Set<String> checked = WidgetStore.pending(context);
        List<JSONObject> due = new ArrayList<>();
        List<JSONObject> overdue = new ArrayList<>();
        JSONArray tasks = snapshot.optJSONArray("tasks");
        for (int i = 0; tasks != null && i < tasks.length(); i++) {
            JSONObject task = tasks.optJSONObject(i);
            String date = task == null ? "" : task.optString("due", "");
            if (date.isEmpty()) continue;
            if (date.equals(today)) due.add(task);
            else if (date.compareTo(today) < 0) overdue.add(task);
        }
        if (due.isEmpty() && overdue.isEmpty()) {
            note(context, views, R.string.widget_nothing_due, today);
            return views;
        }

        // As much as fits: due today, then a heading and the overdue tasks, then "+3 more" if
        // that isn't all of them.
        int room = heightOf(manager, widgetId) - HEADER_DP;
        int all = ROW_DP * (due.size() + overdue.size()) + (overdue.isEmpty() ? 0 : LABEL_DP);
        if (all > room) room -= MORE_DP;
        int shown = 0;
        for (JSONObject task : due) {
            if (room < ROW_DP) break;
            views.addView(R.id.widget_rows, taskRow(context, task, false, checked));
            room -= ROW_DP;
            shown++;
        }
        if (!overdue.isEmpty() && room >= LABEL_DP + ROW_DP) {
            RemoteViews heading = new RemoteViews(context.getPackageName(), R.layout.widget_heading);
            heading.setTextViewText(R.id.heading_text, context.getString(R.string.widget_overdue));
            views.addView(R.id.widget_rows, heading);
            room -= LABEL_DP;
            for (JSONObject task : overdue) {
                if (room < ROW_DP) break;
                views.addView(R.id.widget_rows, taskRow(context, task, true, checked));
                room -= ROW_DP;
                shown++;
            }
        }
        int more = due.size() + overdue.size() - shown;
        if (more > 0) {
            RemoteViews row = new RemoteViews(context.getPackageName(), R.layout.widget_note);
            row.setTextViewText(R.id.note_text, context.getResources().getQuantityString(R.plurals.widget_more, more, more));
            row.setOnClickPendingIntent(R.id.note_text, open(context, "day/" + today));
            views.addView(R.id.widget_rows, row);
        }
        return views;
    }

    private static RemoteViews taskRow(Context context, JSONObject task, boolean late, Set<String> checked) {
        String id = task.optString("id");
        String title = task.optString("title", "");
        String due = task.optString("due");
        boolean done = checked.contains(id);
        // Colors come from the layouts, which the home screen draws in its own light or dark.
        RemoteViews row = new RemoteViews(context.getPackageName(), done ? R.layout.widget_task_done : R.layout.widget_task);
        CharSequence name = title.isEmpty() ? context.getString(R.string.widget_untitled) : title;
        if (done) {
            SpannableString struck = new SpannableString(name);
            struck.setSpan(new StrikethroughSpan(), 0, struck.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            name = struck;
        }
        row.setTextViewText(R.id.task_title, name);
        row.setContentDescription(R.id.task_check, context.getString(done ? R.string.widget_checked : R.string.widget_unchecked, name));
        if (late) {
            row.setTextViewText(R.id.task_date, formatDay(context, due, "MMMd"));
            row.setViewVisibility(R.id.task_date, View.VISIBLE);
        } else {
            row.setViewVisibility(R.id.task_date, View.GONE);
        }
        Intent toggle = new Intent(context, WidgetActionReceiver.class)
            .setAction(WidgetActionReceiver.ACTION_TOGGLE)
            .setData(Uri.parse("almanac://toggle/" + Uri.encode(id)));
        row.setOnClickPendingIntent(
            R.id.task_check,
            PendingIntent.getBroadcast(context, 0, toggle, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE)
        );
        row.setOnClickPendingIntent(R.id.task_title, open(context, "day/" + due));
        return row;
    }

    // A line in place of tasks, opening today in the app.
    private static void note(Context context, RemoteViews views, int text, String today) {
        RemoteViews row = new RemoteViews(context.getPackageName(), R.layout.widget_note);
        row.setTextViewText(R.id.note_text, context.getString(text));
        row.setOnClickPendingIntent(R.id.note_text, open(context, "day/" + today));
        views.addView(R.id.widget_rows, row);
    }

    // Opens the app at `place`. Each place is a different address, so each gets its own intent.
    private static PendingIntent open(Context context, String place) {
        Intent intent = new Intent(context, MainActivity.class)
            .setAction(ACTION_OPEN)
            .setData(Uri.parse("almanac://" + place))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return PendingIntent.getActivity(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    // The widget's height in dp, as the home screen gives it (upright, the larger of two).
    private static int heightOf(AppWidgetManager manager, int widgetId) {
        int height = manager.getAppWidgetOptions(widgetId).getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0);
        return height > 0 ? height : DEFAULT_DP;
    }

    // "Wed, Oct 28" or "Oct 26", in the phone's language.
    private static String formatDay(Context context, String date, String skeleton) {
        String pattern = DateFormat.getBestDateTimePattern(Locale.getDefault(), skeleton);
        return DateFormat.format(pattern, WidgetStore.parse(date)).toString();
    }

    // When the app gave this copy (`at`, in milliseconds): "updated 9:41 AM", or "updated Oct 27"
    // on an earlier day.
    private static String updated(Context context, long at, String today) {
        if (at <= 0) return "";
        Date when = new Date(at);
        String day = DateFormat.format("yyyy-MM-dd", when).toString();
        String shown = day.equals(today) ? DateFormat.getTimeFormat(context).format(when) : formatDay(context, day, "MMMd");
        return context.getString(R.string.widget_updated, shown);
    }
}
