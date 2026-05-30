import {
  type Coordinate,
  type IntersectionBranch,
  type RouteResult,
  type RouteStep,
  type TravelMode,
  type UnitSystem,
  bearingDegrees,
  distanceMeters,
  formatDistance,
  formatEta,
  formatSpeed,
  modeLookaheadMeters
} from "./navigation";

export type GuidanceSnapshot = {
  active: boolean;
  title: string;
  primary: string;
  secondary: string;
  tertiary: string;
  hint: string;
  arrow: string;
  nextStepIndex: number;
  distanceToStepMeters: number;
  offRoute: boolean;
  maneuverType?: string;
  modifier?: string;
  roadName?: string;
  exitNumber?: number | null;
  turnAngleDegrees?: number;
  routePreview?: RoutePreviewPoint[];
  sideRoadBranches?: SideRoadPreviewBranch[];
  showSideRoads?: boolean;
  showSpeed?: boolean;
  showControlHints?: boolean;
  nightMode?: boolean;
  arrowLayout?: "left" | "bottom";
  homeVariant?: "splash" | "transition" | "menu";
  splashFrame?: number;
  splashTravelFrames?: number;
  transitionFrame?: number;
  speedLabel?: string;
  pickerItems?: GuidancePickerItem[];
};

export type PositionSample = {
  coordinate: Coordinate;
  speedMetersPerSecond: number | null;
  headingDegrees: number | null;
};

export type RoutePreviewPoint = {
  x: number;
  y: number;
};

export type SideRoadPreviewBranch = {
  points: RoutePreviewPoint[];
  roadClass: IntersectionBranch["roadClass"];
};

export type GuidancePickerItem = {
  label: string;
  badge?: string;
  selected?: boolean;
  disabled?: boolean;
};

export function makeIdleSnapshot(status: string): GuidanceSnapshot {
  return {
    active: false,
    title: "ApexLine",
    primary: status,
    secondary: "Choose a destination on phone",
    tertiary: "Single press repeats | Double exits",
    hint: "Ready",
    arrow: "--",
    nextStepIndex: 0,
    distanceToStepMeters: 0,
    offRoute: false
  };
}

export function makeGuidanceSnapshot(
  route: RouteResult,
  position: PositionSample,
  mode: TravelMode,
  previousStepIndex: number,
  unitSystem: UnitSystem = "imperial"
): GuidanceSnapshot {
  const nearestRouteDistance = nearestDistanceToRoute(route.geometry, position.coordinate);
  const offRoute = nearestRouteDistance > offRouteThresholdMeters(mode, position.speedMetersPerSecond);
  const nextStepIndex = findNextStepIndex(route.steps, position.coordinate, previousStepIndex);
  const step = route.steps[nextStepIndex] ?? route.steps[route.steps.length - 1];

  if (!step) {
    return makeIdleSnapshot("Route has no steps");
  }

  const distanceToStepMeters = distanceMeters(position.coordinate, step.maneuverLocation);
  const lookaheadMeters = modeLookaheadMeters(mode, position.speedMetersPerSecond);
  const soon = distanceToStepMeters <= lookaheadMeters;
  const remainingMeters = estimateRemainingDistance(route, nextStepIndex, distanceToStepMeters);
  const remainingSeconds = estimateRemainingDuration(route, nextStepIndex, distanceToStepMeters);
  const heading = position.headingDegrees ?? bearingDegrees(position.coordinate, step.maneuverLocation);
  const nextBearing = bearingDegrees(position.coordinate, step.maneuverLocation);
  const turnAngle = signedAngleDegrees(heading, step.bearingAfter || nextBearing);

  return {
    active: true,
    title: mode === "motorcycle" ? "Apex Moto" : "Apex Drive",
    primary: offRoute ? "REROUTE NEEDED" : `${stepArrow(step)} ${formatDistance(distanceToStepMeters, unitSystem)}  ${step.shortInstruction}`,
    secondary: offRoute ? "Pull over or tap Re-route" : step.instruction,
    tertiary: `${formatDistance(remainingMeters, unitSystem)} left | ETA ${formatEta(remainingSeconds)}`,
    hint: `${Math.round(heading)} deg | ${soon ? "prepare" : "cruise"}`,
    arrow: stepArrow(step),
    nextStepIndex,
    distanceToStepMeters,
    offRoute,
    speedLabel: formatSpeed(position.speedMetersPerSecond, unitSystem),
    maneuverType: step.maneuverType,
    modifier: step.modifier,
    roadName: step.roadName,
    exitNumber: step.exitNumber,
    turnAngleDegrees: turnAngle,
    routePreview: routePreview(route.geometry, position.coordinate, heading, lookaheadMeters),
    sideRoadBranches: sideRoadPreview(step.intersectionBranches, position.coordinate, heading, lookaheadMeters)
  };
}

