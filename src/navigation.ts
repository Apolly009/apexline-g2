export type Coordinate = {
  lat: number;
  lon: number;
};

export type TravelMode = "city" | "sport";
export type UnitSystem = "imperial" | "metric";

export type PlaceResult = {
  id: string;
  label: string;
  coordinate: Coordinate;
};

export type RouteStep = {
  id: string;
  instruction: string;
  shortInstruction: string;
  roadName: string;
  distanceMeters: number;
  durationSeconds: number;
  maneuverType: string;
  modifier: string;
  bearingAfter: number;
  exitNumber: number | null;
  maneuverLocation: Coordinate;
  intersectionBranches: IntersectionBranch[];
};

export type IntersectionBranch = {
  points: Coordinate[];
  roadClass: "major" | "medium" | "minor";
};

export type RouteResult = {
  origin: Coordinate;
  destination: Coordinate;
  destinationLabel: string;
  distanceMeters: number;
  durationSeconds: number;
  steps: RouteStep[];
  geometry: Coordinate[];
};

type Fetcher = typeof fetch;

type NominatimResult = {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
};

type OsrmManeuver = {
  type?: string;
  modifier?: string;
  bearing_after?: number;
  exit?: number;
  location?: [number, number];
};

type OsrmStep = {
  distance?: number;
  duration?: number;
  name?: string;
  maneuver?: OsrmManeuver;
};

type OverpassNode = {
  type: "node";
  id: number;
  lat: number;
  lon: number;
};

type OverpassWay = {
  type: "way";
  id: number;
  nodes?: number[];
  tags?: {
    highway?: string;
    [key: string]: string | undefined;
  };
};

type OverpassElement = OverpassNode | OverpassWay;

type OverpassResponse = {
  elements?: OverpassElement[];
};

type RouteBearings = {
  incoming?: number;
  outgoing?: number;
};

type CandidateIntersectionBranch = IntersectionBranch & {
  bearingDegrees: number;
  lengthMeters: number;
  wayId: number;
};

type RoadWayGeometry = {
  id: number;
  points: Coordinate[];
  roadClass: IntersectionBranch["roadClass"];
};

const SIDE_ROAD_RADIUS_METERS = 100;
const SIDE_ROAD_MAX_LENGTH_METERS = 130;
const SIDE_ROAD_ROUTE_MATCH_DEGREES = 28;
const SIDE_ROAD_JUNCTION_TOLERANCE_METERS = 58;
const SIDE_ROAD_DUPLICATE_DEGREES = 10;
const MAX_SIDE_ROAD_BRANCHES = 6;

type OsrmResponse = {
  code?: string;
  message?: string;
  routes?: Array<{
    distance?: number;
    duration?: number;
    geometry?: {
      coordinates?: Array<[number, number]>;
    };
    legs?: Array<{
      steps?: OsrmStep[];
    }>;
  }>;
};

export async function searchPlaces(query: string, fetcher: Fetcher = fetch): Promise<PlaceResult[]> {
  const normalized = query.trim();
  if (normalized.length < 3) {
    return [];
  }

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "6");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("q", normalized);

  const response = await fetcher(url.toString(), {
    headers: {
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`Place search failed (${response.status})`);
  }

  const results = (await response.json()) as NominatimResult[];
  return results.map((result) => ({
    id: String(result.place_id),
    label: compactPlaceLabel(result.display_name),
    coordinate: {
      lat: Number(result.lat),
      lon: Number(result.lon)
    }
  }));
}

