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

export class GlassDisplay {
  private bridge: Bridge | null = null;
  private ready = false;
  private lastContent = "";
  private lastListSelectIndex = 0;

  async connect(onInput: InputHandler): Promise<boolean> {
    try {
      this.bridge = await withTimeout(waitForEvenAppBridge(), 2500);
      this.bridge.onEvenHubEvent((event) => {
        const eventType = event.textEvent?.eventType ?? event.listEvent?.eventType ?? event.sysEvent?.eventType;
        const normalizedEventType = OsEventTypeList.fromJson(eventType) ?? eventType;
        const rawEventType = eventTypeText(event, normalizedEventType);
        const inferredScroll = this.inferScrollFromListIndex(event.listEvent?.currentSelectItemIndex);

        if (/LONG|HOLD/.test(rawEventType)) {
          onInput("long");
        } else if (/DOUBLE/.test(rawEventType) || normalizedEventType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
          onInput("double");
        } else if (/SCROLL_TOP|SCROLL_UP|SWIPE_UP|\bUP\b/.test(rawEventType) || normalizedEventType === OsEventTypeList.SCROLL_TOP_EVENT) {
          onInput("up");
        } else if (/SCROLL_BOTTOM|SCROLL_DOWN|SWIPE_DOWN|\bDOWN\b/.test(rawEventType) || normalizedEventType === OsEventTypeList.SCROLL_BOTTOM_EVENT) {
          onInput("down");
        } else if (inferredScroll) {
          onInput(inferredScroll);
        } else if (normalizedEventType === OsEventTypeList.CLICK_EVENT || eventType == null) {
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

    const rows = listRowsForGlass();
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

  private inferScrollFromListIndex(index: number | undefined): "up" | "down" | null {
    if (typeof index !== "number" || !Number.isFinite(index)) {
      return null;
    }

    const previousIndex = this.lastListSelectIndex;
    this.lastListSelectIndex = index;
    if (index > previousIndex) {
      return "down";
    }
    if (index < previousIndex) {
      return "up";
    }

    return null;
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
  const sideRoads = snapshot.sideRoadBranches
    ?.map((branch) => `${branch.roadClass}:${branch.points.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(";")}`)
    .join("|") ?? "";
  return [
    content,
    snapshot.maneuverType ?? "",
    snapshot.modifier ?? "",
    snapshot.turnAngleDegrees ?? "",
    snapshot.showSideRoads ? "side-roads" : "clean",
    snapshot.pickerItems?.map((item) => `${item.selected ? ">" : ""}${item.badge ?? ""}:${item.label}`).join("|") ?? "",
    preview,
    sideRoads
  ].join("\n");
}

function listRowsForGlass(): string[] {
  return [" ", " ", " ", " ", " "];
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

  drawHudHeader(context, snapshot);
  drawRouteCue(context, snapshot, 32, 48, 226, 204);

  context.textAlign = "left";
  context.fillStyle = HUD_TEXT;
  context.font = "bold 36px system-ui, sans-serif";
  context.fillText(formatPrimaryDistance(snapshot.primary), 294, 108);

  context.fillStyle = HUD_TEXT;
  context.font = "bold 21px system-ui, sans-serif";
  context.fillText(formatPrimaryAction(snapshot.primary, snapshot.arrow), 294, 150);

  context.fillStyle = HUD_MUTED;
  context.font = "15px system-ui, sans-serif";
  context.fillText(trimImageLine(snapshot.roadName || snapshot.secondary, 28), 294, 184);

  context.strokeStyle = "rgba(124, 255, 158, 0.52)";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(294, 210);
  context.lineTo(548, 210);
  context.stroke();

  context.fillStyle = HUD_PRIMARY;
  context.font = "bold 15px system-ui, sans-serif";
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
  roundRect(context, 22, 20, 150, 54, 10);
  context.fill();

  context.fillStyle = HUD_TEXT;
  context.font = "bold 23px system-ui, sans-serif";
  context.textAlign = "left";
  context.fillText(formatPrimaryDistance(snapshot.primary), 38, 56);

  context.fillStyle = "rgba(0, 0, 0, 0.46)";
  roundRect(context, 314, 22, 216, 54, 10);
  context.fill();

  context.fillStyle = HUD_PRIMARY;
  context.font = "bold 17px system-ui, sans-serif";
  context.fillText(formatPrimaryAction(snapshot.secondary, snapshot.arrow), 328, 54);

  context.fillStyle = HUD_MUTED;
  context.font = "12px system-ui, sans-serif";
  context.fillText(trimImageLine(snapshot.roadName || snapshot.secondary, 24), 328, 72);
  drawSpeedReadout(context, snapshot, 548, 264, "right");
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

  const chromeHint = title === "Choose Start" || title === "Choose Finish" ? "" : snapshot?.hint ?? "";
  drawMenuChrome(context, title, chromeHint);
  if (title === "Choose Start" || title === "Choose Finish") {
    drawFavoriteMenu(context, title, primary, secondary, tertiary, snapshot?.hint ?? "", snapshot?.pickerItems ?? []);
  } else if (title === "Route Ready") {
    drawRouteReadyMenu(context, primary, secondary, tertiary);
  } else if (title === "Settings") {
    drawSettingsMenu(context, primary, secondary, tertiary, snapshot?.hint ?? "");
  } else {
    drawHomeMenu(context, primary, secondary, tertiary, snapshot?.hint ?? "");
  }
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
  drawStatusPill(context, ready ? "READY" : "WAIT", 32, 68, HUD_PRIMARY);

  context.fillStyle = HUD_TEXT;
  context.font = "bold 26px system-ui, sans-serif";
  context.textAlign = "left";
  context.fillText(trimImageLine(primary, 24), 32, 132);

  drawMenuActionRow(context, 32, 168, secondary, "CLICK");
  drawMenuActionRow(context, 32, 222, tertiary, ready ? "PHONE" : "INFO");

  if (!hint) {
    return;
  }
}

function drawFavoriteMenu(
  context: CanvasRenderingContext2D,
  title: string,
  primary: string,
  secondary: string,
  tertiary: string,
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

  drawTinyHint(context, hint || tertiary, 104, 274);
}

function drawFavoriteList(
  context: CanvasRenderingContext2D,
  items: NonNullable<GuidanceSnapshot["pickerItems"]>
): void {
  const rowX = 104;
  const rowWidth = 408;
  const rowHeight = 36;
  const rowGap = 8;
  const top = 92;

  items.forEach((item, index) => {
    const y = top + index * (rowHeight + rowGap);
    const selected = Boolean(item.selected);
    context.fillStyle = selected ? "rgba(124, 255, 158, 0.16)" : "rgba(124, 255, 158, 0.04)";
    context.strokeStyle = selected ? "rgba(124, 255, 158, 0.86)" : "rgba(130, 170, 141, 0.2)";
    context.lineWidth = selected ? 2.5 : 1.5;
    roundRect(context, rowX, y, rowWidth, rowHeight, 8);
    context.fill();
    context.stroke();

    if (selected) {
      context.fillStyle = HUD_PRIMARY;
      context.beginPath();
      context.moveTo(rowX + 12, y + rowHeight / 2);
      context.lineTo(rowX + 22, y + rowHeight / 2 - 8);
      context.lineTo(rowX + 22, y + rowHeight / 2 + 8);
      context.closePath();
      context.fill();
    }

    context.fillStyle = item.disabled ? HUD_MUTED : selected ? HUD_TEXT : "rgba(221, 255, 227, 0.78)";
    context.font = selected ? "bold 16px system-ui, sans-serif" : "bold 14px system-ui, sans-serif";
    context.textAlign = "left";
    context.fillText(trimImageLine(item.label, item.badge ? 28 : 34), rowX + 34, y + 24);

    if (item.badge) {
      context.fillStyle = selected ? HUD_PRIMARY : HUD_MUTED;
      context.font = "bold 11px system-ui, sans-serif";
      context.textAlign = "right";
      context.fillText(item.badge, rowX + rowWidth - 16, y + 23);
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
  drawStatusPill(context, /ready/i.test(primary) ? "READY" : primary.toUpperCase(), 104, 70, HUD_PRIMARY);

  const parts = secondary.split(" -> ");
  context.fillStyle = HUD_TEXT;
  context.font = "bold 21px system-ui, sans-serif";
  context.textAlign = "left";
  context.fillText(trimImageLine(parts[0] ?? "Start", 27), 104, 136);
  context.fillStyle = HUD_MUTED;
  context.font = "bold 15px system-ui, sans-serif";
  context.fillText("TO", 104, 172);
  context.fillStyle = HUD_TEXT;
  context.font = "bold 21px system-ui, sans-serif";
  context.fillText(trimImageLine(parts[1] ?? "Destination", 27), 104, 210);

  drawMenuActionRow(context, 104, 238, tertiary, "PRESS");
}

function drawSettingsMenu(
  context: CanvasRenderingContext2D,
  primary: string,
  secondary: string,
  tertiary: string,
  hint: string
): void {
  context.fillStyle = HUD_MUTED;
  context.font = "bold 15px system-ui, sans-serif";
  context.textAlign = "left";
  context.fillText(trimImageLine(primary, 30), 32, 96);

  context.fillStyle = HUD_TEXT;
  context.font = "bold 28px system-ui, sans-serif";
  context.fillText(trimImageLine(secondary, 22), 32, 158);

  drawMenuActionRow(context, 32, 214, tertiary, "CLICK");
  drawTinyHint(context, hint, 32, 270);
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

function drawMenuActionRow(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  label: string,
  badge: string
): void {
  context.strokeStyle = HUD_FAINT;
  context.lineWidth = 1.5;
  roundRect(context, x, y, 420, 36, 7);
  context.stroke();

  context.fillStyle = "rgba(124, 255, 158, 0.12)";
  roundRect(context, x + 10, y + 7, 66, 22, 5);
  context.fill();
  context.fillStyle = HUD_PRIMARY;
  context.font = "bold 12px system-ui, sans-serif";
  context.textAlign = "center";
  context.fillText(badge, x + 43, y + 23);

  context.fillStyle = HUD_TEXT;
  context.font = "bold 14px system-ui, sans-serif";
  context.textAlign = "left";
  context.fillText(trimImageLine(label, 32), x + 92, y + 24);
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
  const steps: Array<[number, string]> = [
    [86, "S"],
    [148, "F"],
    [210, "GO"]
  ];

  context.strokeStyle = HUD_FAINT;
  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(56, steps[0][0]);
  context.lineTo(56, steps[2][0]);
  context.stroke();

  steps.forEach(([y, label], index) => {
    const active = index <= activeIndex;
    context.fillStyle = active ? HUD_PRIMARY : "#000000";
    context.strokeStyle = active ? HUD_PRIMARY : "rgba(130, 170, 141, 0.48)";
    context.lineWidth = 3;
    context.beginPath();
    context.arc(56, y, 17, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    context.fillStyle = active ? "#000000" : HUD_MUTED;
    context.font = "bold 13px system-ui, sans-serif";
    context.textAlign = "center";
    context.fillText(label, 56, y + 5);
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

function drawHudHeader(context: CanvasRenderingContext2D, snapshot: GuidanceSnapshot): void {
  context.fillStyle = "rgba(124, 255, 158, 0.86)";
  context.fillRect(0, 0, GLASS_WIDTH, 4);
  context.fillStyle = HUD_MUTED;
  context.font = "bold 13px system-ui, sans-serif";
  context.textAlign = "left";
  context.fillText(snapshot.title.replace("Apex ", "").toUpperCase(), 32, 28);

  if (snapshot.showSpeed) {
    drawSpeedReadout(context, snapshot, 548, 28, "right");
    return;
  }

  context.textAlign = "right";
  context.fillText(trimImageLine(snapshot.hint.replace(" | ", "  "), 32), 548, 28);
}

function drawSpeedReadout(
  context: CanvasRenderingContext2D,
  snapshot: GuidanceSnapshot,
  x: number,
  y: number,
  align: CanvasTextAlign
): void {
  if (!snapshot.showSpeed || !snapshot.speedLabel) {
    return;
  }

  context.fillStyle = HUD_TEXT;
  context.font = "bold 16px system-ui, sans-serif";
  context.textAlign = align;
  const metrics = context.measureText(snapshot.speedLabel);
  const width = metrics.width + 20;
  const height = 26;
  const rectX = align === "right" ? x - width : align === "center" ? x - width / 2 : x;
  const rectY = y - 20;
  context.fillStyle = "rgba(0, 0, 0, 0.72)";
  roundRect(context, rectX, rectY, width, height, 6);
  context.fill();
  context.fillStyle = HUD_TEXT;
  context.fillText(snapshot.speedLabel, x, y);
}

function drawRouteCue(
  context: CanvasRenderingContext2D,
  snapshot: GuidanceSnapshot,
  x: number,
  y: number,
  width: number,
  height: number
): void {
  if (shouldUseRoutePreview(snapshot) && snapshot.routePreview && snapshot.routePreview.length > 2) {
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

  context.strokeStyle = HUD_PRIMARY;
  context.fillStyle = HUD_PRIMARY;
  context.lineWidth = 15;

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
    context.strokeStyle = "rgba(221, 255, 227, 0.18)";
    context.lineWidth = 10;
    drawPath(context, [
      [centerX, centerY + size * 0.68],
      [centerX, centerY + size * 0.08],
      [centerX + (right ? -size * 0.52 : size * 0.52), centerY - size * 0.46]
    ]);
    context.strokeStyle = HUD_PRIMARY;
    context.lineWidth = 15;
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

  context.fillStyle = HUD_TEXT;
  context.font = "bold 22px system-ui, sans-serif";
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
  const transform = mapMode ? previewStretchTransform(points) : identityPreviewTransform;
  const toPixel = (point: { x: number; y: number }): [number, number] => [
    x + width / 2 + point.x * width * 0.44,
    y + height - point.y * height * 0.92
  ];
  const pixelPoints = points.map((point) => toPixel(transform(point)));

  if (snapshot.showSideRoads && snapshot.sideRoadBranches && snapshot.sideRoadBranches.length > 0) {
    drawSideRoadBranches(context, snapshot.sideRoadBranches, transform, toPixel, mapMode);
  }

  context.strokeStyle = mapMode ? "rgba(221, 255, 227, 0.06)" : "rgba(221, 255, 227, 0.14)";
  context.lineWidth = mapMode ? 20 : 18;
  drawPath(context, pixelPoints);

  context.strokeStyle = mapMode ? "rgba(124, 255, 158, 0.46)" : HUD_PRIMARY;
  context.lineWidth = mapMode ? 8 : 10;
  drawPath(context, pixelPoints);

  const end = pixelPoints[pixelPoints.length - 1];
  const beforeEnd = pixelPoints[Math.max(0, pixelPoints.length - 2)];
  const angle = (Math.atan2(end[0] - beforeEnd[0], beforeEnd[1] - end[1]) * 180) / Math.PI;
  context.globalAlpha = mapMode ? 0.58 : 1;
  drawArrowHead(context, end[0], end[1], angle, mapMode ? 30 : 24);
  context.globalAlpha = 1;

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

function previewStretchTransform(points: Array<{ x: number; y: number }>): (point: { x: number; y: number }) => { x: number; y: number } {
  const minY = points[0]?.y ?? 0;
  const maxY = Math.max(...points.map((point) => point.y));
  const spanY = maxY - minY;
  const maxAbsX = Math.max(0.2, ...points.map((point) => Math.abs(point.x)));

  if (spanY < 0.18) {
    return (point) => ({
      x: clampNumber(point.x / maxAbsX * 0.55, -1, 1),
      y: clampNumber(point.y / 0.18, 0, 1)
    });
  }

  return (point) => ({
    x: clampNumber(point.x / maxAbsX * 0.62, -1, 1),
    y: clampNumber((point.y - minY) / spanY, 0, 1)
  });
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
  context.fillStyle = "rgba(124, 255, 158, 0.52)";
  context.beginPath();
  context.moveTo(x, y - 20);
  context.lineTo(x + 18, y + 20);
  context.lineTo(x, y + 12);
  context.lineTo(x - 18, y + 20);
  context.closePath();
  context.fill();
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
  context.fillStyle = HUD_PRIMARY;
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

function shouldUseRoutePreview(snapshot: GuidanceSnapshot): boolean {
  return isComplexManeuver(snapshot) || (snapshot.showSideRoads === true && hasIntersectionSideRoads(snapshot));
}

function hasIntersectionSideRoads(snapshot: GuidanceSnapshot): boolean {
  return (snapshot.sideRoadBranches?.length ?? 0) > 0;
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
