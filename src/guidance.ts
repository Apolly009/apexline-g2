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
  const preview = routePreview(route.geometry, position.coordinate, heading, lookaheadMeters);

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
    routePreview: preview,
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

  const scale = previewScaleMeters(lookaheadMeters);
  const startMeters = distanceAlongGeometry(geometry, current);
  const routeLength = geometryLengthMeters(geometry);
  const sampleMeters = clamp(scale.forward / 34, 7, 18);
  const endMeters = Math.min(routeLength, startMeters + scale.forward * 0.98);
  const points = [current];
  let nextMeters = Math.min(routeLength, startMeters + sampleMeters);

  while (nextMeters < endMeters) {
    points.push(sampleGeometryAtDistance(geometry, nextMeters));
    nextMeters += sampleMeters;
  }

  if (endMeters > startMeters) {
    points.push(sampleGeometryAtDistance(geometry, endMeters));
  }

  const preview: RoutePreviewPoint[] = [];

  for (const point of points) {
    const local = localMeters(current, point);
    const rotated = rotateForHeading(local.x, local.y, headingDegrees);
    preview.push({
      x: rotated.x / scale.lateral,
      y: rotated.y / scale.forward
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
  const scale = previewScaleMeters(lookaheadMeters);
  return branches
    .map((branch) => {
      const rawPoints = branch.points.map((point) => {
        const local = localMeters(current, point);
        const rotated = rotateForHeading(local.x, local.y, headingDegrees);
        return {
          x: rotated.x / scale.lateral,
          y: rotated.y / scale.forward
        };
      });
      const junction = rawPoints[0];
      if (!junction || junction.y < -0.08 || junction.y > 0.98 || Math.abs(junction.x) > 1.04) {
        return null;
      }

      const points = rawPoints.map((point) => ({
        x: clamp(point.x, -1.15, 1.15),
        y: clamp(point.y, -0.18, 1.04)
      }));

      return {
        roadClass: branch.roadClass,
        points: ensureMinimumBranchLength(simplifyPreview(points), branch.roadClass)
      };
    })
    .filter((branch): branch is SideRoadPreviewBranch => Boolean(branch))
    .filter((branch) =>
      branch.points.length > 1 &&
      branch.points.some((point) => point.y >= -0.08 && point.y <= 1.04 && Math.abs(point.x) <= 1.02)
    );
}

function ensureMinimumBranchLength(
  points: RoutePreviewPoint[],
  roadClass: IntersectionBranch["roadClass"]
): RoutePreviewPoint[] {
  if (points.length < 2) {
    return points;
  }

  const minimumLength = roadClass === "major" ? 0.22 : roadClass === "medium" ? 0.18 : 0.14;
  const currentLength = previewPolylineLength(points);
  if (currentLength >= minimumLength) {
    return points;
  }

  const start = points[0];
  const end = points[points.length - 1];
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length < 0.001) {
    return points;
  }

  return [
    ...points.slice(0, -1),
    {
      x: clamp(start.x + (dx / length) * minimumLength, -1.15, 1.15),
      y: clamp(start.y + (dy / length) * minimumLength, -0.18, 1.04)
    }
  ];
}

function previewPolylineLength(points: RoutePreviewPoint[]): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    length += Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
  }
  return length;
}

function previewScaleMeters(lookaheadMeters: number): { forward: number; lateral: number } {
  const forward = Math.max(180, lookaheadMeters);
  return {
    forward,
    lateral: clamp(forward * 0.56, 135, 390)
  };
}

function geometryLengthMeters(geometry: Coordinate[]): number {
  let total = 0;
  for (let index = 1; index < geometry.length; index += 1) {
    total += distanceMeters(geometry[index - 1], geometry[index]);
  }
  return total;
}

function distanceAlongGeometry(geometry: Coordinate[], current: Coordinate): number {
  if (geometry.length < 2) {
    return 0;
  }

  let nearestSegment = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;
  let nearestT = 0;
  for (let index = 0; index < geometry.length - 1; index += 1) {
    const projection = projectToSegment(current, geometry[index], geometry[index + 1]);
    if (projection.distanceMeters < nearestDistance) {
      nearestDistance = projection.distanceMeters;
      nearestSegment = index;
      nearestT = projection.t;
    }
  }

  let distance = 0;
  for (let index = 1; index <= nearestSegment; index += 1) {
    distance += distanceMeters(geometry[index - 1], geometry[index]);
  }
  return distance + distanceMeters(geometry[nearestSegment], geometry[nearestSegment + 1]) * nearestT;
}

function sampleGeometryAtDistance(geometry: Coordinate[], targetMeters: number): Coordinate {
  if (geometry.length === 0) {
    return { lat: 0, lon: 0 };
  }

  let traveled = 0;
  for (let index = 1; index < geometry.length; index += 1) {
    const start = geometry[index - 1];
    const end = geometry[index];
    const segmentMeters = distanceMeters(start, end);
    if (traveled + segmentMeters >= targetMeters) {
      const t = segmentMeters === 0 ? 0 : (targetMeters - traveled) / segmentMeters;
      return {
        lat: start.lat + (end.lat - start.lat) * t,
        lon: start.lon + (end.lon - start.lon) * t
      };
    }
    traveled += segmentMeters;
  }

  return geometry[geometry.length - 1];
}

function projectToSegment(
  current: Coordinate,
  start: Coordinate,
  end: Coordinate
): { distanceMeters: number; t: number } {
  const metersPerDegreeLat = 111320;
  const metersPerDegreeLon = metersPerDegreeLat * Math.cos(toRadians(current.lat));
  const startX = (start.lon - current.lon) * metersPerDegreeLon;
  const startY = (start.lat - current.lat) * metersPerDegreeLat;
  const endX = (end.lon - current.lon) * metersPerDegreeLon;
  const endY = (end.lat - current.lat) * metersPerDegreeLat;
  const segmentX = endX - startX;
  const segmentY = endY - startY;
  const lengthSquared = segmentX * segmentX + segmentY * segmentY;
  const t = lengthSquared === 0
    ? 0
    : Math.max(0, Math.min(1, -(startX * segmentX + startY * segmentY) / lengthSquared));
  const nearestX = startX + segmentX * t;
  const nearestY = startY + segmentY * t;
  return {
    distanceMeters: Math.hypot(nearestX, nearestY),
    t
  };
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
  if (points.length <= 32) {
    return points;
  }

  const simplified: RoutePreviewPoint[] = [];
  const stride = Math.ceil(points.length / 32);
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