export async function reverseGeocodePlace(
  coordinate: Coordinate,
  fetcher: Fetcher = fetch
): Promise<PlaceResult> {
  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("lat", String(coordinate.lat));
  url.searchParams.set("lon", String(coordinate.lon));
  url.searchParams.set("zoom", "18");

  const response = await fetcher(url.toString(), {
    headers: {
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`Map pin lookup failed (${response.status})`);
  }

  const result = (await response.json()) as Partial<NominatimResult>;
  return {
    id: `pin-${coordinate.lat.toFixed(6)}-${coordinate.lon.toFixed(6)}`,
    label: result.display_name ? compactPlaceLabel(result.display_name) : "Pinned destination",
    coordinate
  };
}

export async function fetchBicycleRoute(
  origin: Coordinate,
  destination: Coordinate,
  destinationLabel: string,
  fetcher: Fetcher = fetch
): Promise<RouteResult> {
  const coords = `${origin.lon},${origin.lat};${destination.lon},${destination.lat}`;
  const url = new URL(`https://router.project-osrm.org/route/v1/bike/${coords}`);
  url.searchParams.set("overview", "full");
  url.searchParams.set("steps", "true");
  url.searchParams.set("geometries", "geojson");
  url.searchParams.set("alternatives", "false");

  const response = await fetcher(url.toString(), {
    headers: {
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`Route request failed (${response.status})`);
  }

  const body = (await response.json()) as OsrmResponse;
  const route = body.routes?.[0];
  if (body.code !== "Ok" || !route) {
    throw new Error(body.message || "No bicycle route found");
  }

  const geometry = route.geometry?.coordinates?.map(([lon, lat]) => ({ lat, lon })) ?? [];
  const steps = route.legs?.flatMap((leg) => leg.steps ?? []) ?? [];
  const routeSteps = steps.map(toRouteStep);
  await attachIntersectionBranches(routeSteps, geometry, fetcher);

  return {
    origin,
    destination,
    destinationLabel,
    distanceMeters: route.distance ?? 0,
    durationSeconds: route.duration ?? 0,
    geometry,
    steps: routeSteps
  };
}

export function distanceMeters(a: Coordinate, b: Coordinate): number {
  const radiusMeters = 6371000;
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * radiusMeters * Math.asin(Math.sqrt(h));
}

export function bearingDegrees(a: Coordinate, b: Coordinate): number {
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const lonDelta = toRadians(b.lon - a.lon);
  const y = Math.sin(lonDelta) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(lonDelta);
  return normalizeDegrees((Math.atan2(y, x) * 180) / Math.PI);
}

export function formatDistance(meters: number, unitSystem: UnitSystem = "imperial"): string {
  if (!Number.isFinite(meters)) {
    return "--";
  }

  if (unitSystem === "metric") {
    if (meters < 1000) {
      return `${Math.max(0, Math.round(meters / 10) * 10)} m`;
    }

    const kilometers = meters / 1000;
    if (kilometers < 10) {
      return `${kilometers.toFixed(1)} km`;
    }

    return `${Math.round(kilometers)} km`;
  }

  if (meters < 1000) {
    const feet = meters * 3.28084;
    if (feet < 1000) {
      return `${Math.max(0, Math.round(feet / 10) * 10)} ft`;
    }
  }

  const miles = meters / 1609.344;
  if (miles < 10) {
    return `${miles.toFixed(1)} mi`;
  }

  return `${Math.round(miles)} mi`;
}

export function formatEta(seconds: number): string {
  if (!Number.isFinite(seconds)) {
    return "--";
  }

  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) {
    return `${minutes} min`;
  }

  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return remaining === 0 ? `${hours} hr` : `${hours}h ${remaining}m`;
}

export function formatSpeed(metersPerSecond: number | null, unitSystem: UnitSystem = "imperial"): string {
  if (metersPerSecond == null || !Number.isFinite(metersPerSecond)) {
    return unitSystem === "metric" ? "-- km/h" : "-- mph";
  }

  if (unitSystem === "metric") {
    return `${Math.max(0, Math.round(metersPerSecond * 3.6))} km/h`;
  }

  return `${Math.max(0, Math.round(metersPerSecond * 2.236936))} mph`;
}

export function modeLookaheadMeters(mode: TravelMode, speedMetersPerSecond: number | null): number {
  const speed = Math.max(0, speedMetersPerSecond ?? 0);
  const base = mode === "sport" ? 75 : 55;
  const timeAhead = mode === "sport" ? 8 : 7;
  const max = mode === "sport" ? 330 : 260;
  return Math.min(max, Math.max(base, speed * timeAhead));
}

function toRouteStep(step: OsrmStep, index: number): RouteStep {
  const maneuver = step.maneuver ?? {};
  const type = maneuver.type ?? "continue";
  const modifier = maneuver.modifier ?? "";
  const roadName = step.name?.trim() || "road";
  const location = maneuver.location ?? [0, 0];
  const exitNumber = maneuver.exit ?? null;
  const instruction = buildInstruction(type, modifier, roadName, exitNumber);

  return {
    id: `${index}-${type}-${modifier}-${roadName}`,
    instruction,
    shortInstruction: shortInstruction(type, modifier, exitNumber),
    roadName,
    distanceMeters: step.distance ?? 0,
    durationSeconds: step.duration ?? 0,
    maneuverType: type,
    modifier,
    bearingAfter: maneuver.bearing_after ?? 0,
    exitNumber,
    maneuverLocation: {
      lat: location[1],
      lon: location[0]
    },
    intersectionBranches: []
  };
}

async function attachIntersectionBranches(
  steps: RouteStep[],
  geometry: Coordinate[],
  fetcher: Fetcher
): Promise<void> {
  const candidates = steps
    .filter((step) => shouldFetchIntersectionBranches(step, geometry))
    .slice(0, 36);

  if (candidates.length === 0) {
    return;
  }

  try {
    const roadWays = await fetchIntersectionRoadWays(candidates, fetcher);
    for (const step of candidates) {
      step.intersectionBranches = intersectionBranchesForStep(step, geometry, roadWays);
    }
  } catch {
    for (const step of candidates) {
      step.intersectionBranches = [];
    }
  }
}

function shouldFetchIntersectionBranches(step: RouteStep, geometry: Coordinate[]): boolean {
  const type = step.maneuverType;
  if (type === "depart" || type === "arrive") {
    return false;
  }

  if (type === "continue") {
    return true;
  }

  if (["turn", "end of road", "fork", "off ramp", "on ramp", "merge", "roundabout", "rotary"].includes(type)) {
    return true;
  }

  if (type === "new name") {
    return Math.abs(routeTurnAngleDegrees(geometry, step.maneuverLocation)) > 30;
  }

  return false;
}

async function fetchIntersectionRoadWays(
  steps: RouteStep[],
  fetcher: Fetcher
): Promise<RoadWayGeometry[]> {
  const wayQueries = steps.map((step) =>
    `way(around:${SIDE_ROAD_RADIUS_METERS},${step.maneuverLocation.lat},${step.maneuverLocation.lon})` +
    '["highway"]["highway"!~"^(footway|steps|bridleway|pedestrian|corridor|elevator|platform|construction)$"];'
  );
  const query = [
    "[out:json][timeout:6];",
    "(",
    ...wayQueries,
    ");",
    "(._;>;);",
    "out body;"
  ].join("");

  const body = await fetchOverpass(query, fetcher);
  const elements = body.elements ?? [];
  const nodes = new Map<number, Coordinate>();
  const ways: OverpassWay[] = [];

  for (const element of elements) {
    if (element.type === "node") {
      nodes.set(element.id, { lat: element.lat, lon: element.lon });
    } else if (element.type === "way" && shouldUseRoadWay(element)) {
      ways.push(element);
    }
  }

  const roadWays: RoadWayGeometry[] = [];

  for (const way of ways) {
    const roadClass = roadClassForHighway(way.tags?.highway);
    const wayPoints = (way.nodes ?? [])
      .map((nodeId) => nodes.get(nodeId))
      .filter((point): point is Coordinate => Boolean(point));
    if (wayPoints.length < 2) {
      continue;
    }

    if (roadClass) {
      roadWays.push({
        id: way.id,
        points: wayPoints,
        roadClass
      });
    }
  }

  return roadWays;
}

function intersectionBranchesForStep(
  step: RouteStep,
  geometry: Coordinate[],
  roadWays: RoadWayGeometry[]
): IntersectionBranch[] {
  const routeBearings = routeBearingsAtManeuver(geometry, step.maneuverLocation);
  const branches: CandidateIntersectionBranch[] = [];

  for (const roadWay of roadWays) {
    branches.push(...branchesForWay(roadWay.id, roadWay.points, step.maneuverLocation, routeBearings, roadWay.roadClass));
  }

  return selectIntersectionBranches(branches).map(({ points, roadClass }) => ({ points, roadClass }));
}

async function fetchOverpass(query: string, fetcher: Fetcher): Promise<OverpassResponse> {
  const endpoints = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter"
  ];

  for (const endpoint of endpoints) {
    const response = await tryFetchOverpassEndpoint(endpoint, query, fetcher);
    if (response.elements) {
      return response;
    }
  }

  return {};
}

