# ApexLine

Moto-first road navigation for Even Realities G2, built for riders and driving
enthusiasts who care about the line, the pass, and the next good road. It
mirrors the native Navigate idea, but uses OSRM driving routes and speed-aware
guidance tuned for motorcycle and spirited car use.

## What it does

- Searches destinations with OpenStreetMap Nominatim.
- Shows an OpenStreetMap phone map through Leaflet, including click-to-pin
  destination selection.
- Builds driving routes with OSRM.
- Automatically recalculates the route after consecutive off-route GPS samples.
- Watches the phone location with high accuracy enabled.
- Provides map-based start selection when phone GPS is unavailable in the
  simulator or WebView.
- Sends compact next-turn guidance to the G2 display through the Even Hub SDK.
- Supports Moto and Drive modes. Moto mode uses earlier lookahead and a wider
  off-route tolerance for faster approach speeds; Drive mode keeps prompts
  tighter for car runs.
- Supports two G2 guidance styles: arrow prompts for glanceable next-turn
  riding, and a phone-rendered map HUD that sends a forward route preview to
  the glasses.
- Shows current speed during active guidance when the Speed display setting is
  enabled.
- `main-experimental` includes experimental HUD heading modes: Travel course,
  phone compass, and G2-facing heading with bounded relative IMU yaw plus
  acceleration-lock assistance when matching phone/G2 motion is available.
- Can show Blitzer.de Pro-style speed camera alerts when an external bridge
  feeds alert distance and speed-limit data into ApexLine. The app cannot read
  another app's iOS notifications directly from the EvenHub WebView.
- Supports glasses/ring input:
  - Cold boot shows a short ApexLine splash, then flows into the glasses home
    menu. Tap/click skips the splash.
  - Home menu: swipe up/down moves between Navigation, Blitzer, and Settings;
    click selects, double press stays at home.
  - Favorite picker: swipe up/down cycles saved places, click selects the
    start or finish, double press backs out.
  - Route-ready screen: click starts navigation.
  - Blitzer screen: click or swipe up confirms the alert, swipe down marks it
    gone, double press backs out.
  - Active navigation: click toggles arrow/map HUD, double press stops
    navigation, long press opens compact glasses settings. Swipe up/down report
    a Blitzer alert when one is active.
  - Glasses settings cover guidance view, ride mode, units, side roads, speed,
    night HUD, arrow position, control hints, and Blitzer alerts.

## Run locally

```bash
npm install
npm run dev -- --port 5173
```

Open:

```text
http://localhost:5173/
```

## Test in the simulator

With the dev server running:

```bash
evenhub-simulator --automation-port 9898 http://localhost:5173
```

Developer tools are hidden in the normal phone UI. Tap the ApexLine title five
times to toggle them for the current session, or open with `?devTools=1`.
They reset to hidden on every fresh app load. Dev launch flags remain available
for simulator testing, for example `?devRoute=1&view=map&autoDrive=1`.
Blitzer alert testing can use the dev-only Simulate Blitzer alert button,
`?blitzer=1&blitzerDistance=600&blitzerSpeed=80`, or the dev console helper
`window.__apexlineBlitzerAlert("Speed camera in 600 m 80 km/h")`.
Heading test flags include `?heading=phone&phoneHeading=90`,
`?heading=glasses&glassesHeading=90`, and
`?heading=glasses&phoneHeading=90&phoneAccelX=0&phoneAccelY=3&glassesImuBase=0&glassesImuZ=45`.
Use `?devSplashMs=12000` to hold the glasses cold-boot splash longer while
checking it in the simulator.
Capture the glasses display without raising the simulator windows with:

```bash
npm run sim:screenshot
```

The simulator screenshot is transparent; the script also writes a black-preview
PNG for easier local review.
Hub listing screenshots should use the transparent files in
`release-assets/listing-screenshots`, not the `*-preview-black.png` review
copies. Validate the listing set with:

```bash
npm run listing:screenshots:validate
```

With dev tools enabled, the phone/browser window also accepts keyboard gesture
testing: Enter is click, ArrowUp/ArrowDown are swipes, D or Escape is double
press, and L is long press.

## Blitzer.de Pro integration

Blitzer.de Pro is treated as an external alert source. A companion bridge can
parse Blitzer.de Pro notification text or native alert data, then call
`window.__apexlineBlitzerAlert(...)` or dispatch the `apexline-blitzer-alert`
custom event with `{ distanceMeters, speedLimitKph, label }`. ApexLine shows the
alert while navigating and also has a standalone Blitzer screen on the glasses
when the Blitzer setting is enabled. Reporting "still there" or "gone" is
tracked locally for now; writing the report back into Blitzer.de Pro still needs
a real companion/app integration path.

The experimental iOS 26.5 accessory-notification bridge scaffold lives in
`ios/ApexLineNotificationBridge`. It uses Apple's AccessorySetupKit,
AccessoryNotifications, and AccessoryTransportExtension APIs; see
`docs/blitzer-notification-bridge.md` for the current architecture and
remaining hardware/entitlement limitations.

## Experimental branch policy

`main-experimental` is the hardware-test branch. It starts from `main`, then
adds current experimental branches with visible experimental labeling so WIP
features can be tested together without changing the stable `main` app.
Current experimental features are marked in the phone settings and glasses
settings where applicable, especially Blitzer.de PRO bridge and G2-facing HUD
heading.

See `docs/g2-heading-hardware-checklist.md` before treating G2-facing heading
as hardware-verified.

See `docs/roadmap.md` for planned follow-up features.

## Build and pack

```bash
npm run build
npm run pack
```

`app.json` requires Even Realities app `2.2.1` or newer for the latest Even
Hub background plug-in fixes.

For the full pre-upload gate, run:

```bash
npm run release:check
```

The packaged app is written to:

```text
apexline.ehpk
```

Before resubmitting to Even Hub, run through
`docs/even-hub-resubmission-checklist.md`.

## Map services

- Phone map tiles: OpenStreetMap standard tile servers through Leaflet.
- Destination search and map pin reverse lookup: OpenStreetMap Nominatim.
- Driving routes: OSRM's public driving route API.

## Real-device notes

This version has **not been verified on physical Even Realities G2 glasses**.
It has been tested in the Evenhub simulator with separate phone/browser and
glasses display windows, but real-device GPS, bridge timing, and ring/glasses
input still need validation on hardware.

The browser preview can verify search, map pin selection, layout, and packaging.
The simulator has separate phone/browser and glasses display windows; check both
when testing. Full turn-by-turn behavior needs a phone/G2 test because the app
depends on the phone WebView location stream and Even bridge delivery.

If location does not lock, press "Use current location" after confirming the
Even Realities app has Location permission in iOS/Android settings. For simulator
or local testing, focus the Start field and tap the map to choose a manual
starting point.
