import {
  CreateStartUpPageContainer,
  ImageContainerProperty,
  ImageRawDataUpdate,
  ImageRawDataUpdateResult,
  ListContainerProperty,
  ListItemContainerProperty,
  OsEventTypeList,
  RebuildPageContainer,
  StartUpPageCreateResult,
  waitForEvenAppBridge
} from "@evenrealities/even_hub_sdk";
import type { GuidanceSnapshot } from "./guidance";

type Bridge = Awaited<ReturnType<typeof waitForEvenAppBridge>>;
type InputHandler = (action: "press" | "double" | "up" | "down") => void;

const MAIN_CONTAINER_ID = 1;
const MAIN_CONTAINER_NAME = "main";
const GLASS_WIDTH = 576;
const GLASS_HEIGHT = 288;
const TILE_WIDTH = 288;
const TILE_HEIGHT = 144;
const IMAGE_TILES = [
  { id: 2, name: "nav-tl", x: 0, y: 0 },
  { id: 3, name: "nav-tr", x: TILE_WIDTH, y: 0 },
  { id: 4, name: "nav-bl", x: 0, y: TILE_HEIGHT },
  { id: 5, name: "nav-br", x: TILE_WIDTH, y: TILE_HEIGHT }
];

export class GlassDisplay {
  private bridge: Bridge | null = null;
  private ready = false;
  private lastContent = "";

  async connect(onInput: InputHandler): Promise<boolean> {
    try {
      this.bridge = await withTimeout(waitForEvenAppBridge(), 2500);
      this.bridge.onEvenHubEvent((event) => {
        const eventType = event.textEvent?.eventType ?? event.listEvent?.eventType ?? event.sysEvent?.eventType;
        if (eventType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
          onInput("double");
        } else if (eventType === OsEventTypeList.SCROLL_TOP_EVENT) {
          onInput("up");
        } else if (eventType === OsEventTypeList.SCROLL_BOTTOM_EVENT) {
          onInput("down");
        } else if (eventType === OsEventTypeList.CLICK_EVENT || eventType == null) {
          onInput("press");
        }
      });

      const created = await this.createPage("Apexline\n\nWaiting for destination...", "startup");
      if (!created) {
        this.bridge = null;
        this.ready = false;
        return false;
      }

      this.ready = true;
      this.lastContent = "";
      return true;
    } catch (error) {
      console.info("Even bridge unavailable; using phone preview only.", error);
      this.bridge = null;
      this.ready = false;
      return false;
    }
  }

  async render(snapshot: GuidanceSnapshot): Promise<void> {
    const content = renderGlassText(snapshot);
    const renderKey = glassRenderKey(snapshot, content);
    if (!this.bridge || !this.ready) {
      this.lastContent = renderKey;
      return;
    }

    if (renderKey === this.lastContent) {
      return;
    }

    if (await this.createPage(content, "rebuild", snapshot)) {
      this.lastContent = renderKey;
    }
  }

  private async createPage(content: string, mode: "startup" | "rebuild", snapshot?: GuidanceSnapshot): Promise<boolean> {
    if (!this.bridge) {
      return false;
    }

    const rows = listRowsForGlass(content);
    const mainList = new ListContainerProperty({
      xPosition: 0,
      yPosition: 0,
      width: GLASS_WIDTH,
      height: GLASS_HEIGHT,
      borderWidth: 0,
      borderColor: 0,
      borderRadius: 0,
      paddingLength: 0,
      containerID: MAIN_CONTAINER_ID,
      containerName: MAIN_CONTAINER_NAME,
      itemContainer: new ListItemContainerProperty({
        itemCount: rows.length,
        itemWidth: 0,
        isItemSelectBorderEn: 0,
        itemName: rows
      }),
      isEventCapture: 1
    });
    const images = IMAGE_TILES.map((tile) => new ImageContainerProperty({
      xPosition: tile.x,
      yPosition: tile.y,
      width: TILE_WIDTH,
      height: TILE_HEIGHT,
      containerID: tile.id,
      containerName: tile.name
    }));

    const page = {
      containerTotalNum: 1 + images.length,
      listObject: [mainList],
      imageObject: images
    };

    if (mode === "rebuild") {
      const rebuilt = await this.bridge.rebuildPageContainer(new RebuildPageContainer(page));
      console.info("[GlassDisplay] rebuildPageContainer", rebuilt);
      if (rebuilt) {
        await this.updateImage(snapshot, content);
      }
      return rebuilt;
    }

    const result = await this.bridge.createStartUpPageContainer(new CreateStartUpPageContainer(page));
    console.info("[GlassDisplay] createStartUpPageContainer", result);
    if (result === StartUpPageCreateResult.success) {
      await this.updateImage(snapshot, content);
      return true;
    }

    const rebuilt = await this.bridge.rebuildPageContainer(new RebuildPageContainer(page));
    console.info("[GlassDisplay] startup fallback rebuildPageContainer", rebuilt);
    if (rebuilt) {
      await this.updateImage(snapshot, content);
    }
    return rebuilt;
  }