function findNextStepIndex(
  steps: RouteStep[],
  current: Coordinate,
  previousStepIndex: number
): number {
  if (steps.length === 0) {
    return 0;
  }

  const startIndex = Math.min(Math.max(previousStepIndex, 0), steps.length - 1);
  let bestIndex = startIndex;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let index = startIndex; index < steps.length; index += 1) {
    const distance = distanceMeters(current, steps[index].maneuverLocation);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }

  if (bestDistance < 35 && bestIndex < steps.length - 1) {
    return bestIndex + 1;
  }

  return bestIndex;
}

function nearestDistanceToRoute(geometry: Coordinate[], current: Coordinate): number {
  if (geometry.length === 0) {
    return 0;
  }

  let nearest = Number.POSITIVE_INFINITY;
  for (let index = 0; index < geometry.length; index += 1) {
    nearest = Math.min(nearest, distanceMeters(current, geometry[index]));
    if (index < geometry.length - 1) {
      nearest = Math.min(nearest, distanceToSegmentMeters(current, geometry[index], geometry[index + 1]));
    }
  }

  return nearest;
}

function distanceToSegmentMeters(current: Coordinate, start: Coordinate, end: Coordinate): number {
  const metersPerDegreeLat = 111320;
  const metersPerDegreeLon = metersPerDegreeLat * Math.cos(toRadians(current.lat));
  const startX = (start.lon - current.lon) * metersPerDegreeLon;
  const startY = (start.lat - current.lat) * metersPerDegreeLat;
  const endX = (end.lon - current.lon) * metersPerDegreeLon;
  const endY = (end.lat - current.lat) * metersPerDegreeLat;
  const segmentX = endX - startX;
  const segmentY = endY - startY;
  const lengthSquared = segmentX * segmentX + segmentY * segmentY;

  if (lengthSquared === 0) {
    return Math.hypot(startX, startY);
  }

  const t = Math.max(0, Math.min(1, -(startX * segmentX + startY * segmentY) / lengthSquared));
  const nearestX = startX + t * segmentX;
  const nearestY = startY + t * segmentY;
  return Math.hypot(nearestX, nearestY);
}

function offRouteThresholdMeters(mode: TravelMode, speedMetersPerSecond: number | null): number {
  const speed = speedMetersPerSecond ?? 0;
  const base = mode === "motorcycle" ? 75 : 65;
  return Math.min(180, base + speed * 2.5);
}

function estimateRemainingDistance(
  route: RouteResult,
  nextStepIndex: number,
  distanceToStepMeters: number
): number {
  const upcoming = route.steps.slice(nextStepIndex + 1);
  return distanceToStepMeters + upcoming.reduce((total, step) => total + step.distanceMeters, 0);
}

function estimateRemainingDuration(
  route: RouteResult,
  nextStepIndex: number,
  distanceToStepMeters: number
): number {
  const nextStep = route.steps[nextStepIndex];
  const currentStepRatio = nextStep
    ? Math.min(1, distanceToStepMeters / Math.max(nextStep.distanceMeters, 1))
    : 0;
  const currentDuration = nextStep ? nextStep.durationSeconds * currentStepRatio : 0;
  const upcoming = route.steps.slice(nextStepIndex + 1);
  return currentDuration + upcoming.reduce((total, step) => total + step.durationSeconds, 0);
}

