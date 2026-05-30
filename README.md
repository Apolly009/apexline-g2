# Apex Bike

Bicycle-first navigation for Even Realities G2. This project is ported from the
stable Apexline main app and keeps the same phone planner, OpenStreetMap map,
favorites, glasses menu, arrow HUD, map HUD, simulator tools, and release flow,
with routing and guidance tuned for bicycles.

## What it does

- Searches destinations with OpenStreetMap Nominatim.
- Shows an OpenStreetMap phone map through Leaflet, including click-to-pin
  start and destination selection.
- Builds bicycle routes with OSRM's public bike profile.
- Automatically recalculates the route after consecutive off-route GPS samples.
- Watches the phone location with high accuracy enabled.
- Provides map-based start selection when phone GPS is unavailable in the
  simulator or WebView.
- Sends compact next-turn guidance to the G2 display through the Even Hub SDK.
- Supports Sport and City modes. Sport uses earlier lookahead and a wider
  off-route tolerance for faster riding; City keeps prompts tighter for slower
  urban riding.
- Supports two G2 guidance styles: arrow prompts and a phone-rendered map HUD
  that sends a forward route preview to the glasses.
- Shows current speed during active guidance when the Speed display setting is
  enabled.
- Supports glasses/ring input:
  - Cold boot shows a short Apex Bike splash, then flows into the glasses home
    menu. Tap/click skips the splash.
  - Home menu: swipe up/down moves between Navigation, Speed, and Settings;
    click selects, double press exits.
  - Favorite picker: swipe up/down cycles saved places, click selects the
    start or finish, double press backs out.
  - Route-ready screen: click starts navigation.
  - Active navigation: click toggles arrow/map HUD, double press stops
    navigation, long press opens compact glasses settings.
  - Glasses settings cover guidance view, ride mode, units, side roads, speed,
    night HUD, arrow position, and control hints.

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

Developer tools are hidden in the normal phone UI. Tap the Apex Bike title five
times to toggle them for the current session, or open with `?devTools=1`.
They reset to hidden on every fresh app load. Dev launch flags remain available
for simulator testing, for example `?devRoute=1&view=map&autoRide=1`.
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

## Build and pack

```bash
npm run build
npm run pack
```

For the full pre-upload gate, run:

```bash
npm run release:check
```

The packaged app is written to:

```text
apexbike.ehpk
```

Before resubmitting to Even Hub, run through
`docs/even-hub-resubmission-checklist.md`.

## Map services

- Phone map tiles: OpenStreetMap standard tile servers through Leaflet.
- Destination search and map pin reverse lookup: OpenStreetMap Nominatim.
- Bicycle routes: OSRM's public bike route API.
- Side-road and cycleway previews: Overpass API.

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
