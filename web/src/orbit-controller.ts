import * as THREE from "three";
import {
  horizontalTrackpadOrbitDelta,
  keyboardOrbitDelta,
  pinchZoomScale,
  pointerOrbitDelta,
  trackpadOrbitDelta,
  wheelPinchZoomScale,
} from "./input-mapping";

export interface OrbitPose {
  target: THREE.Vector3;
  azimuth: number;
  elevation: number;
  distance: number;
}

interface OrbitControllerOptions {
  reducedMotion: boolean;
  onExploreChange?: (engaged: boolean) => void;
  onInteraction?: () => void;
  onTap?: (clientX: number, clientY: number) => void;
  onDoubleTap?: (clientX: number, clientY: number) => void;
  onReset?: () => void;
}

type PointerPosition = { x: number; y: number };

const TWO_PI = Math.PI * 2;
const MIN_ELEVATION = -1.25;
const MAX_ELEVATION = 1.25;
const MIN_DISTANCE = 2.15;
const MAX_DISTANCE = 8.5;
const IDLE_DELAY_MILLISECONDS = 7_500;
const RECENT_INPUT_GUARD_MILLISECONDS = 12_000;

function nearestAngle(reference: number, requested: number): number {
  return requested + Math.round((reference - requested) / TWO_PI) * TWO_PI;
}

function pointerCentroid(
  pointers: ReadonlyMap<number, PointerPosition>,
): PointerPosition {
  let x = 0;
  let y = 0;
  for (const pointer of pointers.values()) {
    x += pointer.x;
    y += pointer.y;
  }
  const count = Math.max(1, pointers.size);
  return { x: x / count, y: y / count };
}

function firstTwoPointerDistance(
  pointers: ReadonlyMap<number, PointerPosition>,
): number {
  const iterator = pointers.values();
  const first = iterator.next().value as PointerPosition | undefined;
  const second = iterator.next().value as PointerPosition | undefined;
  return first && second
    ? Math.hypot(second.x - first.x, second.y - first.y)
    : 0;
}

export class OrbitController {
  private readonly camera: THREE.PerspectiveCamera;
  private readonly canvas: HTMLCanvasElement;
  private readonly reducedMotion: boolean;
  private readonly onExploreChange?: (engaged: boolean) => void;
  private readonly onInteraction?: () => void;
  private readonly onTap?: (clientX: number, clientY: number) => void;
  private readonly onDoubleTap?: (clientX: number, clientY: number) => void;
  private readonly onReset?: () => void;
  private readonly pointers = new Map<number, PointerPosition>();
  private readonly currentTarget = new THREE.Vector3();
  private readonly desiredTarget = new THREE.Vector3();
  private readonly cameraOffset = new THREE.Vector3();
  private currentAzimuth = 0;
  private desiredAzimuth = 0;
  private currentElevation = 0;
  private desiredElevation = 0;
  private currentDistance = 5;
  private desiredDistance = 5;
  private lastInteractionTime = -IDLE_DELAY_MILLISECONDS;
  private transitionUntil = 0;
  private pointerDownTime = 0;
  private pointerTravel = 0;
  private exploreEngaged = false;
  private disposed = false;
  private safariGestureScale = 1;

