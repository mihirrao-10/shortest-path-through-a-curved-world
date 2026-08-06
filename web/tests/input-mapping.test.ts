import { describe, expect, it } from "vitest";
import {
  keyboardOrbitDelta,
  pinchZoomScale,
  pointerOrbitDelta,
  trackpadOrbitDelta,
  wheelPinchZoomScale,
} from "../src/input-mapping";

describe("direct-manipulation camera mapping", () => {
  it("maps horizontal pointer movement so visible content follows the pointer", () => {
    expect(pointerOrbitDelta(40, 0).azimuth).toBeLessThan(0);
    expect(pointerOrbitDelta(-40, 0).azimuth).toBeGreaterThan(0);
  });

  it("maps vertical pointer movement in the companion-site direction", () => {
    expect(pointerOrbitDelta(0, -40).elevation).toBeLessThan(0);
    expect(pointerOrbitDelta(0, 40).elevation).toBeGreaterThan(0);
  });

  it("uses the same horizontal and vertical signs for trackpad orbit", () => {
    expect(trackpadOrbitDelta(40, -40)).toMatchObject({
      azimuth: expect.any(Number),
      elevation: expect.any(Number),
    });
    expect(trackpadOrbitDelta(40, -40).azimuth).toBeLessThan(0);
    expect(trackpadOrbitDelta(40, -40).elevation).toBeLessThan(0);
  });

  it("zooms in when fingers spread and out when they close", () => {
    expect(pinchZoomScale(100, 140)).toBeLessThan(1);
    expect(pinchZoomScale(140, 100)).toBeGreaterThan(1);
    expect(wheelPinchZoomScale(-30)).toBeLessThan(1);
    expect(wheelPinchZoomScale(30)).toBeGreaterThan(1);
  });

  it("keeps keyboard arrows consistent with pointer movement", () => {
    expect(keyboardOrbitDelta("ArrowLeft")?.azimuth).toBeGreaterThan(0);
    expect(keyboardOrbitDelta("ArrowRight")?.azimuth).toBeLessThan(0);
    expect(keyboardOrbitDelta("ArrowUp")?.elevation).toBeLessThan(0);
    expect(keyboardOrbitDelta("ArrowDown")?.elevation).toBeGreaterThan(0);
  });
});
