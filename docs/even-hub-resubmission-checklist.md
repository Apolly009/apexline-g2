# Even Hub Resubmission Checklist

Use this before uploading Apexline after a review rejection.

## Rejection Fixes

- `app.json` must whitelist every bundled `https://` URL.
- The glasses launch path must briefly show normal-process text:
  `Apexline started` / `Continue on phone`.
- Listing screenshots must come from the latest Even Hub simulator and must use
  the transparent PNG files, not the black preview copies.

## Checks

```bash
npm run release:check
```

This runs the build, whitelist scan, listing screenshot validation, and package
step.

## Screenshot Capture

Start the app and latest simulator:

```bash
npm run dev -- --port 5173
evenhub-simulator --automation-port 9898 http://localhost:5173
```

Capture the glasses display through the simulator screenshot API:

```bash
npm run listing:screenshot:home
```

Repeat after navigating the simulator glasses display to the relevant states:

```bash
npm run listing:screenshot:arrow
npm run listing:screenshot:map
```

Validate the final listing screenshots:

```bash
npm run listing:screenshots:validate
```

The upload set is:

- `release-assets/listing-screenshots/01-home-transparent.png`
- `release-assets/listing-screenshots/02-arrow-navigation-transparent.png`
- `release-assets/listing-screenshots/03-map-navigation-transparent.png`
