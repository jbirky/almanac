# The Android toolchain for scripts/android/build: JDK 21 and the SDK parts Capacitor 8 needs.
# The `emulator` stage adds an Android 15 emulator, for scripts/android/test.
FROM eclipse-temurin:21-jdk-noble AS build
ENV ANDROID_HOME=/opt/android-sdk
ENV PATH=$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools
RUN apt-get update && apt-get install -y --no-install-recommends unzip curl && rm -rf /var/lib/apt/lists/* \
 && mkdir -p $ANDROID_HOME/cmdline-tools \
 && curl -fsSLo /tmp/tools.zip https://dl.google.com/android/repository/commandlinetools-linux-13114758_latest.zip \
 && unzip -q /tmp/tools.zip -d $ANDROID_HOME/cmdline-tools \
 && mv $ANDROID_HOME/cmdline-tools/cmdline-tools $ANDROID_HOME/cmdline-tools/latest && rm /tmp/tools.zip \
 && yes | sdkmanager --licenses >/dev/null \
 && sdkmanager --install "platform-tools" "platforms;android-36" "build-tools;35.0.0" "build-tools;36.0.0" >/dev/null \
 && chmod -R a+rwX $ANDROID_HOME

FROM build AS emulator
RUN apt-get update && apt-get install -y --no-install-recommends libpulse0 libgl1 libnss3 libxcomposite1 libxcursor1 \
      libxdamage1 libxi6 libxtst6 libasound2t64 libxkbfile1 && rm -rf /var/lib/apt/lists/* \
 && sdkmanager --install "emulator" "system-images;android-35;google_apis;x86_64" >/dev/null \
 && echo no | avdmanager create avd -n test -k "system-images;android-35;google_apis;x86_64" -d pixel_6 >/dev/null \
 && chmod -R a+rwX $ANDROID_HOME /root
