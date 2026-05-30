const shots = {
  home: {
    output: "release-assets/listing-screenshots/01-home-transparent.png",
    preview: "release-assets/listing-screenshots/01-home-preview-black.png"
  },
  arrow: {
    output: "release-assets/listing-screenshots/02-arrow-navigation-transparent.png",
    preview: "release-assets/listing-screenshots/02-arrow-navigation-preview-black.png"
  },
  map: {
    output: "release-assets/listing-screenshots/03-map-navigation-transparent.png",
    preview: "release-assets/listing-screenshots/03-map-navigation-preview-black.png"
  }
};

const shot = process.argv[2];

if (!shot || !shots[shot]) {
  console.error(`Usage: node scripts/capture-listing-screenshot.mjs ${Object.keys(shots).join("|")}`);
  process.exit(2);
}

process.env.APEXLINE_SCREENSHOT = shots[shot].output;
process.env.APEXLINE_SCREENSHOT_PREVIEW = shots[shot].preview;

await import("./capture-glasses.mjs");