function stepArrow(step: RouteStep): string {
  const type = step.maneuverType;
  const modifier = step.modifier;

  if (type === "arrive") {
    return "[]";
  }

  if (type === "roundabout" || type === "rotary") {
    return "(o)";
  }

  if (type === "off ramp") {
    return modifier.includes("left") ? "< EXIT" : "EXIT >";
  }

  if (type === "on ramp") {
    return modifier.includes("left") ? "< RAMP" : "RAMP >";
  }

  if (type === "fork") {
    return modifier.includes("left") ? "< KEEP" : "KEEP >";
  }

  if (modifier.includes("left")) {
    return "<--";
  }

  if (modifier.includes("right")) {
    return "-->";
  }

  if (modifier.includes("uturn")) {
    return "U";
  }

  return "^";
}

function routePreview(
  geometry: Coordinate[],
  current: Coordinate,
  headingDegrees: number,
  lookaheadMeters: number
): RoutePreviewPoint[] {
  if (geometry.length === 0) {
    return [];
  }

  const nearestIndex = nearestGeometryIndex(geometry, current);
  const points = [current, ...geometry.slice(nearestIndex, nearestIndex + 30)];
  const preview: RoutePreviewPoint[] = [];
  let traveledMeters = 0;

  for (let index = 0; index < points.length; index += 1) {
    if (index > 0) {
      traveledMeters += distanceMeters(points[index - 1], points[index]);
    }

    if (traveledMeters > lookaheadMeters * 1.35) {
      break;
    }

    const local = localMeters(current, points[index]);
    const rotated = rotateForHeading(local.x, local.y, headingDegrees);
    preview.push({
      x: clamp(rotated.x / 320, -1, 1),
      y: clamp(rotated.y / Math.max(lookaheadMeters, 220), -0.15, 1)
    });
  }

  return simplifyPreview(preview);
}

function sideRoadPreview(
  branches: IntersectionBranch[],
  current: Coordinate,
  headingDegrees: number,
  lookaheadMeters: number
): SideRoadPreviewBranch[] {
  return branches
    .map((branch) => {
      const points = branch.points.map((point) => {
        const local = localMeters(current, point);
        const rotated = rotateForHeading(local.x, local.y, headingDegrees);
        return {
          x: clamp(rotated.x / 320, -1.15, 1.15),
          y: clamp(rotated.y / Math.max(lookaheadMeters, 220), -0.2, 1.1)
        };
      });

      return {
        roadClass: branch.roadClass,
        points: simplifyPreview(points)
      };
    })
    .filter((branch) =>
      branch.points.length > 1 &&
      branch.points.some((point) => point.y >= -0.08 && point.y <= 1.04 && Math.abs(point.x) <= 1.02)
    );
}

function nearestGeometryIndex(geometry: Coordinate[], current: Coordinate): number {
  let nearestIndex = 0;
  let nearest = Number.POSITIVE_INFINITY;

  for (let index = 0; index < geometry.length; index += 1) {
    const distance = distanceMeters(current, geometry[index]);
    if (distance < nearest) {
      nearest = distance;
      nearestIndex = index;
    }
  }

  return nearestIndex;
}

function localMeters(origin: Coordinate, point: Coordinate): { x: number; y: number } {
  const metersPerDegreeLat = 111320;
  const metersPerDegreeLon = metersPerDegreeLat * Math.cos(toRadians(origin.lat));
  return {
    x: (point.lon - origin.lon) * metersPerDegreeLon,
    y: (point.lat - origin.lat) * metersPerDegreeLat
  };
}

function rotateForHeading(x: number, y: number, headingDegrees: number): { x: number; y: number } {
  const radians = toRadians(headingDegrees);
  const sin = Math.sin(radians);
  const cos = Math.cos(radians);
  return {
    x: x * cos - y * sin,
    y: x * sin + y * cos
  };
}

function simplifyPreview(points: RoutePreviewPoint[]): RoutePreviewPoint[] {
  if (points.length <= 14) {
    return points;
  }

  const simplified: RoutePreviewPoint[] = [];
  const stride = Math.ceil(points.length / 14);
  for (let index = 0; index < points.length; index += stride) {
    simplified.push(points[index]);
  }
  const last = points[points.length - 1];
  if (simplified[simplified.length - 1] !== last) {
    simplified.push(last);
  }
  return simplified;
}

function signedAngleDegrees(from: number, to: number): number {
  const delta = ((to - from + 540) % 360) - 180;
  return Math.round(delta);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}
