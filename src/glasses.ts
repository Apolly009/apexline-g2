import {
  CreateStartUpPageContainer,
  ImageContainerProperty,
  ImageRawDataUpdate,
  ImageRawDataUpdateResult,
  OsEventTypeList,
  RebuildPageContainer,
  StartUpPageCreateResult,
  TextContainerProperty,
  waitForEvenAppBridge
} from "@evenrealities/even_hub_sdk";
import type { GuidanceSnapshot } from "./guidance";

type Bridge = Awaited<ReturnType<typeof waitForEvenAppBridge>>;
type InputHandler = (action: "press" | "double" | "up" | "down" | "long") => void;

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
const HUD_PRIMARY = "#7cff9e";
const HUD_TEXT = "#ddffe3";
const HUD_MUTED = "#82aa8d";
const HUD_FAINT = "rgba(124, 255, 158, 0.2)";
const HUD_AMBER = "#f7d263";
const MENU_X = 112;
const SPLASH_ROUTE_ROTATION_DEGREES = 45;
const SPLASH_ROUTE_SCALE = 2.05;
const SPLASH_ROUTE_CENTER: Point = [288, 148];
const SPLASH_HULFTEGG_COORDINATES: CoordinatePoint[] = [
  [8.975566, 47.369084],
  [8.975753, 47.369295],
  [8.975804, 47.369368],
  [8.975833, 47.369408],
  [8.975862, 47.369436],
  [8.975883, 47.369451],
  [8.975903, 47.369461],
  [8.975927, 47.369469],
  [8.975955, 47.369472],
  [8.975981, 47.369471],
  [8.976006, 47.369464],
  [8.976025, 47.369453],
  [8.97604, 47.36944],
  [8.976051, 47.369424],
  [8.976053, 47.369405],
  [8.976047, 47.369384],
  [8.976032, 47.369355],
  [8.976013, 47.369328],
  [8.975903, 47.369188],
  [8.975753, 47.368988],
  [8.975657, 47.368836],
  [8.975638, 47.368796],
  [8.975626, 47.368767],
  [8.975611, 47.368728],
  [8.975598, 47.368688],
  [8.975563, 47.368534],
  [8.975531, 47.368372],
  [8.975484, 47.368149]
];
const SPLASH_HULFTEGG_POINTS = projectHulfteggCorner(SPLASH_HULFTEGG_COORDINATES);

type Point = [number, number];
type CoordinatePoint = [number, number];

export class GlassDisplay {
  private bridge: Bridge | null = null;
  private ready = false;
  private lastContent = "";

  async connect(onInput: InputHandler): Promise<boolean> {
    try {
      this.bridge = await withTimeout(waitForEvenAppBridge(), 2500);
      this.bridge.onEvenHubEvent((event) => {
        const eventType = event.textEvent?.eventType ?? event.listEvent?.eventType ?? event.sysEvent?.eventType;
        const normalizedEventType = OsEventTypeList.fromJson(eventType) ?? eventType;
        const rawEventType = eventTypeText(event, normalizedEventType);

        if (/LONG|HOLD/.test(rawEventType)) {
          onInput("long");
        } else if (/DOUBLE/.test(rawEventType) || normalizedEventType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
          onInput("double");
        } else if (/CLICK/.test(rawEventType) || normalizedEventType === OsEventTypeList.CLICK_EVENT) {
          onInput("press");
        } else if (/SCROLL_TOP|SCROLL_UP|SWIPE_UP|\bUP\b/.test(rawEventType) || normalizedEventType === OsEventTypeList.SCROLL_TOP_EVENT) {
          onInput("up");
        } else if (/SCROLL_BOTTOM|SCROLL_DOWN|SWIPE_DOWN|\bDOWN\b/.test(rawEventType) || normalizedEventType === OsEventTypeList.SCROLL_BOTTOM_EVENT) {
          onInput("down");
        } else {
          onInput("press");
        }
      });

      const created = await this.createPage("Apexline\nRide ready\nWaiting for route", "startup");
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
      return;
    }

    if (renderKey === this.lastContent) {
      return;
    }

    await this.updateImage(snapshot, content);
    this.lastContent = renderKey;
  }

