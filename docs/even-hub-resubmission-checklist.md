# Even Hub Resubmission Checklist

Use this before uploading ApexLine after a review rejection.

## Rejection Fixes

- `app.json` must whitelist every bundled `https://` URL.
- The glasses launch path should render the ApexLine HUD/home UI directly.
  Do not reintroduce the old `ApexLine started` / `Continue on phone`
  startup text because testers reported real glasses could stay stuck there.
- Listing screenshots must come from the latest Even Hub simulator and must use
  the transparent PNG files, not the black preview copies.

## Checks

```bash
npm run release:check
```

This runs the build, whitelist scan, listing screenshot validation, and package
step.

## Hub Listing Permissions

Select these permissions in the Even Hub listing form:

- Location
- Local network
- Run background services

Keep `app.json` limited to CLI-supported package permissions. The Hub listing
permission picker can expose additional review/runtime permissions that are not
accepted by the local package schema.

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
