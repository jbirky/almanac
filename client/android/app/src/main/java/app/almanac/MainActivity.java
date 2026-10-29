package app.almanac;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // The app's own plugin, for the Today widget.
        registerPlugin(WidgetPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
