import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

const files = process.argv.slice(2);

if (files.length === 0) {
  console.error("Usage: node scripts/validate-glasses-screenshots.mjs <png>...");
  process.exit(2);
}

let failed = false;

for (const file of files) {
  try {
    const image = readPng(readFileSync(file));
    const alphaStats = image.data.reduce((stats, value, index) => {
      if (index % 4 !== 3) {
        return stats;
      }

      stats.min = Math.min(stats.min, value);
      stats.max = Math.max(stats.max, value);
      if (value > 0) {
        stats.nonTransparent += 1;
      }
      if (value === 255) {
        stats.opaque += 1;
      }
      return stats;
    }, { min: 255, max: 0, nonTransparent: 0, opaque: 0 });

    const issues = [];
    if (image.width !== 576 || image.height !== 288) {
      issues.push(`expected 576x288, got ${image.width}x${image.height}`);
    }
    if (!image.rgba) {
      issues.push("expected RGBA PNG");
    }
    if (alphaStats.min !== 0) {
      issues.push("image has no transparent background pixels");
    }
    if (alphaStats.nonTransparent < 100) {
      issues.push("image appears empty");
    }

    if (issues.length > 0) {
      failed = true;
      console.error(`${file}: FAIL (${issues.join("; ")})`);
    } else {
      console.log(`${file}: OK ${image.width}x${image.height} RGBA, ${alphaStats.nonTransparent} lit pixels`);
    }
  } catch (error) {
    failed = true;
    console.error(`${file}: FAIL (${error instanceof Error ? error.message : String(error)})`);
  }
}

if (failed) {
  process.exit(1);
}

function readPng(bytes) {
  if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    throw new Error("not a PNG");
  }

  let position = 8;
  let width = 0;
  let height = 0;
  let rgba = false;
  const idat = [];

  while (position < bytes.length) {
    const length = bytes.readUInt32BE(position);
    position += 4;
    const type = bytes.toString("ascii", position, position + 4);
    position += 4;
    const data = bytes.subarray(position, position + length);
    position += length + 4;

    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      rgba = data[8] === 8 && data[9] === 6;
      if (!rgba) {
        return { width, height, rgba, data: Buffer.alloc(0) };
      }
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
  }

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const data = Buffer.alloc(width * height * 4);
  let input = 0;

  for (let y = 0; y < height; y += 1) {
    const filter = raw[input];
    input += 1;

    for (let x = 0; x < stride; x += 1) {
      const left = x >= 4 ? data[y * stride + x - 4] : 0;
      const up = y > 0 ? data[(y - 1) * stride + x] : 0;
      const upLeft = y > 0 && x >= 4 ? data[(y - 1) * stride + x - 4] : 0;
      data[y * stride + x] = (raw[input] + pngFilterPrediction(filter, left, up, upLeft)) & 255;
      input += 1;
    }
  }

  return { width, height, rgba, data };
}

function pngFilterPrediction(filter, left, up, upLeft) {
  if (filter === 0) {
    return 0;
  }
  if (filter === 1) {
    return left;
  }
  if (filter === 2) {
    return up;
  }
  if (filter === 3) {
    return Math.floor((left + up) / 2);
  }
  if (filter === 4) {
    const prediction = left + up - upLeft;
    const leftDelta = Math.abs(prediction - left);
    const upDelta = Math.abs(prediction - up);
    const upLeftDelta = Math.abs(prediction - upLeft);
    return leftDelta <= upDelta && leftDelta <= upLeftDelta ? left : upDelta <= upLeftDelta ? up : upLeft;
  }

  throw new Error(`unsupported PNG filter ${filter}`);
}
