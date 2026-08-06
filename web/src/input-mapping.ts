export interface OrbitDelta {
  azimuth: number;
  elevation: number;
}

export function pointerOrbitDelta(deltaX: number, deltaY: number): OrbitDelta {
  return {
    azimuth: -deltaX * 0.006,
    elevation: deltaY * 0.0052,
  };
}

export function trackpadOrbitDelta(deltaX: number, deltaY: number): OrbitDelta {
  return {
    azimuth: -deltaX * 0.0034,
    elevation: deltaY * 0.0031,
  };
}

export function horizontalTrackpadOrbitDelta(deltaX: number): OrbitDelta {
  return { azimuth: -deltaX * 0.0024, elevation: 0 };
}

export function pinchZoomScale(
  previousDistance: number,
  nextDistance: number,
): number {
  if (previousDistance <= 0 || nextDistance <= 0) return 1;
  return previousDistance / nextDistance;
}

export function wheelPinchZoomScale(deltaY: number): number {
  return Math.exp(deltaY * 0.004);
}

export function keyboardOrbitDelta(
  key: string,
  accelerated = false,
): OrbitDelta | null {
  const step = accelerated ? 0.18 : 0.1;
  if (key === "ArrowLeft") return { azimuth: step, elevation: 0 };
  if (key === "ArrowRight") return { azimuth: -step, elevation: 0 };
  if (key === "ArrowUp") return { azimuth: 0, elevation: -step };
  if (key === "ArrowDown") return { azimuth: 0, elevation: step };
  return null;
}
