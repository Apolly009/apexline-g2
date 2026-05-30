import test from "node:test";
import assert from "node:assert/strict";

import {
  advanceBlitzerDistanceEstimate,
  correctBlitzerDistanceEstimate,
  createBlitzerDistanceEstimate
} from "../.test-dist/blitzerDistance.js";

test("integrates distance using speed changes between samples", () => {
  const initial = createBlitzerDistanceEstimate(500, 0, 20);
  const estimate = advanceBlitzerDistanceEstimate(initial, 1000, 30);

  assert.equal(Math.round(estimate.distanceMeters), 475);
  assert.equal(estimate.lastSpeedMetersPerSecond, 30);
});

test("uses a later close notification as a correction point", () => {
  const initial = createBlitzerDistanceEstimate(500, 0, 25);
  const predicted = advanceBlitzerDistanceEstimate(initial, 10_000, 25);
  const corrected = correctBlitzerDistanceEstimate(predicted, 150, 10_500, 20);

  assert.equal(Math.round(corrected.distanceMeters), 150);
  assert.equal(corrected.lastNotificationDistanceMeters, 150);
  assert.equal(corrected.notificationCount, 2);
});

test("smooths small notification deltas to avoid jitter", () => {
  const initial = createBlitzerDistanceEstimate(500, 0, 10);
  const predicted = advanceBlitzerDistanceEstimate(initial, 1000, 10);
  const corrected = correctBlitzerDistanceEstimate(predicted, 500, 1000, 10);

  assert.equal(Math.round(corrected.distanceMeters), 498);
});
