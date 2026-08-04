import { renderBenchmarkChart } from "./benchmark-chart";
import "./style.css";
import { loadWorldData } from "./world-data";
import {
  WorldScene,
  type HeatInspectionFrame,
  type HeatInspectionState,
  type RouteComparisonMetrics,
  type RouteComparisonMode,
  type SurfaceDisplayMode,
  type TargetPresetName,
} from "./world-scene";

let mathematicsRendered = false;

function isRouteMode(value: string): value is RouteComparisonMode {
  return (
    value === "chord" ||
    value === "edge" ||
    value === "heat" ||
    value === "compare"
  );
}

function isSurfaceMode(value: string): value is SurfaceDisplayMode {
  return (
    value === "surface" ||
    value === "heat" ||
    value === "distance" ||
    value === "contours" ||
    value === "mesh"
  );
}

function isHeatState(value: string): value is HeatInspectionState {
  return value === "early" || value === "middle" || value === "late";
}

function isTargetPreset(value: string): value is TargetPresetName {
  return value === "exterior" || value === "tunnel" || value === "farSide";
}

function formatLength(value: number): string {
  return `${value.toFixed(3)} world units`;
}

function formatDiffusionTime(value: number): string {
  return value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

function heatInspectionCaption(
  selection: HeatInspectionFrame,
  frameCount: number,
): string {
  const frame = selection.frameIndex + 1;
  const time = formatDiffusionTime(selection.time);
  const label =
    selection.state === "early"
      ? "Heat remains close to the source"
      : selection.state === "middle"
        ? "The front crosses the handle"
        : "Heat reaches the broad surface";
  return `${selection.state} heat, exported frame ${frame} of ${frameCount}, diffusion time ${time}. ${label}.`;
}

async function renderMathematics(): Promise<void> {
  if (mathematicsRendered) return;
  mathematicsRendered = true;
  const { default: katex } = await import("katex");
  document.querySelectorAll<HTMLElement>("[data-math]").forEach((element) => {
    const expression = element.dataset.math;
    if (!expression) return;
    katex.render(expression, element, {
      throwOnError: false,
      displayMode: element.classList.contains("equation"),
      strict: "warn",
      output: "htmlAndMathml",
    });
  });
}

function runNearViewport(element: Element, task: () => void): void {
  if (!("IntersectionObserver" in window)) {
    task();
    return;
  }
  const observer = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      task();
    },
    { rootMargin: "100% 0px" },
  );
  observer.observe(element);
}

function showFallback(message: string): void {
  const canvas = document.querySelector<HTMLCanvasElement>("#world-canvas")!;
  const fallback = document.querySelector<HTMLElement>("#webgl-fallback")!;
  const loading = document.querySelector<HTMLElement>("#loading")!;
  canvas.hidden = true;
  loading.hidden = true;
  fallback.hidden = false;
  const paragraph = fallback.querySelector("p");
  if (paragraph) paragraph.textContent = message;
}

function readVisitedNodes(): Set<string> {
  try {
    const stored = sessionStorage.getItem("geodesic-visited-nodes");
    return new Set(stored ? (JSON.parse(stored) as string[]) : []);
  } catch {
    return new Set();
  }
}

function storeVisitedNodes(visited: Set<string>): void {
  try {
    sessionStorage.setItem(
      "geodesic-visited-nodes",
      JSON.stringify([...visited]),
    );
  } catch {
    // Visited styling remains available for this page load.
  }
}

