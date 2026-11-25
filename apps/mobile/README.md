# @kinboard/mobile

A Capacitor 7 shell around the shared web UI. Native projects (`android/`, `ios/`) are generated rather than committed:

```bash
pnpm install                     # from the repo root (installs the Capacitor deps)
cd apps/mobile
npx cap add android && npx cap add ios
pnpm sync                        # builds apps/web and copies it into the native projects
pnpm android                     # or: pnpm ios (macOS + Xcode)
```

The app opens the `#/app` route. Before shipping, set `VITE_API_URL` to your server.
Planned native plugins: push (APNs/FCM), with UnifiedPush via ntfy as the de-Googled alternative, haptics, camera (photo upload), and QR pairing through zxing-wasm.
This package is excluded from `pnpm dev`.
