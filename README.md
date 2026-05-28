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
- Supports glasses/ring input:
  - Single press while navigating: toggle arrow and map view.
  - Single press when a route or favorite is selected: start navigation.
  - Swipe up/down while navigating: toggle Moto and Drive modes.
  - Swipe up/down on the favorites screen: cycle saved destinations.
  - Double press: pause navigation.

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
times to toggle them, or open with `?devTools=1`. Dev launch flags remain
available for simulator testing, for example
`?devRoute=1&view=map&drive=1`.

## Build and pack

```bash
npm run build
npm run pack
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

If location does not lock, press "Use current location" after confirming the
Even Realities app has Location permission in iOS/Android settings. For simulator
or local testing, focus the Start field and tap the map to choose a manual
starting point.