async function tryFetchOverpassEndpoint(
  endpoint: string,
  query: string,
  fetcher: Fetcher
): Promise<OverpassResponse> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => {
    controller.abort();
  }, 6500);

  try {
    const response = await fetcher(endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({ data: query }),
      signal: controller.signal
    });
    if (!response.ok) {
      return {};
    }
    return (await response.json()) as OverpassResponse;
  } catch {
    return {};
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

function shouldUseRoadWay(way: OverpassWay): boolean {
  const highway = way.tags?.highway;
  return Boolean(highway && roadClassForHighway(highway));
}

function roadClassForHighway(highway: string | undefined): IntersectionBranch["roadClass"] | null {
  if (!highway) {
    return null;
  }

  if (["motorway", "trunk", "primary", "secondary"].includes(highway)) {
    return "major";
  }

  if (["tertiary", "unclassified", "cycleway"].includes(highway)) {
    return "medium";
  }

  if ([
    "residential",
    "living_street",
    "motorway_link",
    "trunk_link",
    "primary_link",
    "secondary_link",
    "tertiary_link",
    "service",
    "track",
    "path"
  ].includes(highway)) {
    return "minor";
  }

  return null;
}

function branchesForWay(
  wayId: number,
  wayPoints: Coordinate[],
  maneuver: Coordinate,
  routeBearings: RouteBearings,
  roadClass: IntersectionBranch["roadClass"] | null
): CandidateIntersectionBranch[] {
  if (!roadClass) {
    return [];
  }

  let junctionIndex = -1;
  let nearestMeters = Number.POSITIVE_INFINITY;
  for (let index = 0; index < wayPoints.length; index += 1) {
    const distance = distanceMeters(maneuver, wayPoints[index]);
    if (distance < nearestMeters) {
      nearestMeters = distance;
      junctionIndex = index;
    }
  }

  if (junctionIndex < 0 || nearestMeters > SIDE_ROAD_JUNCTION_TOLERANCE_METERS) {
    return [];
  }

  const branches: CandidateIntersectionBranch[] = [];
  for (const direction of [-1, 1] as const) {
    const points = collectBranchPoints(wayPoints, junctionIndex, direction, maneuver);
    const lengthMeters = branchLengthMeters(points);
    if (points.length < 2 || lengthMeters < 22) {
      continue;
    }

    const bearing = bearingAlongBranch(points);
    if (bearing == null || matchesRouteBearing(bearing, routeBearings)) {
      continue;
    }

    branches.push({
      wayId,
      points,
      roadClass,
      bearingDegrees: bearing,
      lengthMeters
    });
  }

  return branches;
}

function collectBranchPoints(
  wayPoints: Coordinate[],
  junctionIndex: number,
  direction: -1 | 1,
  maneuver: Coordinate
): Coordinate[] {
  const points = [maneuver];
  let previous = maneuver;
  let traveledMeters = 0;

  for (
    let index = junctionIndex;
    index >= 0 && index < wayPoints.length;
    index += direction
  ) {
    const point = wayPoints[index];
    const segmentMeters = distanceMeters(previous, point);
    if (segmentMeters < 2) {
      continue;
    }

    points.push(point);
    traveledMeters += segmentMeters;
    previous = point;
    if (traveledMeters >= SIDE_ROAD_MAX_LENGTH_METERS) {
      break;
    }
  }

  return points;
}

function branchLengthMeters(points: Coordinate[]): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    length += distanceMeters(points[index - 1], points[index]);
  }
  return length;
}

