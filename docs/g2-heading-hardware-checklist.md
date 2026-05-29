# G2 Heading Hardware Checklist

Use this on physical Even Realities G2 hardware before calling the G2-facing
heading mode verified.

## Setup

- Install the packed `apexline.ehpk` on a phone connected to the G2.
- Open with dev tools enabled only for the test session.
- Select the dev route from Hulftegg Passhoehe to Schwaegalp Passhoehe, or use a
  known route where the first road direction is obvious.
- In settings, set HUD heading to `G2 facing`.
- Enable the phone compass when prompted, then keep the phone steady in a
  known orientation.

## Evidence To Capture

- Confirm `window.__apexlineDebugState()` reports:
  - `headingSource: "glasses"`
  - a fresh `lastGlassesImuSample`
  - `lastGlassesImuAgeMs` below 1000 while the glasses are moving
  - a plausible `glassesHeadingDegrees`
  - phone heading status from `webkitCompassHeading` or an absolute orientation
    event, not relative-only `alpha`
- In simulator/dev mode, use `window.__apexlineDevGlassImu({ z: 45 })` or the
  launch flags `phoneHeading=90&glassesImuBase=0&glassesImuZ=45` to exercise the
  same yaw math without hardware.
- Rotate the glasses left and right while the phone stays still.
- Confirm Arrow mode and Map mode rotate relative to where the glasses face.
- Confirm the route does not jump, blink, or trigger click/swipe actions during
  IMU streaming.
- Hold the glasses still for at least two minutes and confirm heading does not
  drift away from the phone/GPS anchor.
- Walk or drive a short wrong-way segment and confirm reroute behavior still
  works while G2-facing heading is selected.

## Pass Criteria

- G2 IMU samples arrive on real hardware through `sysEvent.imuData`.
- The current yaw transform makes the HUD rotate in the same direction and rough
  magnitude as the glasses.
- If the SDK values are not yaw-like, keep the mode experimental and adjust the
  transform before merging it to `main`.
- If `imuControl` is unavailable on hardware, G2-facing mode must be treated as
  phone/GPS-anchored fallback only.
