import { inflateSync, deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const port = process.env.APEXLINE_SIM_PORT ?? "9898";
const output = process.env.APEXLINE_SCREENSHOT ?? "/private/tmp/apexline-glasses.png";
const preview = process.env.APEXLINE_SCREENSHOT_PREVIEW ?? "/private/tmp/apexline-glasses-black.png";
const response = await fetch(`http://127.0.0.1:${port}/api/screenshot/glasses`);

if (!response.ok) {
  throw new Error(`Simulator screenshot failed: ${response.status} ${response.statusText}`);
}

const bytes = Buffer.from(await response.arrayBuffer());
mkdirSync(dirname(output), { recursive: true });
mkdirSync(dirname(preview), { recursive: true });
writeFileSync(output, bytes);
writeFileSync(preview, compositeGreenAlphaOnBlack(bytes));

console.log(`Saved glasses screenshot: ${output}`);
console.log(`Saved black preview: ${preview}`);

function compositeGreenAlphaOnBlack(bytes) {
  const image = readPng(bytes);
  const composed = Buffer.alloc(image.width * image.height * 4);

  for (let index = 0; index < image.data.length; index += 4) {
    const alpha = image.data[index + 3];
    composed[index] = 0;
    composed[index + 1] = alpha;
    composed[index + 2] = 0;
    composed[index + 3] = 255;
  }

  return encodeRgbaPng(image.width, image.height, composed);
}

function readPng(bytes) {
  let position = 8;
  let width = 0;
  let height = 0;
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
      if (data[8] !== 8 || data[9] !== 6) {
        throw new Error("Expected an 8-bit RGBA PNG from the simulator.");
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

  return { width, height, data };
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

  throw new Error(`Unsupported PNG filter: ${filter}`);
}

function encodeRgbaPng(width, height, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

function pngChunk(type, data) {
  const name = Buffer.from(type, "ascii");
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  name.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([name, data])), 8 + data.length);
  return chunk;
}

function crc32(bytes) {
  const table = crc32.table ??= Array.from({ length: 256 }, (_, index) => {
    let checksum = index;
    for (let bit = 0; bit < 8; bit += 1) {
      checksum = checksum & 1 ? 0xedb88320 ^ (checksum >>> 1) : checksum >>> 1;
    }
    return checksum >>> 0;
  });
  let checksum = 0xffffffff;
  for (const byte of bytes) {
    checksum = table[(checksum ^ byte) & 0xff] ^ (checksum >>> 8);
  }
  return (checksum ^ 0xffffffff) >>> 0;
}