  private async createPage(content: string, mode: "startup" | "rebuild", snapshot?: GuidanceSnapshot): Promise<boolean> {
    if (!this.bridge) {
      return false;
    }

    const eventCapture = new TextContainerProperty({
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
      content: "",
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
      textObject: [eventCapture],
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
    const bridge = this.bridge;
    if (!bridge) {
      return;
    }

    const tiles = renderGlassImageTiles(snapshot, fallbackContent);
    await Promise.all(tiles.map(async (tile) => {
      const result = await bridge.updateImageRawData(
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
    }));
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
  const sideRoads = snapshot.sideRoadBranches
    ?.map((branch) => `${branch.roadClass}:${branch.points.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(";")}`)
    .join("|") ?? "";
  return [
    content,
    snapshot.maneuverType ?? "",
    snapshot.modifier ?? "",
    snapshot.turnAngleDegrees ?? "",
    snapshot.showSideRoads ? "side-roads" : "clean",
    snapshot.showSpeed ? snapshot.speedLabel ?? "speed" : "no-speed",
    snapshot.nightMode ? "night" : "day",
    snapshot.arrowLayout ?? "left-arrow",
    snapshot.homeVariant ?? "",
    snapshot.splashFrame ?? "",
    snapshot.splashTravelFrames ?? "",
    snapshot.transitionFrame ?? "",
    snapshot.pickerItems?.map((item) => `${item.selected ? ">" : ""}${item.badge ?? ""}:${item.label}`).join("|") ?? "",
    preview,
    sideRoads
  ].join("\n");
}

function eventTypeText(event: unknown, normalizedEventType: unknown): string {
  const typedEvent = event as {
    textEvent?: { eventType?: unknown };
    listEvent?: { eventType?: unknown; currentSelectItemName?: unknown };
    sysEvent?: { eventType?: unknown };
  };

  return [
    typedEvent.textEvent?.eventType,
    typedEvent.listEvent?.eventType,
    typedEvent.listEvent?.currentSelectItemName,
    typedEvent.sysEvent?.eventType,
    normalizedEventType
  ].map((value) => String(value ?? "")).join(" ").toUpperCase();
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

  if (snapshot.nightMode) {
    drawNightArrowImage(context, snapshot);
    return;
  }

  drawHudHint(context, snapshot);
  if (snapshot.arrowLayout === "bottom") {
    drawRouteCue(context, snapshot, 212, 186, 152, 86);
  } else {
    drawRouteCue(context, snapshot, 44, 58, 168, 180);
  }

  context.fillStyle = HUD_TEXT;
  context.font = "bold 30px system-ui, sans-serif";
  context.textAlign = "right";
  context.fillText(formatPrimaryDistance(snapshot.primary), 534, 108);

  context.strokeStyle = "rgba(247, 210, 99, 0.88)";
  context.lineWidth = 2.4;
  context.beginPath();
  context.moveTo(458, 120);
  context.lineTo(534, 120);
  context.stroke();

  context.fillStyle = HUD_TEXT;
  context.font = "bold 17px system-ui, sans-serif";
  context.fillText(formatPrimaryAction(snapshot.primary, snapshot.arrow), 534, 152);
  drawHudSpeedValue(context, snapshot, 534, 202, "right");

  context.fillStyle = HUD_MUTED;
  context.font = "bold 12px system-ui, sans-serif";
  context.textAlign = "left";
  context.fillText(trimImageLine(snapshot.roadName || snapshot.secondary, 22), 42, 252);

  context.fillStyle = HUD_PRIMARY;
  context.font = "bold 13px system-ui, sans-serif";
  context.textAlign = "right";
  context.fillText(trimImageLine(snapshot.tertiary.replace(" | ", "  "), 24), 534, 252);
}

function drawMapImage(context: CanvasRenderingContext2D, snapshot: GuidanceSnapshot): void {
  if (snapshot.offRoute) {
    drawAlert(context, snapshot);
    return;
  }

  if (snapshot.nightMode) {
    drawNightMapImage(context, snapshot);
    return;
  }

  drawPreviewRoute(context, snapshot, 92, 54, 392, 206, true);
  drawVehicleMarker(context, GLASS_WIDTH / 2, 246);

  context.fillStyle = HUD_TEXT;
  context.font = "bold 26px system-ui, sans-serif";
  context.textAlign = "left";
  context.fillText(formatPrimaryDistance(snapshot.primary), 42, 104);
  context.strokeStyle = "rgba(247, 210, 99, 0.82)";
  context.lineWidth = 2.2;
  context.beginPath();
  context.moveTo(42, 116);
  context.lineTo(110, 116);
  context.stroke();

  context.fillStyle = HUD_PRIMARY;
  context.font = "bold 16px system-ui, sans-serif";
  context.textAlign = "right";
  context.fillText(formatPrimaryAction(snapshot.primary, snapshot.arrow), 534, 152);
  drawHudSpeedValue(context, snapshot, 534, 202, "right");

  context.fillStyle = HUD_MUTED;
  context.font = "bold 11px system-ui, sans-serif";
  context.textAlign = "left";
  context.fillText(trimImageLine(snapshot.roadName || snapshot.secondary, 22), 42, 252);

  context.fillStyle = HUD_PRIMARY;
  context.font = "bold 13px system-ui, sans-serif";
  context.textAlign = "right";
  context.fillText(trimImageLine(snapshot.tertiary.replace(" | ", "  "), 24), 534, 252);
}

function drawNightArrowImage(context: CanvasRenderingContext2D, snapshot: GuidanceSnapshot): void {
  context.save();
  context.globalAlpha = 0.58;
  if (snapshot.arrowLayout === "bottom") {
    drawRouteCue(context, snapshot, 218, 184, 140, 80, true);
  } else {
    drawRouteCue(context, snapshot, 70, 76, 128, 144, true);
  }
  context.restore();
  drawNightDataStack(context, snapshot);
}

function drawNightMapImage(context: CanvasRenderingContext2D, snapshot: GuidanceSnapshot): void {
  context.save();
  context.globalAlpha = 0.62;
  drawPreviewRoute(context, snapshot, 118, 70, 340, 178, true, true);
  context.restore();
  drawNightVehicleMarker(context, GLASS_WIDTH / 2, 246);
  drawNightDataStack(context, snapshot);
}

function drawIdleImage(
  context: CanvasRenderingContext2D,
  snapshot: GuidanceSnapshot | undefined,
  fallbackContent: string
): void {
  const lines = fallbackContent.split("\n").filter(Boolean);
  const title = snapshot?.title ?? lines[0] ?? "Apexline";
  const primary = snapshot?.primary ?? lines[1] ?? "Ride ready";
  const secondary = snapshot?.secondary ?? lines[2] ?? "Waiting for route";
  const tertiary = snapshot?.tertiary ?? snapshot?.hint ?? "";

  if (snapshot?.homeVariant === "splash") {
    drawStartupSplash(context, snapshot.splashFrame ?? 0, snapshot.splashTravelFrames ?? 32);
    return;
  }

  const chromeHint = title === "Choose Start" || title === "Choose Finish" ? "" : snapshot?.hint ?? "";
  drawMenuChrome(context, title, chromeHint);
  if (title === "Choose Start" || title === "Choose Finish") {
    drawFavoriteMenu(context, title, primary, secondary, snapshot?.hint ?? "", snapshot?.pickerItems ?? []);
  } else if (title === "Choose Mode") {
    drawModeMenu(context, snapshot?.pickerItems ?? [], snapshot?.hint ?? "", secondary, snapshot?.homeVariant, snapshot?.transitionFrame ?? 0);
  } else if (title === "Route Ready") {
    drawRouteReadyMenu(context, primary, secondary, tertiary);
  } else if (title === "Settings") {
    drawSettingsMenu(context, primary, secondary, snapshot?.hint ?? "");
  } else if (title === "Speed") {
    drawSpeedOnlyMenu(context, primary, secondary, tertiary, snapshot?.hint ?? "");
  } else {
    drawHomeMenu(context, primary, secondary, tertiary, snapshot?.hint ?? "");
  }
}

function drawModeMenu(
  context: CanvasRenderingContext2D,
  items: NonNullable<GuidanceSnapshot["pickerItems"]>,
  hint: string,
  statusLabel: string,
  variant: GuidanceSnapshot["homeVariant"],
  frame: number
): void {
  if (variant === "transition") {
    drawStartupTransition(context, frame);
  }

  const transitionProgress = variant === "transition" ? Math.min(1, frame / 10) : 1;
  const slideX = (1 - transitionProgress) * 42;
  context.fillStyle = "rgba(221, 255, 227, 0.8)";
  context.font = "bold 13px system-ui, sans-serif";
  context.textAlign = "right";
  context.globalAlpha = transitionProgress;
  context.fillText(trimImageLine(statusLabel, 24), 544, 78);
  context.save();
  context.globalAlpha = Math.max(0.28, transitionProgress);
  context.translate(slideX, 0);
  drawFavoriteList(context, items);
  context.restore();
  context.globalAlpha = 1;
  drawTinyHint(context, hint, MENU_X, 274);
}

function drawStartupSplash(context: CanvasRenderingContext2D, frame: number, travelFrames: number): void {
  const phase = frame % 10;
  const progress = Math.min(1, frame / Math.max(1, travelFrames));
  const roadProgress = Math.min(1, progress + 0.045);
  const marker = splashRoutePoint(progress);
  const markerNext = splashRoutePoint(Math.min(1, progress + 0.025));
  context.save();
  context.textAlign = "center";
  context.setLineDash([]);

  context.strokeStyle = "rgba(124, 255, 158, 0.3)";
  context.lineWidth = 11;
  context.lineCap = "round";
  context.beginPath();
  drawSplashRoutePath(context, 0, 0, roadProgress);
  context.stroke();

  context.strokeStyle = "rgba(0, 0, 0, 0.22)";
  context.lineWidth = 10;
  context.lineCap = "round";
  context.beginPath();
  drawSplashRoutePath(context, 0, 0, roadProgress);
  context.stroke();

  context.strokeStyle = "rgba(124, 255, 158, 0.36)";
  context.lineWidth = 3;
  context.beginPath();
  drawSplashRoutePath(context, 0, 0, roadProgress);
  context.stroke();

  context.strokeStyle = "rgba(221, 255, 227, 0.88)";
  context.lineWidth = 2.2;
  context.setLineDash([14, 11]);
  context.lineDashOffset = -phase * 6;
  context.beginPath();
  drawSplashRoutePath(context, 0, 0, roadProgress);
  context.stroke();
  context.setLineDash([]);

  drawRotatedVehicleMarker(context, marker.x, marker.y, markerNext.x - marker.x, markerNext.y - marker.y, 0.72 + (phase % 3) * 0.05);

  drawMorphingApexline(context, progress);

  context.fillStyle = "rgba(221, 255, 227, 0.78)";
  context.font = "bold 13px system-ui, sans-serif";
  context.fillText("RIDE THE LINE", GLASS_WIDTH / 2, 228);

  context.strokeStyle = "rgba(124, 255, 158, 0.58)";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(226, 246);
  context.lineTo(350, 246);
  context.stroke();

  context.fillStyle = "rgba(221, 255, 227, 0.48)";
  context.font = "bold 10px system-ui, sans-serif";
  context.fillText("TAP TO SKIP", GLASS_WIDTH / 2, 266);
  context.restore();
}

function drawStartupTransition(context: CanvasRenderingContext2D, frame: number): void {
  const progress = Math.min(1, frame / 10);
  const marker = splashRoutePoint(1);
  const markerBack = splashRoutePoint(0.96);
  context.save();
  context.globalAlpha = 1 - progress * 0.72;
  context.strokeStyle = "rgba(124, 255, 158, 0.34)";
  context.lineWidth = 5 - progress * 2;
  context.lineCap = "round";
  context.beginPath();
  drawSplashRoutePath(context, -progress * 28, progress * 8);
  context.stroke();

  drawRotatedVehicleMarker(
    context,
    marker.x - progress * 28,
    marker.y + progress * 8,
    marker.x - markerBack.x,
    marker.y - markerBack.y,
    0.68 - progress * 0.18
  );
  context.globalAlpha = 1 - progress;
  context.fillStyle = HUD_PRIMARY;
  context.font = "bold 27px system-ui, sans-serif";
  context.textAlign = "center";
  context.fillText("APEXLINE", 288, 72 - progress * 18);
  context.restore();
}

function drawMorphingApexline(context: CanvasRenderingContext2D, progress: number): void {
  const apexAlpha = Math.min(1, Math.max(0, (progress - 0.24) / 0.12));
  const lineAlpha = Math.min(1, Math.max(0, (progress - 0.76) / 0.12));
  const merge = Math.min(1, Math.max(0, (progress - 0.86) / 0.14));
  const y = lerp(82, 70, merge);

  context.save();
  context.textAlign = "center";
  if (merge >= 0.98) {
    context.globalAlpha = Math.min(apexAlpha, lineAlpha);
    context.fillStyle = HUD_PRIMARY;
    context.font = "bold 29px system-ui, sans-serif";
    context.fillText("APEXLINE", GLASS_WIDTH / 2, y);
    context.restore();
    return;
  }

  context.font = "bold 24px system-ui, sans-serif";
  context.globalAlpha = apexAlpha;
  context.fillStyle = HUD_PRIMARY;
  context.fillText("APEX", lerp(456, 252, merge), lerp(62, y, merge));

  context.globalAlpha = lineAlpha;
  context.fillStyle = HUD_TEXT;
  context.fillText("LINE", lerp(166, 329, merge), lerp(252, y, merge));
  context.restore();
}

function drawSplashRoutePath(context: CanvasRenderingContext2D, offsetX = 0, offsetY = 0, progress = 1): void {
  const points = splashRoutePointsUpTo(progress);
  points.forEach(([x, y], index) => {
    if (index === 0) {
      context.moveTo(x + offsetX, y + offsetY);
    } else {
      context.lineTo(x + offsetX, y + offsetY);
    }
  });
}

function splashRoutePoint(progress: number): { x: number; y: number } {
  return pointAlongPolyline(SPLASH_HULFTEGG_POINTS, progress);
}

function splashRoutePointsUpTo(progress: number): Point[] {
  const clamped = Math.max(0, Math.min(1, progress));
  if (clamped >= 1) {
    return SPLASH_HULFTEGG_POINTS;
  }

  const totalLength = polylineLength(SPLASH_HULFTEGG_POINTS);
  let remaining = totalLength * clamped;
  const points: Point[] = [SPLASH_HULFTEGG_POINTS[0]];

  for (let index = 1; index < SPLASH_HULFTEGG_POINTS.length; index += 1) {
    const previous = SPLASH_HULFTEGG_POINTS[index - 1];
    const point = SPLASH_HULFTEGG_POINTS[index];
    const segmentLength = Math.hypot(point[0] - previous[0], point[1] - previous[1]);
    if (remaining <= segmentLength) {
      const segmentProgress = segmentLength === 0 ? 0 : remaining / segmentLength;
      points.push([
        lerp(previous[0], point[0], segmentProgress),
        lerp(previous[1], point[1], segmentProgress)
      ]);
      return points;
    }

    remaining -= segmentLength;
    points.push(point);
  }

  return points;
}

function projectHulfteggCorner(coordinates: CoordinatePoint[]): Point[] {
  const centerLon = coordinates.reduce((sum, [lon]) => sum + lon, 0) / coordinates.length;
  const centerLat = coordinates.reduce((sum, [, lat]) => sum + lat, 0) / coordinates.length;
  const latitudeScale = Math.cos((centerLat * Math.PI) / 180);
  const rotation = (SPLASH_ROUTE_ROTATION_DEGREES * Math.PI) / 180;
  const routeMeters = coordinates.map(([lon, lat]) => {
    const x = (lon - centerLon) * 111_320 * latitudeScale;
    const y = -(lat - centerLat) * 111_320;
    return [
      x * Math.cos(rotation) - y * Math.sin(rotation),
      x * Math.sin(rotation) + y * Math.cos(rotation)
    ] as Point;
  });
  const bounds = routeMeters.reduce(
    (box, [x, y]) => ({
      minX: Math.min(box.minX, x),
      maxX: Math.max(box.maxX, x),
      minY: Math.min(box.minY, y),
      maxY: Math.max(box.maxY, y)
    }),
    { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }
  );
  const routeCenterX = (bounds.minX + bounds.maxX) / 2;
  const routeCenterY = (bounds.minY + bounds.maxY) / 2;

  return routeMeters.map(([x, y]) => [
    SPLASH_ROUTE_CENTER[0] + (x - routeCenterX) * SPLASH_ROUTE_SCALE,
    SPLASH_ROUTE_CENTER[1] + (y - routeCenterY) * SPLASH_ROUTE_SCALE
  ]);
}

function pointAlongPolyline(points: Point[], progress: number): { x: number; y: number } {
  const clamped = Math.max(0, Math.min(1, progress));
  const segments = points.slice(1).map((point, index) => {
    const previous = points[index];
    return {
      start: previous,
      end: point,
      length: Math.hypot(point[0] - previous[0], point[1] - previous[1])
    };
  });
  const totalLength = segments.reduce((sum, segment) => sum + segment.length, 0);
  let remaining = totalLength * clamped;

  for (const segment of segments) {
    if (remaining <= segment.length) {
      const segmentProgress = segment.length === 0 ? 0 : remaining / segment.length;
      return {
        x: lerp(segment.start[0], segment.end[0], segmentProgress),
        y: lerp(segment.start[1], segment.end[1], segmentProgress)
      };
    }

    remaining -= segment.length;
  }

  const [x, y] = points[points.length - 1];
  return { x, y };
}

function polylineLength(points: Point[]): number {
  return points.slice(1).reduce((length, point, index) => {
    const previous = points[index];
    return length + Math.hypot(point[0] - previous[0], point[1] - previous[1]);
  }, 0);
}

function drawRotatedVehicleMarker(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  dx: number,
  dy: number,
  scale: number
): void {
  context.save();
  context.translate(x, y);
  context.rotate(Math.atan2(dy, dx) + Math.PI / 2);
  context.scale(scale, scale);
  drawVehicleMarker(context, 0, 0);
  context.restore();
}

function lerp(start: number, end: number, progress: number): number {
  return start + (end - start) * Math.max(0, Math.min(1, progress));
}

function drawMenuChrome(context: CanvasRenderingContext2D, title: string, hint: string): void {
  context.fillStyle = "rgba(124, 255, 158, 0.86)";
  context.fillRect(0, 0, GLASS_WIDTH, 4);

  context.fillStyle = HUD_PRIMARY;
  context.font = "bold 16px system-ui, sans-serif";
  context.textAlign = "left";
  context.fillText(trimImageLine(title.toUpperCase(), 22), 32, 36);

  if (hint) {
    context.fillStyle = HUD_MUTED;
    context.font = "bold 12px system-ui, sans-serif";
    context.textAlign = "right";
    context.fillText(trimImageLine(hint.replace(" | ", "  "), 34), 544, 36);
  }
}

function drawHomeMenu(
  context: CanvasRenderingContext2D,
  primary: string,
  secondary: string,
  tertiary: string,
  hint: string
): void {
  const ready = /ready/i.test(primary);
  drawStatusPill(context, ready ? "READY" : "WAIT", 32, 66, ready ? HUD_PRIMARY : HUD_AMBER);

  context.fillStyle = HUD_TEXT;
  context.font = "bold 24px system-ui, sans-serif";
  context.textAlign = "left";
  context.fillText(trimImageLine(primary, 26), 32, 126);

  drawHomeHintLine(context, 32, 172, secondary);

  if (hint) {
    drawHomeHintLine(context, 32, 218, hint);
  } else if (!/ready/i.test(primary)) {
    drawHomeHintLine(context, 32, 218, tertiary);
  }
}

function drawHomeHintLine(context: CanvasRenderingContext2D, x: number, y: number, label: string): void {
  context.strokeStyle = "rgba(124, 255, 158, 0.18)";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(x, y + 24);
  context.lineTo(x + 420, y + 24);
  context.stroke();

  context.fillStyle = "rgba(221, 255, 227, 0.82)";
  context.font = "bold 15px system-ui, sans-serif";
  context.textAlign = "left";
  context.fillText(trimImageLine(label, 42), x, y + 17);
}

function drawFavoriteMenu(
  context: CanvasRenderingContext2D,
  title: string,
  primary: string,
  secondary: string,
  hint: string,
  items: NonNullable<GuidanceSnapshot["pickerItems"]>
): void {
  const isStart = title === "Choose Start";
  drawStepRail(context, isStart ? 0 : 1);

  context.fillStyle = HUD_MUTED;
  context.font = "bold 14px system-ui, sans-serif";
  context.textAlign = "right";
  context.fillText(secondary, 544, 86);

  if (items.length === 0) {
    context.fillStyle = HUD_TEXT;
    context.font = "bold 24px system-ui, sans-serif";
    context.textAlign = "left";
    wrapMenuText(context, primary, 104, 122, 404, 28, 2);
  } else {
    drawFavoriteList(context, items);
  }

  drawTinyHint(context, hint, MENU_X, 274);
}

function drawFavoriteList(
  context: CanvasRenderingContext2D,
  items: NonNullable<GuidanceSnapshot["pickerItems"]>
): void {
  const rowX = MENU_X;
  const rowWidth = 408;
  const rowHeight = 34;
  const rowGap = 8;
  const top = 94;

  items.forEach((item, index) => {
    const y = top + index * (rowHeight + rowGap);
    const selected = Boolean(item.selected);
    context.fillStyle = selected ? "rgba(124, 255, 158, 0.11)" : "rgba(124, 255, 158, 0.025)";
    context.strokeStyle = selected ? "rgba(124, 255, 158, 0.86)" : "rgba(130, 170, 141, 0.2)";
    context.lineWidth = selected ? 2 : 1.25;
    roundRect(context, rowX, y, rowWidth, rowHeight, 7);
    context.fill();
    context.stroke();

    if (selected) {
      context.fillStyle = HUD_PRIMARY;
      context.beginPath();
      context.moveTo(rowX + 11, y + rowHeight / 2);
      context.lineTo(rowX + 20, y + rowHeight / 2 - 7);
      context.lineTo(rowX + 20, y + rowHeight / 2 + 7);
      context.closePath();
      context.fill();
    }

    context.fillStyle = item.disabled ? HUD_MUTED : selected ? HUD_TEXT : "rgba(221, 255, 227, 0.78)";
    context.font = selected ? "bold 15px system-ui, sans-serif" : "bold 13px system-ui, sans-serif";
    context.textAlign = "left";
    context.fillText(trimImageLine(item.label, item.badge ? 29 : 35), rowX + 34, y + 22);

    if (item.badge) {
      context.fillStyle = selected ? HUD_PRIMARY : HUD_MUTED;
      context.font = "bold 11px system-ui, sans-serif";
      context.textAlign = "right";
      context.fillText(item.badge, rowX + rowWidth - 16, y + 22);
    }
  });
}

function drawRouteReadyMenu(
  context: CanvasRenderingContext2D,
  primary: string,
  secondary: string,
  tertiary: string
): void {
  drawStepRail(context, 2);
  drawStatusPill(context, /ready/i.test(primary) ? "READY" : primary.toUpperCase(), MENU_X, 70, HUD_PRIMARY);

  const parts = secondary.split(" -> ");
  context.fillStyle = HUD_TEXT;
  context.font = "bold 20px system-ui, sans-serif";
  context.textAlign = "left";
  context.fillText(trimImageLine(parts[0] ?? "Start", 28), MENU_X, 136);
  context.strokeStyle = HUD_AMBER;
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(MENU_X, 166);
  context.lineTo(MENU_X + 70, 166);
  context.stroke();
  context.fillStyle = HUD_TEXT;
  context.font = "bold 20px system-ui, sans-serif";
  context.fillText(trimImageLine(parts[1] ?? "Destination", 28), MENU_X, 210);

  if (tertiary) {
    context.fillStyle = HUD_AMBER;
    context.font = "bold 14px system-ui, sans-serif";
    context.fillText(trimImageLine(tertiary.toUpperCase(), 20), MENU_X, 250);
  }
}

function drawSettingsMenu(
  context: CanvasRenderingContext2D,
  primary: string,
  secondary: string,
  hint: string
): void {
  context.fillStyle = HUD_MUTED;
  context.font = "bold 15px system-ui, sans-serif";
  context.textAlign = "left";
  context.fillText(trimImageLine(primary, 30), 32, 96);

  context.fillStyle = HUD_TEXT;
  context.font = "bold 28px system-ui, sans-serif";
  context.fillText(trimImageLine(secondary, 22), 32, 158);

  drawTinyHint(context, hint, 32, 270);
}

function drawSpeedOnlyMenu(
  context: CanvasRenderingContext2D,
  primary: string,
  secondary: string,
  tertiary: string,
  hint: string
): void {
  drawMenuChrome(context, "Speed", "");
  context.textAlign = "right";
  context.fillStyle = HUD_PRIMARY;
  context.font = "bold 58px system-ui, sans-serif";
  context.fillText(trimImageLine(primary, 10), 532, 156);

  context.fillStyle = HUD_MUTED;
  context.font = "bold 13px system-ui, sans-serif";
  context.fillText(trimImageLine(tertiary.toUpperCase(), 16), 532, 190);

  context.textAlign = "left";
  context.fillStyle = HUD_TEXT;
  context.font = "bold 18px system-ui, sans-serif";
  context.fillText(trimImageLine(secondary, 22), 40, 154);

  drawTinyHint(context, hint, 40, 270);
}

function drawStatusPill(
  context: CanvasRenderingContext2D,
  label: string,
  x: number,
  y: number,
  color: string
): void {
  context.strokeStyle = color;
  context.lineWidth = 2;
  roundRect(context, x, y, 118, 32, 7);
  context.stroke();
  context.fillStyle = color;
  context.font = "bold 13px system-ui, sans-serif";
  context.textAlign = "center";
  context.fillText(trimImageLine(label, 12), x + 59, y + 22);
}

function drawTinyHint(context: CanvasRenderingContext2D, hint: string, x: number, y: number): void {
  if (!hint) {
    return;
  }

  context.fillStyle = HUD_MUTED;
  context.font = "bold 12px system-ui, sans-serif";
  context.textAlign = "left";
  context.fillText(trimImageLine(hint.replace(" | ", "  "), 42), x, y);
}

function drawStepRail(context: CanvasRenderingContext2D, activeIndex: number): void {
  const steps = [88, 148, 208];

  context.strokeStyle = HUD_FAINT;
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(62, steps[0]);
  context.lineTo(62, steps[2]);
  context.stroke();

  steps.forEach((y, index) => {
    const active = index <= activeIndex;
    context.fillStyle = active ? "rgba(124, 255, 158, 0.86)" : "#000000";
    context.strokeStyle = active ? HUD_PRIMARY : "rgba(130, 170, 141, 0.48)";
    context.lineWidth = 2.5;
    context.beginPath();
    context.arc(62, y, active ? 13 : 11, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  });
}

function wrapMenuText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number
): void {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const testLine = line ? `${line} ${word}` : word;
    if (context.measureText(testLine).width <= maxWidth || !line) {
      line = testLine;
      continue;
    }

    lines.push(line);
    line = word;
    if (lines.length === maxLines - 1) {
      break;
    }
  }

  if (line && lines.length < maxLines) {
    lines.push(line);
  }

  lines.forEach((lineText, index) => {
    const finalText = index === maxLines - 1 && words.join(" ").length > lines.join(" ").length
      ? trimImageLine(lineText, 22)
      : lineText;
    context.fillText(finalText, x, y + index * lineHeight);
  });
}

function drawHudHint(context: CanvasRenderingContext2D, snapshot: GuidanceSnapshot): void {
  if (!snapshot.hint) {
    return;
  }
  context.fillStyle = HUD_MUTED;
  context.font = "bold 12px system-ui, sans-serif";
  context.textAlign = "right";
  context.fillText(trimImageLine(snapshot.hint.replace(" | ", "  "), 32), 548, 28);
}

function drawNightDataStack(context: CanvasRenderingContext2D, snapshot: GuidanceSnapshot): void {
  context.textAlign = "right";
  context.fillStyle = "rgba(124, 255, 158, 0.72)";
  context.font = "bold 25px system-ui, sans-serif";
  context.fillText(formatPrimaryDistance(snapshot.primary), 534, 102);

  context.strokeStyle = "rgba(124, 255, 158, 0.3)";
  context.lineWidth = 1.5;
  context.beginPath();
  context.moveTo(474, 113);
  context.lineTo(534, 113);
  context.stroke();

  context.fillStyle = "rgba(124, 255, 158, 0.64)";
  context.font = "bold 15px system-ui, sans-serif";
  context.fillText(formatPrimaryAction(snapshot.primary, snapshot.arrow), 534, 148);

  if (snapshot.showSpeed && snapshot.speedLabel) {
    context.fillStyle = "rgba(124, 255, 158, 0.68)";
    context.font = "bold 18px system-ui, sans-serif";
    context.fillText(snapshot.speedLabel, 534, 194);
  }

  context.fillStyle = "rgba(124, 255, 158, 0.38)";
  context.font = "bold 11px system-ui, sans-serif";
  context.fillText(trimImageLine(snapshot.tertiary.replace(" | ", "  "), 22), 534, 252);

  context.textAlign = "left";
  context.fillStyle = "rgba(124, 255, 158, 0.32)";
  context.font = "bold 10px system-ui, sans-serif";
  context.fillText(trimImageLine(snapshot.roadName || snapshot.secondary, 20), 42, 252);
}

function drawHudSpeedValue(
  context: CanvasRenderingContext2D,
  snapshot: GuidanceSnapshot,
  x: number,
  y: number,
  align: CanvasTextAlign
): void {
  if (!snapshot.showSpeed || !snapshot.speedLabel) {
    return;
  }

  context.fillStyle = HUD_PRIMARY;
  context.font = "bold 18px system-ui, sans-serif";
  context.textAlign = align;
  context.fillText(snapshot.speedLabel, x, y);
}

function drawRouteCue(
  context: CanvasRenderingContext2D,
  snapshot: GuidanceSnapshot,
  x: number,
  y: number,
  width: number,
  height: number,
  outline = false
): void {
  if (shouldUseRoutePreview(snapshot) && snapshot.routePreview && snapshot.routePreview.length > 2) {
    drawPreviewRoute(context, snapshot, x, y, width, height, false, outline);
    return;
  }

  drawTurnGlyph(context, snapshot, x + width / 2, y + height / 2 + 10, Math.min(width, height) / 2.2, outline);
}

function drawTurnGlyph(
  context: CanvasRenderingContext2D,
  snapshot: GuidanceSnapshot,
  centerX: number,
  centerY: number,
  size: number,
  outline = false
): void {
  const type = snapshot.maneuverType ?? "";
  const modifier = snapshot.modifier ?? "";
  const routeWidth = outline ? 4.2 : 9;
  const straightWidth = outline ? 4 : 8.5;
  const headSize = outline ? 13 : 16;

  context.strokeStyle = HUD_PRIMARY;
  context.fillStyle = HUD_PRIMARY;
  context.lineWidth = routeWidth;

  if (type === "roundabout" || type === "rotary") {
    drawRoundaboutGlyph(context, centerX, centerY, size, snapshot.exitNumber, outline);
    return;
  }

  if (modifier.includes("uturn")) {
    drawPremiumRoutePath(context, [
      [centerX + size * 0.34, centerY + size * 0.66],
      [centerX + size * 0.34, centerY - size * 0.2],
      [centerX - size * 0.18, centerY - size * 0.52],
      [centerX - size * 0.44, centerY - size * 0.08],
      [centerX - size * 0.44, centerY + size * 0.5]
    ], routeWidth, outline);
    drawChevronArrowHead(context, centerX - size * 0.44, centerY + size * 0.56, 180, headSize, outline);
    return;
  }

  if (type === "fork" || type === "off ramp" || type === "on ramp" || type === "merge") {
    const right = !modifier.includes("left");
    context.strokeStyle = "rgba(221, 255, 227, 0.18)";
    context.lineWidth = 6;
    drawSmoothPath(context, [
      [centerX, centerY + size * 0.68],
      [centerX, centerY + size * 0.08],
      [centerX + (right ? -size * 0.52 : size * 0.52), centerY - size * 0.46]
    ]);
    drawPremiumRoutePath(context, [
      [centerX, centerY + size * 0.68],
      [centerX, centerY + size * 0.05],
      [centerX + (right ? size * 0.54 : -size * 0.54), centerY - size * 0.5]
    ], routeWidth, outline);
    drawChevronArrowHead(context, centerX + (right ? size * 0.58 : -size * 0.58), centerY - size * 0.54, right ? 45 : -45, headSize, outline);
    return;
  }

  if (modifier.includes("right")) {
    const sharp = modifier.includes("sharp");
    const slight = modifier.includes("slight");
    drawPremiumRoutePath(context, [
      [centerX - size * 0.28, centerY + size * 0.66],
      [centerX - size * 0.28, centerY + (slight ? -size * 0.1 : size * 0.08)],
      [centerX + (slight ? size * 0.28 : size * 0.55), centerY - (sharp ? size * 0.16 : size * 0.4)]
    ], routeWidth, outline);
    drawChevronArrowHead(context, centerX + (slight ? size * 0.34 : size * 0.61), centerY - (sharp ? size * 0.16 : size * 0.45), slight ? 35 : 65, headSize, outline);
    return;
  }

  if (modifier.includes("left")) {
    const sharp = modifier.includes("sharp");
    const slight = modifier.includes("slight");
    drawPremiumRoutePath(context, [
      [centerX + size * 0.28, centerY + size * 0.66],
      [centerX + size * 0.28, centerY + (slight ? -size * 0.1 : size * 0.08)],
      [centerX - (slight ? size * 0.28 : size * 0.55), centerY - (sharp ? size * 0.16 : size * 0.4)]
    ], routeWidth, outline);
    drawChevronArrowHead(context, centerX - (slight ? size * 0.34 : size * 0.61), centerY - (sharp ? size * 0.16 : size * 0.45), slight ? -35 : -65, headSize, outline);
    return;
  }

  if (!outline) {
    drawLaneRails(context, centerX, centerY, size);
  }
  drawPremiumRoutePath(context, [
    [centerX, centerY + size * 0.68],
    [centerX, centerY - size * 0.5]
  ], straightWidth, outline);
  drawChevronArrowHead(context, centerX, centerY - size * 0.6, 0, headSize, outline);
}

function drawRoundaboutGlyph(
  context: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  size: number,
  exitNumber: number | null | undefined,
  outline = false
): void {
  context.strokeStyle = "rgba(221, 255, 227, 0.11)";
  context.lineWidth = outline ? 7 : 24;
  context.beginPath();
  context.arc(centerX, centerY, size * 0.38, Math.PI * 0.2, Math.PI * 1.82);
  context.stroke();

  context.strokeStyle = HUD_PRIMARY;
  context.lineWidth = outline ? 3.6 : 9;
  context.beginPath();
  context.arc(centerX, centerY, size * 0.38, Math.PI * 0.2, Math.PI * 1.82);
  context.stroke();
  drawChevronArrowHead(context, centerX + size * 0.34, centerY - size * 0.24, 45, outline ? 12 : 16, outline);

  context.fillStyle = HUD_TEXT;
  context.font = "bold 20px system-ui, sans-serif";
  context.textAlign = "center";
  context.fillText(exitNumber ? `EX ${exitNumber}` : "EXIT", centerX, centerY + 10);
}

function drawLaneRails(
  context: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  size: number
): void {
  context.save();
  context.strokeStyle = "rgba(221, 255, 227, 0.1)";
  context.lineWidth = 2;
  context.setLineDash([14, 12]);
  for (const offset of [-22, 22]) {
    context.beginPath();
    context.moveTo(centerX + offset, centerY + size * 0.58);
    context.lineTo(centerX + offset * 0.62, centerY - size * 0.35);
    context.stroke();
  }
  context.restore();
}

function drawPreviewRoute(
  context: CanvasRenderingContext2D,
  snapshot: GuidanceSnapshot,
  x: number,
  y: number,
  width: number,
  height: number,
  mapMode: boolean,
  outline = snapshot.nightMode === true
): void {
  const points = snapshot.routePreview && snapshot.routePreview.length > 1
    ? snapshot.routePreview
    : fallbackPreview(snapshot);
  const transform = identityPreviewTransform;
  const toPixel = (point: { x: number; y: number }): [number, number] => [
    x + width / 2 + point.x * width * 0.44,
    y + height - point.y * height * 0.92
  ];
  const pixelPoints = points.map((point) => toPixel(transform(point)));

  if (snapshot.showSideRoads && snapshot.sideRoadBranches && snapshot.sideRoadBranches.length > 0) {
    drawSideRoadBranches(context, snapshot.sideRoadBranches, transform, toPixel, mapMode);
  }

  context.strokeStyle = mapMode ? "rgba(0, 0, 0, 0.5)" : "rgba(0, 0, 0, 0.5)";
  context.lineWidth = outline ? mapMode ? 11 : 10 : mapMode ? 19 : 22;
  drawSmoothPath(context, pixelPoints);

  context.strokeStyle = mapMode ? "rgba(221, 255, 227, 0.1)" : "rgba(221, 255, 227, 0.12)";
  context.lineWidth = outline ? mapMode ? 5 : 5 : mapMode ? 12 : 14;
  drawSmoothPath(context, pixelPoints);

  context.strokeStyle = mapMode ? "rgba(124, 255, 158, 0.56)" : HUD_PRIMARY;
  context.lineWidth = outline ? mapMode ? 2.4 : 2.6 : mapMode ? 5 : 6;
  drawSmoothPath(context, pixelPoints);

  context.strokeStyle = mapMode ? "rgba(247, 210, 99, 0.42)" : "rgba(247, 210, 99, 0.72)";
  context.lineWidth = outline ? 1.1 : mapMode ? 1.5 : 2.5;
  drawSmoothPath(context, pixelPoints.slice(Math.max(0, pixelPoints.length - 5)));

  const end = pixelPoints[pixelPoints.length - 1];
  const beforeEnd = pixelPoints[Math.max(0, pixelPoints.length - 2)];
  const angle = (Math.atan2(end[0] - beforeEnd[0], beforeEnd[1] - end[1]) * 180) / Math.PI;
  if (!mapMode) {
    context.globalAlpha = outline ? 0.86 : 1;
    drawChevronArrowHead(context, end[0], end[1], angle, outline ? 13 : 18, outline);
    context.globalAlpha = 1;
  }

}

function drawSideRoadBranches(
  context: CanvasRenderingContext2D,
  branches: NonNullable<GuidanceSnapshot["sideRoadBranches"]>,
  transform: (point: { x: number; y: number }) => { x: number; y: number },
  toPixel: (point: { x: number; y: number }) => [number, number],
  mapMode: boolean
): void {
  const sorted = [...branches].sort((a, b) => sideRoadWidth(a.roadClass, mapMode) - sideRoadWidth(b.roadClass, mapMode));
  for (const branch of sorted) {
    const points = branch.points.map((point) => toPixel(transform(point)));
    if (points.length < 2) {
      continue;
    }

    context.strokeStyle = mapMode ? "rgba(221, 255, 227, 0.05)" : "rgba(221, 255, 227, 0.09)";
    context.lineWidth = sideRoadWidth(branch.roadClass, mapMode) + (mapMode ? 5 : 4);
    drawPath(context, points);

    context.strokeStyle = sideRoadColor(branch.roadClass, mapMode);
    context.lineWidth = sideRoadWidth(branch.roadClass, mapMode);
    drawPath(context, points);
  }
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

function identityPreviewTransform(point: { x: number; y: number }): { x: number; y: number } {
  return point;
}

function sideRoadWidth(roadClass: "major" | "medium" | "minor", mapMode: boolean): number {
  if (roadClass === "major") {
    return mapMode ? 6 : 7;
  }
  if (roadClass === "medium") {
    return mapMode ? 4.5 : 5.5;
  }
  return mapMode ? 3 : 4;
}

function sideRoadColor(roadClass: "major" | "medium" | "minor", mapMode: boolean): string {
  if (roadClass === "major") {
    return mapMode ? "rgba(130, 170, 141, 0.34)" : "rgba(130, 170, 141, 0.42)";
  }
  if (roadClass === "medium") {
    return mapMode ? "rgba(130, 170, 141, 0.26)" : "rgba(130, 170, 141, 0.34)";
  }
  return mapMode ? "rgba(130, 170, 141, 0.2)" : "rgba(130, 170, 141, 0.28)";
}

function drawVehicleMarker(context: CanvasRenderingContext2D, x: number, y: number): void {
  context.fillStyle = "rgba(0, 0, 0, 0.52)";
  context.beginPath();
  context.moveTo(x, y - 17);
  context.lineTo(x + 17, y + 17);
  context.lineTo(x, y + 10);
  context.lineTo(x - 17, y + 17);
  context.closePath();
  context.fill();

  context.strokeStyle = "rgba(247, 210, 99, 0.88)";
  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(x, y - 13);
  context.lineTo(x + 12, y + 13);
  context.lineTo(x, y + 7);
  context.lineTo(x - 12, y + 13);
  context.closePath();
  context.stroke();
}

function drawNightVehicleMarker(context: CanvasRenderingContext2D, x: number, y: number): void {
  context.save();
  context.lineCap = "round";
  context.lineJoin = "round";
  context.strokeStyle = "rgba(0, 0, 0, 0.68)";
  context.lineWidth = 8;
  context.beginPath();
  context.moveTo(x, y - 14);
  context.lineTo(x + 13, y + 14);
  context.lineTo(x, y + 8);
  context.lineTo(x - 13, y + 14);
  context.closePath();
  context.stroke();

  context.strokeStyle = "rgba(124, 255, 158, 0.58)";
  context.lineWidth = 2.5;
  context.beginPath();
  context.moveTo(x, y - 14);
  context.lineTo(x + 13, y + 14);
  context.lineTo(x, y + 8);
  context.lineTo(x - 13, y + 14);
  context.closePath();
  context.stroke();
  context.restore();
}

function drawAlert(context: CanvasRenderingContext2D, snapshot: GuidanceSnapshot): void {
  context.fillStyle = HUD_PRIMARY;
  context.font = "bold 36px system-ui, sans-serif";
  context.textAlign = "center";
  context.fillText("REROUTE", 288, 110);
  context.fillStyle = HUD_TEXT;
  context.font = "22px system-ui, sans-serif";
  context.fillText(trimImageLine(snapshot.secondary, 32), 288, 156);
  context.fillStyle = HUD_MUTED;
  context.font = "18px system-ui, sans-serif";
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

function drawSmoothPath(context: CanvasRenderingContext2D, points: Array<[number, number]>): void {
  if (points.length < 2) {
    return;
  }

  context.beginPath();
  context.moveTo(points[0][0], points[0][1]);
  for (let index = 1; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    context.quadraticCurveTo(current[0], current[1], (current[0] + next[0]) / 2, (current[1] + next[1]) / 2);
  }

  const last = points[points.length - 1];
  context.lineTo(last[0], last[1]);
  context.stroke();
}

function drawPremiumRoutePath(
  context: CanvasRenderingContext2D,
  points: Array<[number, number]>,
  lineWidth: number,
  outline = false
): void {
  context.strokeStyle = "rgba(0, 0, 0, 0.62)";
  context.lineWidth = outline ? lineWidth + 4 : lineWidth + 8;
  drawSmoothPath(context, points);

  context.strokeStyle = "rgba(221, 255, 227, 0.1)";
  context.lineWidth = outline ? lineWidth + 1 : lineWidth + 2;
  drawSmoothPath(context, points);

  context.strokeStyle = HUD_PRIMARY;
  context.lineWidth = lineWidth;
  drawSmoothPath(context, points);

  context.strokeStyle = outline ? "rgba(124, 255, 158, 0.22)" : "rgba(247, 210, 99, 0.74)";
  context.lineWidth = outline ? 0.9 : Math.max(1.6, lineWidth * 0.16);
  drawSmoothPath(context, points.slice(Math.max(0, points.length - 2)));
}

function isComplexManeuver(snapshot: GuidanceSnapshot): boolean {
  const type = snapshot.maneuverType ?? "";
  const modifier = snapshot.modifier ?? "";
  return ["fork", "off ramp", "on ramp", "merge", "roundabout", "rotary"].includes(type) ||
    modifier.includes("sharp") ||
    modifier.includes("slight") ||
    modifier.includes("uturn");
}

function shouldUseRoutePreview(snapshot: GuidanceSnapshot): boolean {
  return isComplexManeuver(snapshot) || (snapshot.showSideRoads === true && hasIntersectionSideRoads(snapshot));
}

function hasIntersectionSideRoads(snapshot: GuidanceSnapshot): boolean {
  return (snapshot.sideRoadBranches?.length ?? 0) > 0;
}

function drawChevronArrowHead(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  degrees: number,
  size: number,
  outline = false
): void {
  const radians = (degrees * Math.PI) / 180;
  const back = radians + Math.PI;
  const left = back - Math.PI * 0.24;
  const right = back + Math.PI * 0.24;
  const leftX = x + Math.sin(left) * size;
  const leftY = y - Math.cos(left) * size;
  const rightX = x + Math.sin(right) * size;
  const rightY = y - Math.cos(right) * size;

  context.lineCap = "round";
  context.lineJoin = "round";
  context.strokeStyle = "rgba(0, 0, 0, 0.62)";
  context.lineWidth = outline ? 7 : 13;
  context.beginPath();
  context.moveTo(leftX, leftY);
  context.lineTo(x, y);
  context.lineTo(rightX, rightY);
  context.stroke();

  context.strokeStyle = HUD_PRIMARY;
  context.lineWidth = outline ? 3.4 : 7;
  context.beginPath();
  context.moveTo(leftX, leftY);
  context.lineTo(x, y);
  context.lineTo(rightX, rightY);
  context.stroke();

  if (!outline) {
    context.strokeStyle = "rgba(247, 210, 99, 0.7)";
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x + Math.sin(radians) * size * 0.5, y - Math.cos(radians) * size * 0.5);
    context.stroke();
  }
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
