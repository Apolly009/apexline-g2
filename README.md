# Apexline

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
- Experimental heading modes: Arrow and Map guidance can use phone compass
  heading, or a G2-facing mode that anchors to the phone/GPS course and applies
  bounded relative G2 IMU yaw deltas when the SDK provides them. If heading data
  is unavailable, stale, relative-only, or low accuracy, guidance falls back to
  GPS course/travel heading.
- G2-facing mode can also use strong matching phone/G2 acceleration events as a
  low-trust auto-recenter assist; steady or noisy motion is ignored.
- Supports glasses/ring input:
  - Startup screen: click opens Choose Favorites when favorites are available.
  - Favorite picker: swipe up/down cycles saved places, click selects the
    start or finish, double press backs out.
  - Route-ready screen: click starts navigation.
  - Active navigation: double press stops navigation and returns to the top
    screen.
  - Long press opens compact glasses settings for guidance view, ride mode,
    units, and complex-intersection side roads when the host sends a long/hold
    event. Double press on the startup screen is a fallback settings shortcut.

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
evenhub-simulator http://localhost:5173
```

Developer tools are hidden in the normal phone UI. Tap the Apexline title five
times to toggle them for the current session, or open with `?devTools=1`.
They reset to hidden on every fresh app load. Dev launch flags remain available
for simulator testing, for example `?devRoute=1&view=map&autoDrive=1`.
Heading test flags include `?heading=phone&phoneHeading=90`,
`?heading=glasses&glassesHeading=90`, and
`?heading=glasses&phoneHeading=90&phoneAccelX=0&phoneAccelY=3&glassesImuBase=0&glassesImuZ=45`.
With dev tools enabled, the phone/browser window also accepts keyboard gesture
testing: Enter is click, ArrowUp/ArrowDown are swipes, D or Escape is double
press, and L is long press.

See `docs/g2-heading-hardware-checklist.md` before treating G2-facing heading
as real-device verified.

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

The public Even Hub SDK currently exposes G2 IMU samples as `x/y/z`, but not a
calibrated magnetometer/compass heading. G2-facing heading therefore uses the
phone compass or GPS course as the absolute anchor, then applies bounded
relative G2 IMU yaw deltas only when data is present. Raw G2 IMU-only heading is
intentionally avoided because it would drift without a magnetic or phone/GPS
anchor.

Phone compass anchoring only accepts Safari `webkitCompassHeading` or
standards-based device orientation events where `absolute === true`; relative
orientation `alpha` is ignored because it is not a stable magnetic/course
anchor.

Acceleration lock is only an assist. It compares fresh planar acceleration from
the phone and G2 to infer a phone-to-glasses offset, then gently nudges the
G2-facing anchor when confidence is high enough. It is not used as a standalone
heading source.

If location does not lock, press "Use current location" after confirming the
Even Realities app has Location permission in iOS/Android settings. For simulator
or local testing, focus the Start field and tap the map to choose a manual
starting point.