function bearingAlongBranch(points: Coordinate[]): number | null {
  const start = points[0];
  for (let index = 1; index < points.length; index += 1) {
    if (distanceMeters(start, points[index]) >= 14) {
      return bearingDegrees(start, points[index]);
    }
  }
  return points[1] ? bearingDegrees(start, points[1]) : null;
}

function matchesRouteBearing(bearing: number, routeBearings: RouteBearings): boolean {
  return [routeBearings.incoming, routeBearings.outgoing].some((routeBearing) =>
    routeBearing != null && angularDistanceDegrees(bearing, routeBearing) <= SIDE_ROAD_ROUTE_MATCH_DEGREES
  );
}

function selectIntersectionBranches(branches: CandidateIntersectionBranch[]): CandidateIntersectionBranch[] {
  const selected: CandidateIntersectionBranch[] = [];
  const sorted = [...branches].sort((a, b) =>
    roadClassScore(b.roadClass) - roadClassScore(a.roadClass) ||
    b.lengthMeters - a.lengthMeters
  );

  for (const branch of sorted) {
    const duplicate = selected.some((selectedBranch) =>
      branch.wayId === selectedBranch.wayId &&
      angularDistanceDegrees(branch.bearingDegrees, selectedBranch.bearingDegrees) <= SIDE_ROAD_DUPLICATE_DEGREES
    );
    if (!duplicate) {
      selected.push(branch);
    }
    if (selected.length >= MAX_SIDE_ROAD_BRANCHES) {
      break;
    }
  }

  return selected.sort((a, b) => a.bearingDegrees - b.bearingDegrees);
}

