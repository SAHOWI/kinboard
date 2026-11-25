#!/bin/sh
# Hardened kiosk flags: no pinch zoom, no swipe-back navigation, no error dialogs, no first-run UI.
exec chromium-browser \
  --kiosk --app="${KINBOARD_URL}" \
  --ozone-platform=wayland \
  --noerrdialogs --disable-infobars --no-first-run \
  --disable-pinch --overscroll-history-navigation=0 \
  --disable-features=Translate,TouchpadOverscrollHistoryNavigation \
  --autoplay-policy=no-user-gesture-required \
  --check-for-update-interval=31536000