  constructor(
    camera: THREE.PerspectiveCamera,
    canvas: HTMLCanvasElement,
    initialPose: OrbitPose,
    options: OrbitControllerOptions,
  ) {
    this.camera = camera;
    this.canvas = canvas;
    this.reducedMotion = options.reducedMotion;
    this.onExploreChange = options.onExploreChange;
    this.onInteraction = options.onInteraction;
    this.onTap = options.onTap;
    this.onDoubleTap = options.onDoubleTap;
    this.onReset = options.onReset;
    this.currentTarget.copy(initialPose.target);
    this.desiredTarget.copy(initialPose.target);
    this.currentAzimuth = initialPose.azimuth;
    this.desiredAzimuth = initialPose.azimuth;
    this.currentElevation = initialPose.elevation;
    this.desiredElevation = initialPose.elevation;
    this.currentDistance = initialPose.distance;
    this.desiredDistance = initialPose.distance;

    this.canvas.dataset.exploreView = "false";
    this.canvas.dataset.autoOrbit = String(!this.reducedMotion);
    this.canvas.dataset.userInteracting = "false";
    this.canvas.addEventListener("pointerdown", this.handlePointerDown);
    this.canvas.addEventListener("pointermove", this.handlePointerMove);
    this.canvas.addEventListener("pointerup", this.handlePointerUp);
    this.canvas.addEventListener("pointercancel", this.handlePointerCancel);
    this.canvas.addEventListener("wheel", this.handleWheel, { passive: false });
    this.canvas.addEventListener("dblclick", this.handleDoubleClick);
    this.canvas.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keydown", this.handleGlobalKeyDown);
    window.addEventListener("blur", this.handleWindowBlur);

    this.canvas.addEventListener(
      "gesturestart",
      this.handleGestureStart as EventListener,
      { passive: false },
    );
    this.canvas.addEventListener(
      "gesturechange",
      this.handleGestureChange as EventListener,
      { passive: false },
    );
    this.canvas.addEventListener(
      "gestureend",
      this.handleGestureEnd as EventListener,
      { passive: false },
    );
    this.applyCamera();
  }

  get isExploreEngaged(): boolean {
    return this.exploreEngaged;
  }

  get hasRecentManualInput(): boolean {
    return (
      performance.now() - this.lastInteractionTime <
      RECENT_INPUT_GUARD_MILLISECONDS
    );
  }

  setExplore(engaged: boolean): void {
    if (this.exploreEngaged === engaged) return;
    this.exploreEngaged = engaged;
    this.canvas.dataset.exploreView = String(engaged);
    this.canvas.classList.toggle("is-exploring", engaged);
    this.recordInteraction();
    if (engaged) this.canvas.focus({ preventScroll: true });
    this.onExploreChange?.(engaged);
  }

  toggleExplore(): void {
    this.setExplore(!this.exploreEngaged);
  }

  setPose(
    pose: OrbitPose,
    force = false,
    durationMilliseconds = 1_100,
  ): boolean {
    if (!force && this.hasRecentManualInput) return false;
    this.desiredTarget.copy(pose.target);
    this.desiredAzimuth = nearestAngle(this.currentAzimuth, pose.azimuth);
    this.desiredElevation = THREE.MathUtils.clamp(
      pose.elevation,
      MIN_ELEVATION,
      MAX_ELEVATION,
    );
    this.desiredDistance = THREE.MathUtils.clamp(
      pose.distance,
      MIN_DISTANCE,
      MAX_DISTANCE,
    );
    this.transitionUntil =
      performance.now() + (this.reducedMotion ? 40 : durationMilliseconds);
    if (this.reducedMotion) {
      this.snapToDesired();
      this.applyCamera();
    }
    return true;
  }

  orbit(deltaAzimuth: number, deltaElevation: number): void {
    this.desiredAzimuth += deltaAzimuth;
    this.desiredElevation = THREE.MathUtils.clamp(
      this.desiredElevation + deltaElevation,
      MIN_ELEVATION,
      MAX_ELEVATION,
    );
    this.transitionUntil = 0;
    this.recordInteraction();
  }

  zoom(scale: number): void {
    if (!(scale > 0) || !Number.isFinite(scale)) return;
    this.desiredDistance = THREE.MathUtils.clamp(
      this.desiredDistance * scale,
      MIN_DISTANCE,
      MAX_DISTANCE,
    );
    this.transitionUntil = 0;
    this.recordInteraction();
  }

  update(deltaSeconds: number, time: number): void {
    if (this.disposed) return;
    const pointerActive = this.pointers.size > 0;
    const transitionActive = time < this.transitionUntil;
    const idle =
      !this.reducedMotion &&
      !pointerActive &&
      !this.exploreEngaged &&
      !transitionActive &&
      time - this.lastInteractionTime >= IDLE_DELAY_MILLISECONDS;
    if (idle) {
      this.desiredAzimuth += 0.028 * Math.min(deltaSeconds, 0.1);
    }
    this.canvas.dataset.autoOrbit = String(idle);

    if (this.reducedMotion) {
      this.snapToDesired();
    } else {
      const frameDelta = Math.min(Math.max(deltaSeconds, 0), 0.1);
      const rotationAlpha = 1 - Math.exp(-9.5 * frameDelta);
      const positionAlpha = 1 - Math.exp(-7.5 * frameDelta);
      this.currentAzimuth +=
        (this.desiredAzimuth - this.currentAzimuth) * rotationAlpha;
      this.currentElevation +=
        (this.desiredElevation - this.currentElevation) * rotationAlpha;
      this.currentDistance +=
        (this.desiredDistance - this.currentDistance) * positionAlpha;
      this.currentTarget.lerp(this.desiredTarget, positionAlpha);
    }
    this.applyCamera();
  }