function roadClassScore(roadClass: IntersectionBranch["roadClass"]): number {
  if (roadClass === "major") {
    return 3;
  }
  if (roadClass === "medium") {
    return 2;
  }
  return 1;
}

function routeBearingsAtManeuver(geometry: Coordinate[], maneuver: Coordinate): RouteBearings {
  if (geometry.length < 2) {
    return {};
  }

  const nearestIndex = nearestCoordinateIndex(geometry, maneuver);
  const incomingPoint = routePointAwayFromManeuver(geometry, nearestIndex, -1, maneuver);
  const outgoingPoint = routePointAwayFromManeuver(geometry, nearestIndex, 1, maneuver);

  return {
    incoming: incomingPoint ? bearingDegrees(maneuver, incomingPoint) : undefined,
    outgoing: outgoingPoint ? bearingDegrees(maneuver, outgoingPoint) : undefined
  };
}

function routeTurnAngleDegrees(geometry: Coordinate[], maneuver: Coordinate): number {
  const bearings = routeBearingsAtManeuver(geometry, maneuver);
  if (bearings.incoming == null || bearings.outgoing == null) {
    return 0;
  }

  return angularDistanceDegrees((bearings.incoming + 180) % 360, bearings.outgoing);
}

function routePointAwayFromManeuver(
  geometry: Coordinate[],
  nearestIndex: number,
  direction: -1 | 1,
  maneuver: Coordinate
): Coordinate | null {
  for (
    let index = nearestIndex;
    index >= 0 && index < geometry.length;
    index += direction
  ) {
    if (distanceMeters(maneuver, geometry[index]) >= 18) {
      return geometry[index];
    }
  }

  return null;
}

function nearestCoordinateIndex(points: Coordinate[], target: Coordinate): number {
  let nearestIndex = 0;
  let nearestMeters = Number.POSITIVE_INFINITY;
  for (let index = 0; index < points.length; index += 1) {
    const distance = distanceMeters(target, points[index]);
    if (distance < nearestMeters) {
      nearestMeters = distance;
      nearestIndex = index;
    }
  }
  return nearestIndex;
}

function angularDistanceDegrees(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180);
}

function buildInstruction(type: string, modifier: string, roadName: string, exitNumber: number | null): string {
  if (type === "depart") {
    return `Start on ${roadName}`;
  }

  if (type === "arrive") {
    return "Arrive at destination";
  }

  if (type === "roundabout" || type === "rotary") {
    return exitNumber ? `Take exit ${exitNumber} at roundabout` : `Roundabout ${roadName}`;
  }

  if (type === "merge") {
    return `Merge ${modifier || "ahead"} onto ${roadName}`;
  }

  if (type === "on ramp") {
    return `Take ramp ${modifier || "ahead"}`;
  }

  if (type === "off ramp") {
    return `Exit ${modifier || "ahead"}`;
  }

  if (type === "fork") {
    return `Keep ${modifier || "ahead"} on ${roadName}`;
  }

  if (type === "turn" || type === "new name" || type === "end of road") {
    return `${capitalize(modifier || "continue")} on ${roadName}`;
  }

  return roadName === "road" ? "Continue" : `Continue on ${roadName}`;
}

function shortInstruction(type: string, modifier: string, exitNumber: number | null): string {
  if (type === "arrive") {
    return "ARRIVE";
  }

  if (type === "depart") {
    return "START";
  }

  if (type === "roundabout" || type === "rotary") {
    return exitNumber ? `EXIT ${exitNumber}` : "ROUNDABOUT";
  }

  if (type === "off ramp") {
    return "EXIT";
  }

  if (type === "on ramp") {
    return "RAMP";
  }

  if (type === "merge") {
    return "MERGE";
  }

  if (type === "fork") {
    return modifier.includes("left") ? "KEEP LEFT" : "KEEP RIGHT";
  }

  if (modifier.includes("left")) {
    return modifier.includes("sharp") ? "SHARP LEFT" : modifier.includes("slight") ? "SLIGHT LEFT" : "LEFT";
  }

  if (modifier.includes("right")) {
    return modifier.includes("sharp") ? "SHARP RIGHT" : modifier.includes("slight") ? "SLIGHT RIGHT" : "RIGHT";
  }

  if (modifier.includes("uturn")) {
    return "U-TURN";
  }

  return "STRAIGHT";
}

function compactPlaceLabel(label: string): string {
  const parts = label.split(",").map((part) => part.trim()).filter(Boolean);
  return parts.slice(0, 4).join(", ");
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function normalizeDegrees(degrees: number): number {
  return (degrees + 360) % 360;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
