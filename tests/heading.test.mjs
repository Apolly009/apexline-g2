import test from "node:test";
import assert from "node:assert/strict";

import {
  estimateAccelerationLockOffset,
  headingFromOrientationEvent,
  imuYawDeltaDegrees,
  normalizeDegrees,
  normalizeSignedDegrees,
  smoothHeadingDegrees
} from "../.test-dist/heading.js";

test("normalizes compass headings", () => {
  assert.equal(normalizeDegrees(370), 10);
  assert.equal(normalizeDegrees(-5), 355);
  assert.equal(normalizeSignedDegrees(270), -90);
  assert.equal(normalizeSignedDegrees(-270), 90);
});

test("smooths through north without taking the long way around", () => {
  assert.equal(smoothHeadingDegrees(350, 10, 0.5), 0);
  assert.equal(smoothHeadingDegrees(10, 350, 0.5), 0);
});

test("converts IMU yaw deltas from degrees and radians", () => {
  assert.equal(imuYawDeltaDegrees(45, 0), 45);
  assert.equal(Math.round(imuYawDeltaDegrees(Math.PI / 2, 0)), 90);
  assert.equal(imuYawDeltaDegrees(0, 270), 90);
});

test("accepts Safari north-referenced compass heading when accuracy is usable", () => {
  assert.deepEqual(
    headingFromOrientationEvent({ webkitCompassHeading: 725, webkitCompassAccuracy: 12 }),
    { heading: 5, accuracy: 12, source: "webkit" }
  );
});

test("rejects low-accuracy or relative-only orientation as a compass anchor", () => {
  assert.equal(headingFromOrientationEvent({ webkitCompassHeading: 90, webkitCompassAccuracy: 60 }), null);
  assert.equal(headingFromOrientationEvent({ alpha: 90, absolute: false }), null);
});

test("accepts standards absolute orientation alpha", () => {
  assert.deepEqual(
    headingFromOrientationEvent({ alpha: 90, absolute: true }),
    { heading: 270, accuracy: null, source: "absolute" }
  );
});

test("estimates phone-to-glasses offset from matching acceleration vectors", () => {
  const estimate = estimateAccelerationLockOffset({ x: 0, y: 3 }, { x: 3, y: 0 });
  assert.ok(estimate);
  assert.equal(Math.round(estimate.offsetDegrees), 90);
  assert.ok(estimate.confidence > 0.5);
});

test("rejects weak or mismatched acceleration vectors", () => {
  assert.equal(estimateAccelerationLockOffset({ x: 0.1, y: 0.1 }, { x: 3, y: 0 }), null);
  assert.equal(estimateAccelerationLockOffset({ x: 10, y: 0 }, { x: 1, y: 0 }), null);
});
