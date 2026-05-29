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

export type PlanarVector = {
  x: number;
  y: number;
};

export type AccelerationLockEstimate = {
  offsetDegrees: number;
  confidence: number;
  phoneMagnitude: number;
  glassesMagnitude: number;
};

const MIN_ACCEL_LOCK_MAGNITUDE = 0.85;
const MAX_ACCEL_LOCK_MAGNITUDE_RATIO = 3.5;

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

export function estimateAccelerationLockOffset(
  phoneVector: PlanarVector,
  glassesVector: PlanarVector
): AccelerationLockEstimate | null {
  const phoneMagnitude = vectorMagnitude(phoneVector);
  const glassesMagnitude = vectorMagnitude(glassesVector);
  if (phoneMagnitude < MIN_ACCEL_LOCK_MAGNITUDE || glassesMagnitude < MIN_ACCEL_LOCK_MAGNITUDE) {
    return null;
  }

  const magnitudeRatio = Math.max(phoneMagnitude, glassesMagnitude) / Math.min(phoneMagnitude, glassesMagnitude);
  if (magnitudeRatio > MAX_ACCEL_LOCK_MAGNITUDE_RATIO) {
    return null;
  }

  const offsetDegrees = normalizeSignedDegrees(vectorAngleDegrees(phoneVector) - vectorAngleDegrees(glassesVector));
  const confidence = Math.min(1, Math.min(phoneMagnitude, glassesMagnitude) / 4) *
    Math.max(0, 1 - (magnitudeRatio - 1) / (MAX_ACCEL_LOCK_MAGNITUDE_RATIO - 1));

  return {
    offsetDegrees,
    confidence,
    phoneMagnitude,
    glassesMagnitude
  };
}

export function imuYawDeltaDegrees(currentZ: number, baseZ: number): number {
  const rawDelta = currentZ - baseZ;
  const deltaDegrees = Math.abs(rawDelta) <= Math.PI * 2 ? rawDelta * 180 / Math.PI : rawDelta;
  return normalizeSignedDegrees(deltaDegrees);
}

export function vectorMagnitude(vector: PlanarVector): number {
  return Math.hypot(vector.x, vector.y);
}

export function vectorAngleDegrees(vector: PlanarVector): number {
  return normalizeDegrees(Math.atan2(vector.y, vector.x) * 180 / Math.PI);
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