async function start(): Promise<void> {
  const firstMathematics = document.querySelector<HTMLElement>("[data-math]")!;
  runNearViewport(firstMathematics, () => {
    void renderMathematics().catch(() => {
      mathematicsRendered = false;
    });
  });

  const chart = document.querySelector<HTMLElement>("#benchmark-chart")!;
  const chartCaption =
    document.querySelector<HTMLElement>("#benchmark-caption")!;
  runNearViewport(chart, () => {
    void renderBenchmarkChart(chart, chartCaption).catch(() => {
      chartCaption.textContent =
        "Measured benchmark data could not be loaded in this browser.";
    });
  });

  const canvas = document.querySelector<HTMLCanvasElement>("#world-canvas")!;
  const loading = document.querySelector<HTMLElement>("#loading")!;
  const caption = document.querySelector<HTMLElement>("#scene-caption")!;
  const chapterIndicator =
    document.querySelector<HTMLElement>("#chapter-indicator")!;
  const routeReadout = document.querySelector<HTMLElement>("#route-readout")!;
  const controlStatus = document.querySelector<HTMLElement>("#control-status")!;
  const releaseButton =
    document.querySelector<HTMLButtonElement>("#release-button")!;
  const heatStatus = document.querySelector<HTMLElement>("#heat-status")!;
  const resetButton =
    document.querySelector<HTMLButtonElement>("#reset-control")!;
  const routeButtons = [
    ...document.querySelectorAll<HTMLButtonElement>("[data-route-mode]"),
  ];
  const surfaceButtons = [
    ...document.querySelectorAll<HTMLButtonElement>("[data-surface-mode]"),
  ];
  const heatButtons = [
    ...document.querySelectorAll<HTMLButtonElement>("[data-heat-state]"),
  ];
  const targetButtons = [
    ...document.querySelectorAll<HTMLButtonElement>("[data-target-preset]"),
  ];
  const chapters = [
    ...document.querySelectorAll<HTMLElement>(".chapter[data-act]"),
  ];
  const treeLinks = [
    ...document.querySelectorAll<HTMLAnchorElement>(
      ".exploration-tree a[href^='#']",
    ),
  ];
  const reducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;

  let currentRouteMode: RouteComparisonMode = "heat";
  let currentSurfaceMode: SurfaceDisplayMode = "surface";
  let currentTarget: TargetPresetName | "custom" = "exterior";
  let latestRouteMetrics: RouteComparisonMetrics | null = null;
  let activeChapter: HTMLElement | null = null;
  let heatCompletionTimer = 0;

  const syncPressed = (
    buttons: HTMLButtonElement[],
    dataKey: "routeMode" | "surfaceMode" | "targetPreset",
    value: string,
  ): void => {
    buttons.forEach((button) => {
      button.setAttribute(
        "aria-pressed",
        String(button.dataset[dataKey] === value),
      );
    });
  };

  const updateRouteReadout = (metrics: RouteComparisonMetrics): void => {
    latestRouteMetrics = metrics;
    if (currentRouteMode === "chord") {
      routeReadout.textContent = `Straight chord: ${formatLength(metrics.chordLength)}. This line is not surface constrained.`;
    } else if (currentRouteMode === "edge") {
      routeReadout.textContent = metrics.edgeReachesDestination
        ? `Edge Dijkstra: ${formatLength(metrics.edgeLength)}. Exact for the weighted mesh graph.`
        : `Edge Dijkstra stopped after ${formatLength(metrics.edgeLength)}.`;
    } else if (currentRouteMode === "heat") {
      routeReadout.textContent = metrics.heatReachesDestination
        ? `Heat route: approximately ${formatLength(metrics.heatLength)} across triangle faces.`
        : `Heat route stopped after approximately ${formatLength(metrics.heatLength)}.`;
    } else {
      routeReadout.textContent = `Chord ${metrics.chordLength.toFixed(3)}, edge ${metrics.edgeLength.toFixed(3)}, Heat approximation ${metrics.heatLength.toFixed(3)} world units.`;
    }
  };

  let worldScene: WorldScene;
  try {
    const { data, metadata } = await loadWorldData();
    worldScene = new WorldScene(canvas, data, {
      reducedMotion,
      onExplorerPlaced: (target) => {
        currentTarget = target;
        syncPressed(targetButtons, "targetPreset", target);
        controlStatus.textContent =
          target === "custom"
            ? "Custom target placed on the exported mesh."
            : `${target === "farSide" ? "Far side" : target} target selected.`;
      },
      onRouteMetricsChanged: updateRouteReadout,
    });
    worldScene.placeTargetPreset("exterior", false);
    worldScene.setRouteComparison("heat");

    const residualValues =
      document.querySelectorAll<HTMLElement>("#residual-list dd");
    if (residualValues[0]) {
      residualValues[0].textContent = `${metadata.vertices.toLocaleString()} vertices / ${metadata.faces.toLocaleString()} faces`;
    }
    if (residualValues[1]) {
      residualValues[1].textContent = `Closed genus ${metadata.topology.genus}, χ = ${metadata.topology.eulerCharacteristic}`;
    }
    if (residualValues[2]) {
      residualValues[2].textContent = metadata.heatResidual.toExponential(2);
    }
    if (residualValues[3]) {
      residualValues[3].textContent = metadata.poissonResidual.toExponential(2);
    }
    loading.hidden = true;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "unknown loading error";
    showFallback(
      `The interactive world could not start (${message}). The explanation and equations remain available below.`,
    );
    return;
  }

  const inspectionFrames = worldScene.getHeatInspectionFrames();
  heatButtons.forEach((button) => {
    const state = button.dataset.heatState ?? "";
    const selection = isHeatState(state)
      ? inspectionFrames.find((frame) => frame.state === state)
      : undefined;
    if (selection) {
      button.dataset.frameIndex = String(selection.frameIndex);
      button.dataset.frameTime = String(selection.time);
    }
  });

  const chooseRoute = (mode: RouteComparisonMode): void => {
    currentRouteMode = mode;
    syncPressed(routeButtons, "routeMode", mode);
    worldScene.setRouteComparison(mode);
    if (latestRouteMetrics) updateRouteReadout(latestRouteMetrics);
    caption.textContent = worldScene.caption;
  };

  const chooseSurface = (mode: SurfaceDisplayMode): void => {
    currentSurfaceMode = mode;
    syncPressed(surfaceButtons, "surfaceMode", mode);
    worldScene.setSurfaceDisplay(mode);
    controlStatus.textContent = `${mode} surface display selected.`;
  };

  const chooseTarget = (target: TargetPresetName): void => {
    currentTarget = target;
    syncPressed(targetButtons, "targetPreset", target);
    worldScene.placeTargetPreset(target);
  };

  routeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const mode = button.dataset.routeMode ?? "";
      if (isRouteMode(mode)) chooseRoute(mode);
    });
  });

  surfaceButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const mode = button.dataset.surfaceMode ?? "";
      if (isSurfaceMode(mode)) chooseSurface(mode);
    });
  });

  heatButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const state = button.dataset.heatState ?? "";
      if (!isHeatState(state)) return;
      const selection = worldScene.inspectHeatState(state);
      heatButtons.forEach((candidate) => {
        candidate.setAttribute("aria-pressed", String(candidate === button));
      });
      currentSurfaceMode = "heat";
      syncPressed(surfaceButtons, "surfaceMode", "heat");
      controlStatus.textContent = heatInspectionCaption(
        selection,
        inspectionFrames.length === 0
          ? 0
          : Math.max(...inspectionFrames.map((frame) => frame.frameIndex)) + 1,
      );
      caption.textContent = `Showing the ${state} exported heat state.`;
    });
  });

  targetButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const target = button.dataset.targetPreset ?? "";
      if (isTargetPreset(target)) chooseTarget(target);
    });
  });

  resetButton.addEventListener("click", () => {
    worldScene.resetInteractiveView();
    currentRouteMode = "heat";
    currentSurfaceMode = "surface";
    currentTarget = "exterior";
    syncPressed(routeButtons, "routeMode", currentRouteMode);
    syncPressed(surfaceButtons, "surfaceMode", currentSurfaceMode);
    syncPressed(targetButtons, "targetPreset", currentTarget);
    heatButtons.forEach((button) =>
      button.setAttribute("aria-pressed", "false"),
    );
    releaseButton.disabled = false;
    releaseButton.textContent = "Release heat";
    heatStatus.textContent = "Six C++ generated diffusion states are ready.";
    controlStatus.textContent = "World controls reset to the exterior target.";
    caption.textContent = worldScene.caption;
  });

  releaseButton.addEventListener("click", () => {
    window.clearTimeout(heatCompletionTimer);
    worldScene.releaseHeat();
    chooseRoute("heat");
    currentSurfaceMode = "heat";
    syncPressed(surfaceButtons, "surfaceMode", "heat");
    releaseButton.disabled = true;
    releaseButton.textContent = "Heat released";
    heatStatus.textContent =
      "Diffusion is moving through the exported solutions.";
    controlStatus.textContent =
      "Heat animation started from the C++ generated frames.";
    heatCompletionTimer = window.setTimeout(
      () => {
        heatStatus.textContent =
          "Diffusion complete. Inspect any heat frame above.";
      },
      reducedMotion ? 0 : 5300,
    );
  });

  const visited = readVisitedNodes();
  const applyVisited = (): void => {
    treeLinks.forEach((link) => {
      const id = link.hash.slice(1);
      link.dataset.visited = String(visited.has(id));
    });
  };
  const markVisited = (chapter: HTMLElement): void => {
    if (!chapter.dataset.branchNode || !chapter.id) return;
    visited.add(chapter.id);
    storeVisitedNodes(visited);
    applyVisited();
  };
  applyVisited();

  treeLinks.forEach((link) => {
    link.addEventListener("click", () => {
      const id = link.hash.slice(1);
      if (id) {
        visited.add(id);
        storeVisitedNodes(visited);
        applyVisited();
      }
    });
  });

  const mobileQuery = window.matchMedia("(max-width: 820px)");
  document
    .querySelectorAll<HTMLDetailsElement>(".exploration-tree details")
    .forEach((details) => {
      details.addEventListener("toggle", () => {
        if (!mobileQuery.matches || !details.open) return;
        document
          .querySelectorAll<HTMLDetailsElement>(".exploration-tree details")
          .forEach((candidate) => {
            if (candidate !== details) candidate.open = false;
          });
      });
    });

  const applyNarrativeState = (chapter: HTMLElement): void => {
    const act = Number(chapter.dataset.act ?? 0);
    worldScene.setAct(act);
    const route = chapter.dataset.routeDefault ?? "heat";
    if (isRouteMode(route)) chooseRoute(route);
    const surface = chapter.dataset.surfaceDefault ?? "surface";
    if (isSurfaceMode(surface)) chooseSurface(surface);
    const target = chapter.dataset.targetDefault;
    if (target && isTargetPreset(target) && target !== currentTarget) {
      chooseTarget(target);
    }
    caption.textContent = worldScene.caption;
    const heading = chapter.querySelector("h1, h2")?.textContent?.trim();
    chapterIndicator.textContent = heading ?? "Curved world";
    markVisited(chapter);
  };

  const activateChapter = (chapter: HTMLElement): void => {
    activeChapter = chapter;
    chapters.forEach((candidate) => {
      candidate.classList.toggle("is-active", candidate === chapter);
    });
    applyNarrativeState(chapter);
  };

  let ticking = false;
  const updateStory = (): void => {
    ticking = false;
    const targetY = window.innerHeight * (mobileQuery.matches ? 0.72 : 0.5);
    let nearest = chapters[0]!;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const chapter of chapters) {
      const rect = chapter.getBoundingClientRect();
      const distance =
        rect.top <= targetY && rect.bottom >= targetY
          ? 0
          : Math.min(
              Math.abs(rect.top - targetY),
              Math.abs(rect.bottom - targetY),
            );
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = chapter;
      }
    }
    if (nearest !== activeChapter) {
      activateChapter(nearest);
    }
  };
  const requestStoryUpdate = (): void => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(updateStory);
  };

  window.addEventListener("scroll", requestStoryUpdate, { passive: true });
  window.addEventListener("resize", requestStoryUpdate, { passive: true });
  window.addEventListener("hashchange", () => {
    const id = decodeURIComponent(location.hash.slice(1));
    const chapter = id ? document.getElementById(id) : null;
    if (chapter instanceof HTMLElement) {
      if (chapters.includes(chapter)) activateChapter(chapter);
      else markVisited(chapter);
    }
    requestAnimationFrame(requestStoryUpdate);
  });
  updateStory();

  const directId = decodeURIComponent(location.hash.slice(1));
  const directChapter = directId ? document.getElementById(directId) : null;
  if (directChapter instanceof HTMLElement) {
    if (chapters.includes(directChapter)) activateChapter(directChapter);
    else markVisited(directChapter);
  }

  window.addEventListener(
    "beforeunload",
    () => {
      window.clearTimeout(heatCompletionTimer);
      worldScene.destroy();
    },
    { once: true },
  );
}

void start();
