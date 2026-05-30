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