  destroy(): void {
    if (this.disposed) return;
    const wasExploring = this.exploreEngaged;
    this.disposed = true;
    this.canvas.removeEventListener("pointerdown", this.handlePointerDown);
    this.canvas.removeEventListener("pointermove", this.handlePointerMove);
    this.canvas.removeEventListener("pointerup", this.handlePointerUp);
    this.canvas.removeEventListener("pointercancel", this.handlePointerCancel);
    this.canvas.removeEventListener("wheel", this.handleWheel);
    this.canvas.removeEventListener("dblclick", this.handleDoubleClick);
    this.canvas.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keydown", this.handleGlobalKeyDown);
    window.removeEventListener("blur", this.handleWindowBlur);
    this.canvas.removeEventListener(
      "gesturestart",
      this.handleGestureStart as EventListener,
    );
    this.canvas.removeEventListener(
      "gesturechange",
      this.handleGestureChange as EventListener,
    );
    this.canvas.removeEventListener(
      "gestureend",
      this.handleGestureEnd as EventListener,
    );
    this.pointers.clear();
    this.exploreEngaged = false;
    this.canvas.classList.remove("is-exploring", "is-dragging");
    this.canvas.dataset.exploreView = "false";
    this.canvas.dataset.userInteracting = "false";
    if (wasExploring) this.onExploreChange?.(false);
  }

  private snapToDesired(): void {
    this.currentTarget.copy(this.desiredTarget);
    this.currentAzimuth = this.desiredAzimuth;
    this.currentElevation = this.desiredElevation;
    this.currentDistance = this.desiredDistance;
  }

  private applyCamera(): void {
    const horizontal = Math.cos(this.currentElevation) * this.currentDistance;
    this.cameraOffset.set(
      Math.sin(this.currentAzimuth) * horizontal,
      Math.sin(this.currentElevation) * this.currentDistance,
      Math.cos(this.currentAzimuth) * horizontal,
    );
    this.camera.position.copy(this.currentTarget).add(this.cameraOffset);
    this.camera.lookAt(this.currentTarget);
    this.canvas.dataset.cameraAzimuth = this.currentAzimuth.toFixed(4);
    this.canvas.dataset.cameraElevation = this.currentElevation.toFixed(4);
    this.canvas.dataset.cameraDistance = this.currentDistance.toFixed(4);
    this.canvas.dataset.cameraGoalAzimuth = this.desiredAzimuth.toFixed(4);
    this.canvas.dataset.cameraGoalElevation = this.desiredElevation.toFixed(4);
    this.canvas.dataset.cameraGoalDistance = this.desiredDistance.toFixed(4);
  }

