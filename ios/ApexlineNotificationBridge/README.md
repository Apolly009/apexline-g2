# ApexLine Notification Bridge

Experimental iOS companion scaffold for the official Apple accessory-notification path.

This is not a Bluetooth spoofing path. It uses Apple's iOS 26.5 accessory frameworks:

- `AccessorySetupKit` to select/authorize an accessory.
- `AccessoryNotifications.AccessoryNotificationCenter` to request notification forwarding for that accessory.
- `AccessoryNotifications.NotificationsForwarding` inside an `AccessoryDataProvider` extension to receive forwarded notifications and normalize Blitzer.de PRO-style speed-camera alerts.

## Current Status

This folder now includes an Xcode project for local device testing:

- Project: `ApexlineNotificationBridge.xcodeproj`
- Scheme: `ApexlineNotificationBridge`
- Targets: the iOS companion app plus `ApexlineNotificationBridgeDataProvider.appex`

The user-facing app name is ApexLine. The Xcode project, scheme, and target
identifiers still use their original technical names to avoid a risky project
rename while the bridge is experimental.

It still needs:

- Apple Developer entitlements/provisioning for accessory data provider usage.
- Real hardware validation with Even G2 or a relay accessory.
- A transport decision for how the native bridge injects the alert into the EvenHub WebView. ApexLine accepts the normalized bridge message through `window.postMessage(...)` or the `apexline-native-bridge` custom event, but a separate iOS app cannot directly access the Even Realities app WebView sandbox.

## Run On Phone

1. Open `ios/ApexlineNotificationBridge/ApexlineNotificationBridge.xcodeproj`.
2. Select the `ApexlineNotificationBridge` scheme.
3. Select your iPhone as the run destination.
4. In Signing & Capabilities, choose your Apple Developer team for both targets.
5. Build and run. If Xcode reports missing Accessory Data Provider entitlements, the Apple Developer account needs that capability enabled before the extension can be installed on-device.

## Alert Contract

Send this JSON into ApexLine when a Blitzer notification is parsed:

```json
{
  "type": "apexline.blitzer.alert",
  "alert": {
    "label": "Speed camera",
    "distanceMeters": 600,
    "speedLimitKph": 80,
    "ttlSeconds": 180,
    "source": "accessory"
  }
}
```

Heartbeat only:

```json
{
  "type": "apexline.blitzer.heartbeat",
  "heartbeat": {
    "ttlSeconds": 120,
    "status": "Accessory notification bridge armed"
  }
}
```

## Setup Flow

1. Build the companion app with the `App` and `Shared` sources.
2. Build the `DataProvider` sources into an Accessory Data Provider extension.
3. Pair/select the accessory using `AccessoryForwardingController.showPicker()`.
4. Ask iOS to forward notifications with `AccessoryForwardingController.requestForwarding()`.
5. In the system prompt, enable Blitzer.de PRO notifications for the accessory.
6. The extension parses forwarded Blitzer notification text and emits ApexLine's normalized alert JSON.

## Important Limitation

Even Realities can forward notifications because their own app is the glasses companion. ApexLine's EvenHub app runs inside that app's WebView, so our separate companion cannot directly read or mutate that WebView. The supported bridge still needs either Even exposing a native-to-web message path, or a small accessory/relay/cloud handoff that can pass the normalized JSON into ApexLine.