  private async updateImage(snapshot: GuidanceSnapshot | undefined, fallbackContent: string): Promise<void> {
    if (!this.bridge) {
      return;
    }

    const tiles = renderGlassImageTiles(snapshot, fallbackContent);
    for (const tile of tiles) {
      const result = await this.bridge.updateImageRawData(
        new ImageRawDataUpdate({
          containerID: tile.id,
          containerName: tile.name,
          imageData: tile.imageData
        })
      );
      console.info("[GlassDisplay] updateImageRawData", tile.name, result);
      if (!ImageRawDataUpdateResult.isSuccess(result)) {
        console.info("[GlassDisplay] image update did not succeed", tile.name, result);
      }
    }
  }
}

export function renderGlassText(snapshot: GuidanceSnapshot): string {
  const divider = "------------------------------";
  if (snapshot.active && snapshot.title !== "Apex Map") {
    const primary = snapshot.primary.startsWith(snapshot.arrow)
      ? snapshot.primary.slice(snapshot.arrow.length).trim()
      : snapshot.primary;
    return [
      snapshot.title.toUpperCase(),
      divider,
      snapshot.arrow,
      primary,
      trimForGlass(snapshot.secondary),
      snapshot.tertiary,
      snapshot.hint
    ].join("\n");
  }

  return [
    snapshot.title.toUpperCase(),
    divider,
    snapshot.primary,
    "",
    trimForGlass(snapshot.secondary),
    "",
    snapshot.tertiary,
    snapshot.hint
  ].join("\n");
}

function trimForGlass(value: string): string {
  return value.length > 92 ? `${value.slice(0, 89)}...` : value;
}

