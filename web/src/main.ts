import "@fontsource/stix-two-text/latin-400.css";
import "@fontsource/stix-two-text/latin-400-italic.css";
import "@fontsource/stix-two-text/latin-600.css";
import { renderBenchmarkChart } from "./benchmark-chart";
import "./style.css";
import {
  WorldDataRepository,
  type RoutePreset,
  type RoutePresetId,
  type SupportedGenus,
  type WorldBundle,
} from "./world-data";
import { WorldScene } from "./world-scene";

let mathematicsRendered = false;

function formatLength(value: number): string {
  return `${value.toFixed(3)} surface units`;
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

function runNearViewport(element: Element | null, task: () => void): void {
  if (!element) return;
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
  const canvas = document.querySelector<HTMLCanvasElement>("#world-canvas");
  const fallback = document.querySelector<HTMLElement>("#webgl-fallback");
  const loading = document.querySelector<HTMLElement>("#loading");
  if (canvas) canvas.hidden = true;
  if (loading) loading.hidden = true;
  if (fallback) {
    fallback.hidden = false;
    const paragraph = fallback.querySelector("p");
    if (paragraph) paragraph.textContent = message;
  }
}

function fillComparisonTable(
  body: HTMLElement,
  presets: readonly RoutePreset[],
): void {
  body.replaceChildren();
  presets.forEach((preset) => {
    const row = document.createElement("tr");
    row.dataset.routeId = preset.id;
    const values = [
      preset.label,
      formatLength(preset.ambientChordLength),
      formatLength(preset.edgeDijkstraRouteLength),
      formatLength(preset.tracedHeatMethodRouteLength),
    ];
    values.forEach((value, index) => {
      const cell = document.createElement(index === 0 ? "th" : "td");
      if (index === 0) cell.setAttribute("scope", "row");
      cell.textContent = value;
      row.append(cell);
    });
    body.append(row);
  });
}

async function start(): Promise<void> {
  runNearViewport(document.querySelector("#straight-line"), () => {
    void renderMathematics().catch(() => {
      mathematicsRendered = false;
    });
  });
  const chart = document.querySelector<HTMLElement>("#benchmark-chart");
  const chartCaption =
    document.querySelector<HTMLElement>("#benchmark-caption");
  if (chart && chartCaption) {
    runNearViewport(chart, () => {
      void renderBenchmarkChart(chart, chartCaption).catch(() => {
        chartCaption.textContent =
          "Measured benchmark data could not be loaded in this browser.";
      });
    });
  }

  const canvas = document.querySelector<HTMLCanvasElement>("#world-canvas")!;
  const loading = document.querySelector<HTMLElement>("#loading")!;
  const loadingCopy = loading.querySelector("p")!;
  const caption = document.querySelector<HTMLElement>("#scene-caption")!;
  const activeName = document.querySelector<HTMLElement>("#active-route-name")!;
  const activeDescription = document.querySelector<HTMLElement>(
    "#active-route-description",
  )!;
  const ambientLength = document.querySelector<HTMLElement>("#ambient-length")!;
  const dijkstraLength =
    document.querySelector<HTMLElement>("#dijkstra-length")!;
  const heatLength = document.querySelector<HTMLElement>("#heat-length")!;
  const comparisonPanel =
    document.querySelector<HTMLElement>("#comparison-panel")!;
  const comparisonBody = document.querySelector<HTMLElement>(
    "#comparison-table-body",
  )!;
  const comparisonLegend =
    document.querySelector<HTMLElement>("#comparison-legend")!;
  const routeButtonsContainer =
    document.querySelector<HTMLElement>("#route-buttons")!;
  const releaseButton =
    document.querySelector<HTMLButtonElement>("#release-button")!;
  const heatStatus = document.querySelector<HTMLElement>("#heat-status")!;
  const replayRoute =
    document.querySelector<HTMLButtonElement>("#replay-route")!;
  const chooseRoute =
    document.querySelector<HTMLButtonElement>("#choose-route")!;
  const compareRoutes =
    document.querySelector<HTMLButtonElement>("#compare-routes")!;
  const replayJourney =
    document.querySelector<HTMLButtonElement>("#replay-journey")!;
  const exploreView =
    document.querySelector<HTMLButtonElement>("#explore-view")!;
  const resetView = document.querySelector<HTMLButtonElement>("#reset-view")!;
  const focusBeacon =
    document.querySelector<HTMLButtonElement>("#focus-beacon")!;
  const focusRouteStart =
    document.querySelector<HTMLButtonElement>("#focus-route-start")!;
  const routeChoice = document.querySelector<HTMLElement>("#route-choice")!;
  const routeDetails = document.querySelector<HTMLElement>("#route-details")!;
  const genusButtons = [
    ...document.querySelectorAll<HTMLButtonElement>("button[data-genus]"),
  ];
  const chapters = [
    ...document.querySelectorAll<HTMLElement>(".chapter[data-act]"),
  ];
  const reducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  const repository = new WorldDataRepository();

  let worldScene: WorldScene | undefined;
  let activeGenus: SupportedGenus = 2;
  let selectedRouteId: RoutePresetId = "";
  let presetById = new Map<RoutePresetId, RoutePreset>();
  let routeButtons: HTMLButtonElement[] = [];
  let loadingGenus = false;
  let activeChapter = chapters[0] ?? null;

  const setHeatInterface = (state: "idle" | "animation" | "released"): void => {
    const enabled = state !== "idle";
    releaseButton.setAttribute("aria-pressed", String(enabled));
    releaseButton.textContent = enabled ? "Remove heat" : "Release heat";
    heatStatus.textContent =
      state === "animation"
        ? "Diffusion is moving through six exported C++ solutions."
        : state === "released"
          ? "Diffusion complete. Select Remove heat to restore the surface."
          : "Six exported diffusion states, solved by the C++ engine.";
  };

  const updateRouteCopy = (preset: RoutePreset): void => {
    selectedRouteId = preset.id;
    document.body.dataset.activeRoute = preset.id;
    routeChoice.dataset.activeRouteId = preset.id;
    routeDetails.dataset.activeRouteId = preset.id;
    activeName.textContent = preset.label;
    activeDescription.textContent = preset.description;
    ambientLength.textContent = formatLength(preset.ambientChordLength);
    dijkstraLength.textContent = formatLength(preset.edgeDijkstraRouteLength);
    heatLength.textContent = formatLength(preset.tracedHeatMethodRouteLength);
    routeButtons.forEach((button) => {
      const active = button.dataset.routeId === preset.id;
      button.setAttribute("aria-pressed", String(active));
      button.classList.toggle("is-active", active);
      if (active) button.setAttribute("aria-current", "true");
      else button.removeAttribute("aria-current");
    });
  };

  const selectRoute = (routeId: RoutePresetId): void => {
    if (!worldScene || !presetById.has(routeId)) return;
    worldScene.selectRoute(routeId);
    updateRouteCopy(presetById.get(routeId)!);
    comparisonPanel.hidden = true;
    compareRoutes.setAttribute("aria-pressed", "false");
    caption.textContent = worldScene.caption;
  };

  const rebuildRouteButtons = (presets: readonly RoutePreset[]): void => {
    routeButtonsContainer.replaceChildren();
    comparisonLegend.replaceChildren();
    routeButtons = presets.map((preset, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "route-button";
      button.dataset.routeId = preset.id;
      button.setAttribute("aria-pressed", String(index === 0));
      const label = document.createElement("span");
      label.textContent = preset.label;
      const description = document.createElement("small");
      description.textContent = preset.description;
      button.append(label, description);
      button.addEventListener("click", () => selectRoute(preset.id));
      routeButtonsContainer.append(button);
      const legendItem = document.createElement("span");
      legendItem.dataset.routeId = preset.id;
      const swatch = document.createElement("i");
      swatch.className = "route-swatch";
      legendItem.append(swatch, preset.label);
      comparisonLegend.append(legendItem);
      return button;
    });
  };

  const updateExportedMeasurements = (bundle: WorldBundle): void => {
    const residualValues =
      document.querySelectorAll<HTMLElement>("#residual-list dd");
    if (residualValues[0]) {
      residualValues[0].textContent = `Genus ${bundle.metadata.topology.genus}, ${bundle.metadata.vertices.toLocaleString()} vertices / ${bundle.metadata.faces.toLocaleString()} faces`;
    }
    if (residualValues[1]) {
      residualValues[1].textContent =
        bundle.metadata.heatResidual.toExponential(2);
    }
    if (residualValues[2]) {
      residualValues[2].textContent =
        bundle.metadata.poissonResidual.toExponential(2);
    }
  };

  const setGenusControls = (genus: SupportedGenus, disabled: boolean): void => {
    genusButtons.forEach((button) => {
      button.disabled = disabled;
      button.setAttribute(
        "aria-pressed",
        String(Number(button.dataset.genus) === genus),
      );
    });
  };

  const createScene = (bundle: WorldBundle): void => {
    worldScene?.destroy();
    activeGenus = bundle.metadata.topology.genus;
    presetById = new Map(
      bundle.metadata.routePresets.map((preset) => [preset.id, preset]),
    );
    rebuildRouteButtons(bundle.metadata.routePresets);
    fillComparisonTable(comparisonBody, bundle.metadata.routePresets);
    worldScene = new WorldScene(canvas, bundle.data, bundle.metadata, {
      reducedMotion,
      onRouteSelected: updateRouteCopy,
      onExploreChange: (engaged) => {
        exploreView.setAttribute("aria-pressed", String(engaged));
        exploreView.textContent = engaged
          ? "Exit Explore view"
          : "Explore view";
      },
      onCaptionChange: (nextCaption) => {
        caption.textContent = nextCaption;
      },
      onHeatStateChange: setHeatInterface,
    });
    updateRouteCopy(worldScene.selectedPreset);
    comparisonPanel.hidden = true;
    compareRoutes.setAttribute("aria-pressed", "false");
    setHeatInterface("idle");
    const activeAct = Number(activeChapter?.dataset.act ?? 0);
    worldScene.setAct(activeAct);
    canvas.setAttribute(
      "aria-label",
      `${bundle.metadata.accessibleLabel} with an amber heat source and selected native route`,
    );
    document.body.dataset.genus = String(activeGenus);
    updateExportedMeasurements(bundle);
  };

  const switchWorld = async (
    genus: SupportedGenus,
    initial = false,
  ): Promise<void> => {
    if (loadingGenus || (!initial && genus === activeGenus)) return;
    loadingGenus = true;
    const preservedScroll = window.scrollY;
    const wasCached = repository.isCached(genus);
    worldScene?.setHeatEnabled(false);
    setHeatInterface("idle");
    setGenusControls(genus, true);
    loading.hidden = false;
    loading.dataset.genus = String(genus);
    loadingCopy.textContent = wasCached
      ? `Restoring cached Genus ${genus} world`
      : `Loading native Genus ${genus} world`;
    try {
      const bundle = await repository.loadWorld(genus);
      createScene(bundle);
      canvas.dataset.loadSource = wasCached ? "cache" : "network";
      loading.hidden = true;
      window.scrollTo({ top: preservedScroll, behavior: "auto" });
      setGenusControls(genus, false);
      caption.textContent = `Genus ${genus} loaded from native geometry and fields.`;
    } catch (error) {
      if (initial || !worldScene) throw error;
      const message = error instanceof Error ? error.message : "unknown error";
      loadingCopy.textContent = `Genus ${genus} could not load: ${message}`;
      window.setTimeout(() => {
        loading.hidden = true;
      }, 2600);
      setGenusControls(activeGenus, false);
      window.scrollTo({ top: preservedScroll, behavior: "auto" });
    } finally {
      loadingGenus = false;
    }
  };

  try {
    const manifest = await repository.loadManifest();
    await switchWorld(manifest.defaultGenus, true);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "unknown loading error";
    showFallback(
      `The interactive world could not start (${message}). The explanation and mathematics remain available below.`,
    );
    return;
  }

  genusButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const genus = Number(button.dataset.genus);
      if (genus === 1 || genus === 2 || genus === 3) void switchWorld(genus);
    });
  });

  exploreView.addEventListener("click", () => {
    worldScene?.toggleExplore();
    if (worldScene) {
      caption.textContent = worldScene.exploreEngaged
        ? "Explore view engaged. Two-finger motion orbits, pinch zooms, and Escape exits."
        : worldScene.caption;
    }
  });
  resetView.addEventListener("click", () => worldScene?.resetView());
  focusBeacon.addEventListener("click", () => worldScene?.focusBeacon());
  focusRouteStart.addEventListener("click", () =>
    worldScene?.focusRouteStart(),
  );

  releaseButton.addEventListener("click", () => {
    if (!worldScene) return;
    const enabled = worldScene.toggleHeat();
    setHeatInterface(
      enabled ? (reducedMotion ? "released" : "animation") : "idle",
    );
    caption.textContent = worldScene.caption;
  });

  replayRoute.addEventListener("click", () => {
    if (!worldScene) return;
    worldScene.replayRoute();
    comparisonPanel.hidden = true;
    compareRoutes.setAttribute("aria-pressed", "false");
    caption.textContent = `${worldScene.selectedPreset.label} replayed from its native-authored start.`;
  });

  chooseRoute.addEventListener("click", () => {
    worldScene?.hideRouteComparison();
    comparisonPanel.hidden = true;
    compareRoutes.setAttribute("aria-pressed", "false");
    routeChoice.scrollIntoView({
      behavior: reducedMotion ? "auto" : "smooth",
      block: "center",
    });
    window.setTimeout(
      () =>
        routeButtons
          .find((button) => button.dataset.routeId === selectedRouteId)
          ?.focus(),
      reducedMotion ? 0 : 350,
    );
  });

  compareRoutes.addEventListener("click", () => {
    if (!worldScene) return;
    worldScene.setAct(7);
    worldScene.showRouteComparison();
    comparisonPanel.hidden = false;
    compareRoutes.setAttribute("aria-pressed", "true");
    caption.textContent = worldScene.caption;
    comparisonPanel.focus({ preventScroll: true });
  });

  replayJourney.addEventListener("click", () => {
    if (!worldScene) return;
    worldScene.resetJourney();
    updateRouteCopy(worldScene.selectedPreset);
    setHeatInterface("idle");
    comparisonPanel.hidden = true;
    compareRoutes.setAttribute("aria-pressed", "false");
    document.querySelector("#arrival")?.scrollIntoView({
      behavior: reducedMotion ? "auto" : "smooth",
      block: "start",
    });
  });

  let ticking = false;
  const activateChapter = (chapter: HTMLElement): void => {
    if (chapter === activeChapter) return;
    activeChapter = chapter;
    chapters.forEach((candidate) =>
      candidate.classList.toggle("is-active", candidate === chapter),
    );
    const act = Number(chapter.dataset.act ?? 0);
    worldScene?.setAct(act);
    if (worldScene) caption.textContent = worldScene.caption;
    if (act === 7) {
      comparisonPanel.hidden = false;
      compareRoutes.setAttribute("aria-pressed", "true");
    } else if (!comparisonPanel.hidden) {
      comparisonPanel.hidden = true;
      compareRoutes.setAttribute("aria-pressed", "false");
    }
  };
  const updateStory = (): void => {
    ticking = false;
    const mobile = window.matchMedia("(max-width: 760px)").matches;
    const targetY = window.innerHeight * (mobile ? 0.72 : 0.5);
    let nearest = chapters[0]!;
    let nearestDistance = Number.POSITIVE_INFINITY;
    chapters.forEach((chapter) => {
      const rectangle = chapter.getBoundingClientRect();
      const distance =
        rectangle.top <= targetY && rectangle.bottom >= targetY
          ? 0
          : Math.min(
              Math.abs(rectangle.top - targetY),
              Math.abs(rectangle.bottom - targetY),
            );
      if (distance < nearestDistance) {
        nearest = chapter;
        nearestDistance = distance;
      }
    });
    activateChapter(nearest);
  };
  const requestStoryUpdate = (): void => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(updateStory);
  };
  window.addEventListener("scroll", requestStoryUpdate, { passive: true });
  window.addEventListener("resize", requestStoryUpdate, { passive: true });
  updateStory();

  window.addEventListener(
    "beforeunload",
    () => {
      worldScene?.destroy();
    },
    { once: true },
  );
}

void start();
