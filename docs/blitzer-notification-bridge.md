# Blitzer Notification Bridge

This is the experimental path for receiving Blitzer.de PRO-style speed-camera notifications without spoofing a Bluetooth device.

## Official Apple Path

The bridge is based on three Apple frameworks:

- `AccessorySetupKit`: lets the companion app select and authorize an accessory.
- `AccessoryNotifications`: exposes `AccessoryNotificationCenter.requestForwarding(for:)` and the forwarded notification model.
- `AccessoryTransportExtension`: hosts the Accessory Data Provider extension that can send normalized data to the accessory.

Local SDK verification was done against Xcode's iPhoneOS 26.5 SDK. The public interfaces show:

- `AccessoryNotificationCenter.requestForwarding(for accessory: ASAccessory) async throws -> ForwardingDecision`
- `AccessoryNotificationCenter.forwardingStatus(for accessory: ASAccessory) async throws -> ForwardingDecision`
- `NotificationsForwarding.AccessoryNotificationsHandler.addNotification(_:alertingContext:)`
- `NotificationsForwarding.Session.send(message:)`

## ApexLine Ingestion

ApexLine now accepts a normalized native bridge message:

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

It can arrive through either:

- `window.postMessage(payload, "*")`
- `document.dispatchEvent(new CustomEvent("apexline-native-bridge", { detail: payload }))`

The alert estimator treats each forwarded notification as a correction point.
Between sparse updates, ApexLine integrates the current speed and speed changes
to keep the displayed distance moving instead of freezing at the last reported
value, then snaps/corrects again when the next 150 m or similar notification
arrives.

The iOS data-provider bridge also accepts Blitzer alerts that iOS marks as
suppressed by Focus. That lets Driving Focus hide the normal phone notification
while still using the forwarded notification payload as a silent correction
source for ApexLine. If iOS does not forward a notification at all because the
source app is disabled for notification forwarding, ApexLine cannot recover it.

When iOS removes forwarded Blitzer notifications, the bridge emits
`apexline.blitzer.clear` so ApexLine can hide the warning. ApexLine also has a
fallback pass detector: once the interpolated distance reaches zero, the alert
clears after roughly 250 m of additional travel or after a short zero-distance
timeout if speed data is unavailable.

ApexLine requests the Even Hub background-services permission in the Hub listing
and also requests a screen wake lock during active navigation or active Blitzer
alerts where the WebView supports it. Keep `min_app_version` aligned with Even
host releases that include the locked-phone/background plug-in fixes.

## Hard Limitation

A standalone iOS companion app cannot directly inspect or mutate the Even Realities app's WebView. Even's native app can display notifications because it is the registered glasses companion. For ApexLine, this bridge still needs one final handoff:

- Even exposes a native-to-EvenHub-web message API, or
- the companion app sends the normalized JSON to a small relay endpoint and ApexLine polls/streams it, or
- a real accessory/relay receives the official accessory notification payload and returns the normalized alert to ApexLine.

## Why Not Spoof Bluetooth

iOS notification forwarding is intentionally permissioned around real accessories and user-approved app forwarding. Spoofing a Bluetooth accessory in software is brittle, likely review-hostile, and still would not give ApexLine direct access to the Even app WebView.
