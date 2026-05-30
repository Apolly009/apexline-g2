import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { deflateSync } from "node:zlib";

const outDir = resolve("release-assets");
mkdirSync(outDir, { recursive: true });

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data = Buffer.alloc(0)) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function writePng(path, width, height, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;

  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0;
    pixels.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", header),
      chunk("IDAT", deflateSync(raw, { level: 9 })),
      chunk("IEND"),
    ]),
  );
}

function createSurface(width, height, bg = 0) {
  const pixels = Buffer.alloc(width * height * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = bg;
    pixels[i + 1] = bg;
    pixels[i + 2] = bg;
    pixels[i + 3] = 255;
  }
  return { width, height, pixels };
}

function blendPixel(surface, x, y, shade, alpha = 1) {
  const px = Math.round(x);
  const py = Math.round(y);
  if (px < 0 || px >= surface.width || py < 0 || py >= surface.height) return;
  const index = (py * surface.width + px) * 4;
  const next = Math.max(0, Math.min(255, shade));
  const a = Math.max(0, Math.min(1, alpha));
  surface.pixels[index] = Math.round(surface.pixels[index] * (1 - a) + next * a);
  surface.pixels[index + 1] = Math.round(surface.pixels[index + 1] * (1 - a) + next * a);
  surface.pixels[index + 2] = Math.round(surface.pixels[index + 2] * (1 - a) + next * a);
  surface.pixels[index + 3] = 255;
}

function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
  const x = ax + t * dx;
  const y = ay + t * dy;
  return Math.hypot(px - x, py - y);
}

function strokePolyline(surface, points, width, shade, alpha = 1) {
  const radius = width / 2;
  for (let i = 0; i < points.length - 1; i += 1) {
    const [ax, ay] = points[i];
    const [bx, by] = points[i + 1];
    const minX = Math.floor(Math.min(ax, bx) - radius - 2);
    const maxX = Math.ceil(Math.max(ax, bx) + radius + 2);
    const minY = Math.floor(Math.min(ay, by) - radius - 2);
    const maxY = Math.ceil(Math.max(ay, by) + radius + 2);
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const d = distanceToSegment(x + 0.5, y + 0.5, ax, ay, bx, by);
        if (d <= radius + 1) {
          blendPixel(surface, x, y, shade, alpha * Math.max(0, Math.min(1, radius + 1 - d)));
        }
      }
    }
  }
  for (const [cx, cy] of points) {
    for (let y = Math.floor(cy - radius - 2); y <= Math.ceil(cy + radius + 2); y += 1) {
      for (let x = Math.floor(cx - radius - 2); x <= Math.ceil(cx + radius + 2); x += 1) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (d <= radius + 1) {
          blendPixel(surface, x, y, shade, alpha * Math.max(0, Math.min(1, radius + 1 - d)));
        }
      }
    }
  }
}

function fillPolygon(surface, points, shade, alpha = 1) {
  const minX = Math.floor(Math.min(...points.map(([x]) => x)));
  const maxX = Math.ceil(Math.max(...points.map(([x]) => x)));
  const minY = Math.floor(Math.min(...points.map(([, y]) => y)));
  const maxY = Math.ceil(Math.max(...points.map(([, y]) => y)));

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      let inside = false;
      for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
        const [xi, yi] = points[i];
        const [xj, yj] = points[j];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
          inside = !inside;
        }
      }
      if (inside) blendPixel(surface, x, y, shade, alpha);
    }
  }
}

function drawApexGlyph(surface, scale = 1, offsetX = 0, offsetY = 0, alpha = 1) {
  const p = (x, y) => [offsetX + x * scale, offsetY + y * scale];
  strokePolyline(surface, [p(254, 762), p(326, 524), p(512, 374), p(698, 524), p(770, 762)], 86 * scale, 215, alpha);
  strokePolyline(surface, [p(322, 506), p(512, 284), p(702, 506)], 78 * scale, 246, alpha);
  strokePolyline(surface, [p(390, 620), p(512, 526), p(634, 620)], 34 * scale, 42, alpha);
  fillPolygon(surface, [p(512, 216), p(584, 352), p(512, 318), p(440, 352)], 250, alpha);
}

function createIcon() {
  const surface = createSurface(1024, 1024, 10);
  drawApexGlyph(surface);
  strokePolyline(surface, [[512, 865], [512, 925]], 18, 156, 0.9);
  writePng(resolve(outDir, "apexbike-icon.png"), surface.width, surface.height, surface.pixels);
}

function createBackground() {
  const surface = createSurface(1920, 1080, 12);
  for (let y = 0; y < surface.height; y += 1) {
    for (let x = 0; x < surface.width; x += 1) {
      const vignette = Math.hypot((x - 960) / 960, (y - 540) / 540);
      const shade = Math.max(7, Math.round(24 - vignette * 12));
      blendPixel(surface, x, y, shade, 1);
    }
  }
  drawApexGlyph(surface, 0.82, 540, 90, 0.88);
  strokePolyline(surface, [[260, 780], [560, 730], [860, 728], [1280, 700], [1660, 638]], 8, 92, 0.6);
  strokePolyline(surface, [[260, 812], [560, 762], [860, 760], [1280, 732], [1660, 670]], 8, 92, 0.6);
  writePng(resolve(outDir, "apexbike-background.png"), surface.width, surface.height, surface.pixels);
}

createIcon();
createBackground();
console.log("Created release-assets/apexbike-icon.png and release-assets/apexbike-background.png");
