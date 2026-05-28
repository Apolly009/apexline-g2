export type Coordinate = {
  lat: number;
  lon: number;
};

export type TravelMode = "car" | "motorcycle";

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

export async function fetchDrivingRoute(
  origin: Coordinate,
  destination: Coordinate,
  destinationLabel: string,
  fetcher: Fetcher = fetch
): Promise<RouteResult> {
  const coords = `${origin.lon},${origin.lat};${destination.lon},${destination.lat}`;
  const url = new URL(`https://router.project-osrm.org/route/v1/driving/${coords}`);
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
    throw new Error(body.message || "No driving route found");
  }

  const steps = route.legs?.flatMap((leg) => leg.steps ?? []) ?? [];
  return {
    origin,
    destination,
    destinationLabel,
    distanceMeters: route.distance ?? 0,
    durationSeconds: route.duration ?? 0,
    geometry: route.geometry?.coordinates?.map(([lon, lat]) => ({ lat, lon })) ?? [],
    steps: steps.map(toRouteStep)
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

export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters)) {
    return "--";
  }

  if (meters < 1000) {
    return `${Math.max(0, Math.round(meters / 10) * 10)} m`;
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

export function formatSpeed(metersPerSecond: number | null): string {
  if (metersPerSecond == null || !Number.isFinite(metersPerSecond)) {
    return "-- mph";
  }

  return `${Math.max(0, Math.round(metersPerSecond * 2.236936))} mph`;
}

export function modeLookaheadMeters(mode: TravelMode, speedMetersPerSecond: number | null): number {
  const speed = Math.max(0, speedMetersPerSecond ?? 0);
  const base = mode === "motorcycle" ? 170 : 140;
  const timeAhead = mode === "motorcycle" ? 8.5 : 7;
  const max = mode === "motorcycle" ? 950 : 800;
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
    }
  };
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