function glassRenderKey(snapshot: GuidanceSnapshot, content: string): string {
  const preview = snapshot.routePreview
    ?.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`)
    .join(";") ?? "";
  return [
    content,
    snapshot.maneuverType ?? "",
    snapshot.modifier ?? "",
    snapshot.turnAngleDegrees ?? "",
    preview
  ].join("\n");
}

function listRowsForGlass(content: string): string[] {
  return content.trim().length > 0 ? [" "] : [" "];
}

function renderGlassImageTiles(
  snapshot: GuidanceSnapshot | undefined,
  fallbackContent: string
): Array<{ id: number; name: string; imageData: string }> {
  const canvas = document.createElement("canvas");
  canvas.width = GLASS_WIDTH;
  canvas.height = GLASS_HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) {
    return [];
  }

  context.fillStyle = "#000000";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.lineCap = "round";
  context.lineJoin = "round";

  if (snapshot?.active && snapshot.title === "Apex Map") {
    drawMapImage(context, snapshot);
  } else if (snapshot?.active) {
    drawArrowImage(context, snapshot);
  } else {
    drawIdleImage(context, snapshot, fallbackContent);
  }

  return IMAGE_TILES.map((tile) => {
    const tileCanvas = document.createElement("canvas");
    tileCanvas.width = TILE_WIDTH;
    tileCanvas.height = TILE_HEIGHT;
    const tileContext = tileCanvas.getContext("2d");
    tileContext?.drawImage(canvas, tile.x, tile.y, TILE_WIDTH, TILE_HEIGHT, 0, 0, TILE_WIDTH, TILE_HEIGHT);
    return {
      id: tile.id,
      name: tile.name,
      imageData: tileCanvas.toDataURL("image/png").split(",")[1] ?? ""
    };
  });
}

function drawArrowImage(context: CanvasRenderingContext2D, snapshot: GuidanceSnapshot): void {
  if (snapshot.offRoute) {
    drawAlert(context, snapshot);
    return;
  }

  drawHudHeader(context, snapshot);
  drawRouteCue(context, snapshot, 32, 48, 226, 204);

  context.textAlign = "left";
  context.fillStyle = "#ffffff";
  context.font = "bold 54px system-ui, sans-serif";
  context.fillText(formatPrimaryDistance(snapshot.primary), 294, 108);

  context.fillStyle = "#ffffff";
  context.font = "bold 31px system-ui, sans-serif";
  context.fillText(formatPrimaryAction(snapshot.primary, snapshot.arrow), 294, 150);

  context.fillStyle = "#b8c3c1";
  context.font = "24px system-ui, sans-serif";
  context.fillText(trimImageLine(snapshot.roadName || snapshot.secondary, 22), 294, 188);

  context.strokeStyle = "rgba(241, 198, 75, 0.75)";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(294, 210);
  context.lineTo(548, 210);
  context.stroke();

  context.fillStyle = "#f1c64b";
  context.font = "bold 23px system-ui, sans-serif";
  context.fillText(trimImageLine(snapshot.tertiary.replace(" | ", "  "), 26), 294, 244);
}

function drawMapImage(context: CanvasRenderingContext2D, snapshot: GuidanceSnapshot): void {
  if (snapshot.offRoute) {
    drawAlert(context, snapshot);
    return;
  }

  drawPreviewRoute(context, snapshot, 108, 72, 360, 182, true);
  drawVehicleMarker(context, GLASS_WIDTH / 2, 244);

  context.fillStyle = "rgba(0, 0, 0, 0.52)";
  roundRect(context, 22, 20, 168, 62, 14);
  context.fill();

  context.fillStyle = "#ffffff";
  context.font = "bold 34px system-ui, sans-serif";
  context.textAlign = "left";
  context.fillText(formatPrimaryDistance(snapshot.primary), 38, 62);

  context.fillStyle = "rgba(0, 0, 0, 0.46)";
  roundRect(context, 306, 22, 234, 60, 14);
  context.fill();

  context.fillStyle = "#f1c64b";
  context.font = "bold 24px system-ui, sans-serif";
  context.fillText(formatPrimaryAction(snapshot.secondary, snapshot.arrow), 324, 58);

  context.fillStyle = "#b8c3c1";
  context.font = "17px system-ui, sans-serif";
  context.fillText(trimImageLine(snapshot.roadName || snapshot.secondary, 22), 324, 78);

}

function drawIdleImage(
  context: CanvasRenderingContext2D,
  snapshot: GuidanceSnapshot | undefined,
  fallbackContent: string
): void {
  const lines = fallbackContent.split("\n").filter(Boolean);
  context.fillStyle = "rgba(241, 198, 75, 0.24)";
  context.beginPath();
  context.arc(288, 70, 48, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#f1c64b";
  context.font = "bold 44px system-ui, sans-serif";
  context.textAlign = "center";
  context.fillText(snapshot?.title ?? lines[0] ?? "Apexline", 288, 116);
  context.fillStyle = "#ffffff";
  context.font = "28px system-ui, sans-serif";
  context.fillText(snapshot?.primary ?? lines[1] ?? "Waiting", 288, 164);
}

function drawHudHeader(context: CanvasRenderingContext2D, snapshot: GuidanceSnapshot): void {
  context.fillStyle = "rgba(241, 198, 75, 0.92)";
  context.fillRect(0, 0, GLASS_WIDTH, 6);
  context.fillStyle = "#b8c3c1";
  context.font = "bold 19px system-ui, sans-serif";
  context.textAlign = "left";
  context.fillText(snapshot.title.replace("Apex ", "").toUpperCase(), 32, 32);
  context.textAlign = "right";
  context.fillText(snapshot.hint.replace(" | ", "  "), 548, 32);
}

function drawRouteCue(
  context: CanvasRenderingContext2D,
  snapshot: GuidanceSnapshot,
  x: number,
  y: number,
  width: number,
  height: number
): void {
  if (isComplexManeuver(snapshot) && snapshot.routePreview && snapshot.routePreview.length > 2) {
    drawPreviewRoute(context, snapshot, x, y, width, height, false);
    return;
  }

  drawTurnGlyph(context, snapshot, x + width / 2, y + height / 2 + 10, Math.min(width, height) / 2.2);
}

function drawTurnGlyph(
  context: CanvasRenderingContext2D,
  snapshot: GuidanceSnapshot,
  centerX: number,
  centerY: number,
  size: number
): void {
  const type = snapshot.maneuverType ?? "";
  const modifier = snapshot.modifier ?? "";

  context.strokeStyle = "#f1c64b";
  context.fillStyle = "#f1c64b";
  context.lineWidth = 18;

  if (type === "roundabout" || type === "rotary") {
    drawRoundaboutGlyph(context, centerX, centerY, size, snapshot.exitNumber);
    return;
  }

  if (modifier.includes("uturn")) {
    drawPath(context, [
      [centerX + size * 0.34, centerY + size * 0.66],
      [centerX + size * 0.34, centerY - size * 0.2],
      [centerX - size * 0.18, centerY - size * 0.52],
      [centerX - size * 0.44, centerY - size * 0.08],
      [centerX - size * 0.44, centerY + size * 0.5]
    ]);
    drawArrowHead(context, centerX - size * 0.44, centerY + size * 0.56, 180, 24);
    return;
  }

  if (type === "fork" || type === "off ramp" || type === "on ramp" || type === "merge") {
    const right = !modifier.includes("left");
    context.strokeStyle = "rgba(255, 255, 255, 0.22)";
    context.lineWidth = 12;
    drawPath(context, [
      [centerX, centerY + size * 0.68],
      [centerX, centerY + size * 0.08],
      [centerX + (right ? -size * 0.52 : size * 0.52), centerY - size * 0.46]
    ]);
    context.strokeStyle = "#f1c64b";
    context.lineWidth = 18;
    drawPath(context, [
      [centerX, centerY + size * 0.68],
      [centerX, centerY + size * 0.05],
      [centerX + (right ? size * 0.54 : -size * 0.54), centerY - size * 0.5]
    ]);
    drawArrowHead(context, centerX + (right ? size * 0.58 : -size * 0.58), centerY - size * 0.54, right ? 45 : -45, 24);
    return;
  }

  if (modifier.includes("right")) {
    const sharp = modifier.includes("sharp");
    const slight = modifier.includes("slight");
    drawPath(context, [
      [centerX - size * 0.28, centerY + size * 0.66],
      [centerX - size * 0.28, centerY + (slight ? -size * 0.1 : size * 0.08)],
      [centerX + (slight ? size * 0.28 : size * 0.55), centerY - (sharp ? size * 0.16 : size * 0.4)]
    ]);
    drawArrowHead(context, centerX + (slight ? size * 0.34 : size * 0.61), centerY - (sharp ? size * 0.16 : size * 0.45), slight ? 35 : 65, 24);
    return;
  }

  if (modifier.includes("left")) {
    const sharp = modifier.includes("sharp");
    const slight = modifier.includes("slight");
    drawPath(context, [
      [centerX + size * 0.28, centerY + size * 0.66],
      [centerX + size * 0.28, centerY + (slight ? -size * 0.1 : size * 0.08)],
      [centerX - (slight ? size * 0.28 : size * 0.55), centerY - (sharp ? size * 0.16 : size * 0.4)]
    ]);
    drawArrowHead(context, centerX - (slight ? size * 0.34 : size * 0.61), centerY - (sharp ? size * 0.16 : size * 0.45), slight ? -35 : -65, 24);
    return;
  }

  drawPath(context, [
    [centerX, centerY + size * 0.68],
    [centerX, centerY - size * 0.54]
  ]);
  drawArrowHead(context, centerX, centerY - size * 0.62, 0, 26);
}

function drawRoundaboutGlyph(
  context: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  size: number,
  exitNumber: number | null | undefined
): void {
  context.lineWidth = 16;
  context.beginPath();
  context.arc(centerX, centerY, size * 0.38, Math.PI * 0.2, Math.PI * 1.82);
  context.stroke();
  drawArrowHead(context, centerX + size * 0.34, centerY - size * 0.24, 45, 22);

  context.fillStyle = "#ffffff";
  context.font = "bold 28px system-ui, sans-serif";
  context.textAlign = "center";
  context.fillText(exitNumber ? `EX ${exitNumber}` : "EXIT", centerX, centerY + 10);
}

function drawPreviewRoute(
  context: CanvasRenderingContext2D,
  snapshot: GuidanceSnapshot,
  x: number,
  y: number,
  width: number,
  height: number,
  mapMode: boolean
): void {
  const points = snapshot.routePreview && snapshot.routePreview.length > 1
    ? snapshot.routePreview
    : fallbackPreview(snapshot);
  const displayPoints = mapMode ? stretchPreview(points) : points;
  const pixelPoints = displayPoints.map((point) => [
    x + width / 2 + point.x * width * 0.44,
    y + height - point.y * height * 0.92
  ] as [number, number]);

  context.strokeStyle = mapMode ? "rgba(255, 255, 255, 0.08)" : "rgba(255, 255, 255, 0.18)";
  context.lineWidth = mapMode ? 28 : 24;
  drawPath(context, pixelPoints);

  context.strokeStyle = mapMode ? "rgba(241, 198, 75, 0.48)" : "#f1c64b";
  context.lineWidth = mapMode ? 12 : 14;
  drawPath(context, pixelPoints);

  const end = pixelPoints[pixelPoints.length - 1];
  const beforeEnd = pixelPoints[Math.max(0, pixelPoints.length - 2)];
  const angle = (Math.atan2(end[0] - beforeEnd[0], beforeEnd[1] - end[1]) * 180) / Math.PI;
  context.globalAlpha = mapMode ? 0.58 : 1;
  drawArrowHead(context, end[0], end[1], angle, mapMode ? 26 : 20);
  context.globalAlpha = 1;

  if (!mapMode && isComplexManeuver(snapshot)) {
    drawUnchosenBranch(context, snapshot, x, y, width, height);
  }
}

function drawUnchosenBranch(
  context: CanvasRenderingContext2D,
  snapshot: GuidanceSnapshot,
  x: number,
  y: number,
  width: number,
  height: number
): void {
  const right = !(snapshot.modifier ?? "").includes("left");
  const startX = x + width / 2;
  const startY = y + height * 0.68;
  context.strokeStyle = "rgba(255, 255, 255, 0.22)";
  context.lineWidth = 8;
  drawPath(context, [
    [startX, startY],
    [startX + (right ? -width * 0.28 : width * 0.28), y + height * 0.22]
  ]);
}

function fallbackPreview(snapshot: GuidanceSnapshot): Array<{ x: number; y: number }> {
  const modifier = snapshot.modifier ?? "";
  if (modifier.includes("right")) {
    return [{ x: 0, y: 0 }, { x: 0, y: 0.42 }, { x: 0.58, y: 0.84 }];
  }
  if (modifier.includes("left")) {
    return [{ x: 0, y: 0 }, { x: 0, y: 0.42 }, { x: -0.58, y: 0.84 }];
  }
  return [{ x: 0, y: 0 }, { x: 0, y: 0.95 }];
}

function stretchPreview(points: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> {
  const minY = points[0]?.y ?? 0;
  const maxY = Math.max(...points.map((point) => point.y));
  const spanY = maxY - minY;
  const maxAbsX = Math.max(0.2, ...points.map((point) => Math.abs(point.x)));

  if (spanY < 0.18) {
    return points.map((point, index) => ({
      x: clampNumber(point.x / maxAbsX * 0.55, -1, 1),
      y: points.length === 1 ? 0 : index / (points.length - 1)
    }));
  }

  return points.map((point) => ({
    x: clampNumber(point.x / maxAbsX * 0.62, -1, 1),
    y: clampNumber((point.y - minY) / spanY, 0, 1)
  }));
}

function drawVehicleMarker(context: CanvasRenderingContext2D, x: number, y: number): void {
  context.fillStyle = "rgba(110, 225, 199, 0.58)";
  context.beginPath();
  context.moveTo(x, y - 20);
  context.lineTo(x + 18, y + 20);
  context.lineTo(x, y + 12);
  context.lineTo(x - 18, y + 20);
  context.closePath();
  context.fill();
}

function drawAlert(context: CanvasRenderingContext2D, snapshot: GuidanceSnapshot): void {
  context.fillStyle = "#f1c64b";
  context.font = "bold 48px system-ui, sans-serif";
  context.textAlign = "center";
  context.fillText("REROUTE", 288, 110);
  context.fillStyle = "#ffffff";
  context.font = "30px system-ui, sans-serif";
  context.fillText(trimImageLine(snapshot.secondary, 32), 288, 156);
  context.fillStyle = "#b8c3c1";
  context.font = "24px system-ui, sans-serif";
  context.fillText("Check route on phone", 288, 202);
}

function drawPath(context: CanvasRenderingContext2D, points: Array<[number, number]>): void {
  if (points.length < 2) {
    return;
  }

  context.beginPath();
  context.moveTo(points[0][0], points[0][1]);
  for (const point of points.slice(1)) {
    context.lineTo(point[0], point[1]);
  }
  context.stroke();
}

function drawArrowHead(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  degrees: number,
  size: number
): void {
  const radians = (degrees * Math.PI) / 180;
  const back = radians + Math.PI;
  const left = back - Math.PI * 0.22;
  const right = back + Math.PI * 0.22;
  context.fillStyle = "#f1c64b";
  context.beginPath();
  context.moveTo(x, y);
  context.lineTo(x + Math.sin(left) * size, y - Math.cos(left) * size);
  context.lineTo(x + Math.sin(right) * size, y - Math.cos(right) * size);
  context.closePath();
  context.fill();
}

function roundRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
}

function isComplexManeuver(snapshot: GuidanceSnapshot): boolean {
  const type = snapshot.maneuverType ?? "";
  const modifier = snapshot.modifier ?? "";
  return ["fork", "off ramp", "on ramp", "merge", "roundabout", "rotary"].includes(type) ||
    modifier.includes("sharp") ||
    modifier.includes("slight") ||
    modifier.includes("uturn");
}

function formatPrimaryDistance(value: string): string {
  const match = /(\d+(?:\.\d+)?\s?(?:mi|m|ft|km))/.exec(value);
  return match?.[1] ?? trimImageLine(value.replace(/^MAP /, ""), 10);
}

function formatPrimaryAction(value: string, arrow: string): string {
  return trimImageLine(stripLeadingArrow(value.replace(/^MAP /, ""), arrow).replace(/^\d+(?:\.\d+)?\s?(?:mi|m|ft|km)\s*/i, ""), 18);
}

function stripLeadingArrow(value: string, arrow: string): string {
  return value.startsWith(arrow) ? value.slice(arrow.length).trim() : value;
}

function trimImageLine(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(new Error("Timed out waiting for Even bridge"));
    }, timeoutMs);

    promise.then(
      (value) => {
        window.clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timeout);
        reject(error);
      }
    );
  });
}
