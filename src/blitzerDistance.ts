export type BlitzerDistanceEstimate = {
  distanceMeters: number;
  updatedAt: number;
  lastSpeedMetersPerSecond: number | null;
  lastNotificationDistanceMeters: number;
  lastNotificationAt: number;
  notificationCount: number;
};

const MAX_INTEGRATION_SECONDS = 8;

export function createBlitzerDistanceEstimate(
  distanceMeters: number,
  at: number,
  speedMetersPerSecond: number | null = null
): BlitzerDistanceEstimate {
  const distance = Math.max(0, distanceMeters);
  return {
    distanceMeters: distance,
    updatedAt: at,
    lastSpeedMetersPerSecond: cleanSpeed(speedMetersPerSecond),
    lastNotificationDistanceMeters: distance,
    lastNotificationAt: at,
    notificationCount: 1
  };
}

export function advanceBlitzerDistanceEstimate(
  estimate: BlitzerDistanceEstimate,
  at: number,
  speedMetersPerSecond: number | null
): BlitzerDistanceEstimate {
  const elapsedSeconds = Math.max(0, Math.min(MAX_INTEGRATION_SECONDS, (at - estimate.updatedAt) / 1000));
  const currentSpeed = cleanSpeed(speedMetersPerSecond);
  if (elapsedSeconds <= 0) {
    return currentSpeed == null ? estimate : { ...estimate, lastSpeedMetersPerSecond: currentSpeed };
  }

  if (currentSpeed == null) {
    return {
      ...estimate,
      updatedAt: at,
      lastSpeedMetersPerSecond: null
    };
  }

  const previousSpeed = estimate.lastSpeedMetersPerSecond ?? currentSpeed;
  const averageSpeed = (previousSpeed + currentSpeed) / 2;
  const traveledMeters = averageSpeed * elapsedSeconds;

  return {
    ...estimate,
    distanceMeters: Math.max(0, estimate.distanceMeters - traveledMeters),
    updatedAt: at,
    lastSpeedMetersPerSecond: currentSpeed
  };
}

export function correctBlitzerDistanceEstimate(
  estimate: BlitzerDistanceEstimate,
  notificationDistanceMeters: number,
  at: number,
  speedMetersPerSecond: number | null
): BlitzerDistanceEstimate {
  const advanced = advanceBlitzerDistanceEstimate(estimate, at, speedMetersPerSecond);
  const observedDistance = Math.max(0, notificationDistanceMeters);

  return {
    ...advanced,
    distanceMeters: correctedDistance(advanced.distanceMeters, observedDistance),
    updatedAt: at,
    lastSpeedMetersPerSecond: cleanSpeed(speedMetersPerSecond),
    lastNotificationDistanceMeters: observedDistance,
    lastNotificationAt: at,
    notificationCount: estimate.notificationCount + 1
  };
}

function correctedDistance(predictedMeters: number, observedMeters: number): number {
  const delta = Math.abs(predictedMeters - observedMeters);
  if (delta >= 80 || observedMeters <= 175) {
    return observedMeters;
  }

  return observedMeters * 0.75 + predictedMeters * 0.25;
}

function cleanSpeed(speedMetersPerSecond: number | null | undefined): number | null {
  if (typeof speedMetersPerSecond !== "number" || !Number.isFinite(speedMetersPerSecond) || speedMetersPerSecond < 0) {
    return null;
  }

  return speedMetersPerSecond;
}