  private recordInteraction(): void {
    this.lastInteractionTime = performance.now();
    this.canvas.dataset.autoOrbit = "false";
    this.onInteraction?.();
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || this.disposed) return;
    try {
      this.canvas.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic test events do not always register as active pointers.
    }
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pointers.size === 1) {
      this.pointerDownTime = performance.now();
      this.pointerTravel = 0;
    }
    this.canvas.classList.add("is-dragging");
    this.canvas.dataset.userInteracting = "true";
    this.recordInteraction();
    event.preventDefault();
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    const previous = this.pointers.get(event.pointerId);
    if (!previous) return;
    const previousCentroid = pointerCentroid(this.pointers);
    const previousDistance = firstTwoPointerDistance(this.pointers);
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const nextCentroid = pointerCentroid(this.pointers);
    const nextDistance = firstTwoPointerDistance(this.pointers);
    const deltaX = nextCentroid.x - previousCentroid.x;
    const deltaY = nextCentroid.y - previousCentroid.y;
    this.pointerTravel += Math.hypot(
      event.clientX - previous.x,
      event.clientY - previous.y,
    );
    const orbit = pointerOrbitDelta(deltaX, deltaY);
    this.orbit(orbit.azimuth, orbit.elevation);
    if (this.pointers.size >= 2 && previousDistance > 4 && nextDistance > 4) {
      this.zoom(pinchZoomScale(previousDistance, nextDistance));
    }
    event.preventDefault();
  };

  private finishPointer(event: PointerEvent, cancelled: boolean): void {
    const tracked = this.pointers.has(event.pointerId);
    this.pointers.delete(event.pointerId);
    if (this.canvas.hasPointerCapture(event.pointerId)) {
      this.canvas.releasePointerCapture(event.pointerId);
    }
    if (this.pointers.size === 0) {
      this.canvas.classList.remove("is-dragging");
      this.canvas.dataset.userInteracting = "false";
    }
    if (
      tracked &&
      !cancelled &&
      this.pointerTravel < 6 &&
      performance.now() - this.pointerDownTime < 550
    ) {
      this.onTap?.(event.clientX, event.clientY);
    }
  }

  private readonly handlePointerUp = (event: PointerEvent): void => {
    this.finishPointer(event, false);
  };

  private readonly handlePointerCancel = (event: PointerEvent): void => {
    this.finishPointer(event, true);
  };

  private readonly handleWheel = (event: WheelEvent): void => {
    if (this.exploreEngaged) {
      event.preventDefault();
      if (event.ctrlKey) {
        this.zoom(wheelPinchZoomScale(event.deltaY));
      } else {
        const orbit = trackpadOrbitDelta(event.deltaX, event.deltaY);
        this.orbit(orbit.azimuth, orbit.elevation);
      }
      return;
    }
    if (
      !event.ctrlKey &&
      Math.abs(event.deltaX) > Math.max(3, Math.abs(event.deltaY) * 1.35)
    ) {
      const orbit = horizontalTrackpadOrbitDelta(event.deltaX);
      this.orbit(orbit.azimuth, orbit.elevation);
    }
  };

  private readonly handleDoubleClick = (event: MouseEvent): void => {
    event.preventDefault();
    this.recordInteraction();
    this.onDoubleTap?.(event.clientX, event.clientY);
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    const key = event.key.toLowerCase();
    if (key === "escape") {
      if (this.exploreEngaged) {
        event.preventDefault();
        this.setExplore(false);
      }
      return;
    }
    if (key === "r") {
      event.preventDefault();
      this.recordInteraction();
      this.onReset?.();
      return;
    }
    const orbit = keyboardOrbitDelta(event.key, event.shiftKey);
    if (orbit) this.orbit(orbit.azimuth, orbit.elevation);
    else if (key === "+" || key === "=") this.zoom(0.88);
    else if (key === "-" || key === "_") this.zoom(1.14);
    else return;
    event.preventDefault();
  };

  private readonly handleGlobalKeyDown = (event: KeyboardEvent): void => {
    if (event.key.toLowerCase() === "escape" && this.exploreEngaged) {
      event.preventDefault();
      this.setExplore(false);
    }
  };

  private readonly handleWindowBlur = (): void => {
    this.setExplore(false);
    this.pointers.clear();
    this.canvas.classList.remove("is-dragging");
    this.canvas.dataset.userInteracting = "false";
  };

  private readonly handleGestureStart = (event: Event): void => {
    if (!this.exploreEngaged) return;
    event.preventDefault();
    this.safariGestureScale = 1;
    this.recordInteraction();
  };

  private readonly handleGestureChange = (event: Event): void => {
    if (!this.exploreEngaged) return;
    event.preventDefault();
    const scale = Number((event as Event & { scale?: number }).scale ?? 1);
    if (scale > 0 && Number.isFinite(scale)) {
      this.zoom(pinchZoomScale(this.safariGestureScale, scale));
      this.safariGestureScale = scale;
    }
  };

  private readonly handleGestureEnd = (event: Event): void => {
    if (!this.exploreEngaged) return;
    event.preventDefault();
    this.safariGestureScale = 1;
  };
}
