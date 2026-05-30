# ApexLine Release Assets

Portal assets for the first EvenHub submission.

- `apexline-icon.png`: square monochrome/greyscale app icon.
- `apexline-background.png`: monochrome/greyscale listing/background image.
- `apexline-glasses-home-screenshot.png`: simulator screenshot from the built-in glasses capture API.

The current EvenHub CLI packs only `app.json` and the built `dist` folder into the `.ehpk`; these images are kept next to the package for manual portal upload.

## EvenHub Upload Packages

Use this folder for portal uploads:

- `evenhub-upload/current/`: the latest package for each active listing.
- `evenhub-upload/apexline-public/`: ApexLine public package history.
- `evenhub-upload/apexline-experimental/`: ApexLine experimental package history.
- `evenhub-upload/apexbike/`: ApexBike package history.

After packaging any worktree, run `npm run packages:collect` from this main ApexLine repo to copy the latest `.ehpk` files back into `evenhub-upload/current/`.

### Version Rule

ApexLine public and ApexLine experimental share the same package id, so their semver numbers must never overlap.

- ApexLine public (`main`) uses even patch numbers: `0.1.2`, `0.1.4`, `0.1.6`, ...
- ApexLine experimental (`main-experimental`) uses odd patch numbers: `0.1.3`, `0.1.5`, `0.1.7`, ...

If a number was ever uploaded to EvenHub for either ApexLine track, do not reuse it on the other track.
