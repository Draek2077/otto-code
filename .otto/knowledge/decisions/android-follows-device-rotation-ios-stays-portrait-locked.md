---
id: "android-follows-device-rotation-ios-stays-portrait-locked"
kind: "decision"
title: "Android follows device rotation; iOS stays portrait-locked"
status: "confirmed"
tags: ["android", "mobile", "orientation", "tablet", "expo"]
created_at: "2026-08-18T01:35:10.316Z"
updated_at: "2026-08-18T01:35:10.316Z"
---

# Android follows device rotation; iOS stays portrait-locked

<!-- compiled_truth -->

The mobile app unlocks screen rotation on Android only: the app follows the device's auto-rotate setting (landscape available on tablets; phones stay portrait unless the user enables auto-rotate in the OS — the OS rotation lock is the user's escape hatch). iOS remains portrait-locked. Implemented as a config plugin (packages/app/plugins/with-android-rotation.js, registered in packages/app/app.config.js) writing android:screenOrientation="unspecified", because Expo's top-level `orientation` key is shared by both platforms and its only unlocking value "default" would also enable all four iOS orientations.

## Timeline

- time: "2026-08-18T01:35:10.316Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-18T01:35:10.316Z"
  kind: "evidence"
  summary: "User request: landscape is not helpful on phones but helpful on tablets, so unlock it; users who want a lock use their phone's rotation lock. Verified via `npx expo prebuild -p android`: generated android/app/src/main/AndroidManifest.xml carries android:screenOrientation=\"unspecified\" on .MainActivity; top-level orientation stays \"portrait\" for iOS."
