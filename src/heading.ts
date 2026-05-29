export type HeadingSample = {
  heading: number;
  accuracy: number | null;
  source: "webkit" | "absolute";
};

export type OrientationHeadingEvent = {
  alpha?: number | null;
  absolute?: boolean;
  webkitCompassHeading?: number | null;
  webkitCompassAccuracy?: number | null;
};

export function headingFromOrientationEvent(event: OrientationHeadingEvent): HeadingSample | null {
  if (typeof event.webkitCompassHeading === "number" && Number.isFinite(event.webkitCompassHeading)) {
    const accuracy = typeof event.webkitCompassAccuracy === "number" && Number.isFinite(event.webkitCompassAccuracy)
      ? event.webkitCompassAccuracy
      : null;
    if (accuracy != null && accuracy > 45) {
      return null;
    }

    return {
      heading: normalizeDegrees(event.webkitCompassHeading),
      accuracy,
      source: "webkit"
    };
  }

  if (event.absolute === true && typeof event.alpha === "number" && Number.isFinite(event.alpha)) {
    return {
      heading: normalizeDegrees(360 - event.alpha),
      accuracy: null,
      source: "absolute"
    };
  }

  return null;
}

export function imuYawDeltaDegrees(currentZ: number, baseZ: number): number {
  const rawDelta = currentZ - baseZ;
  const deltaDegrees = Math.abs(rawDelta) <= Math.PI * 2 ? rawDelta * 180 / Math.PI : rawDelta;
  return normalizeSignedDegrees(deltaDegrees);
}

export function smoothHeadingDegrees(previous: number | null, next: number, ratio: number): number {
  if (previous == null) {
    return next;
  }

  const delta = normalizeSignedDegrees(next - previous);
  return normalizeDegrees(previous + delta * ratio);
}

export function normalizeDegrees(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

export function normalizeSignedDegrees(degrees: number): number {
  return ((((degrees % 360) + 540) % 360) - 180);
}
