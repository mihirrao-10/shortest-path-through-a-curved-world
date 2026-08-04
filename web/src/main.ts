import { renderBenchmarkChart } from "./benchmark-chart";
import "./style.css";
import {
  loadWorldData,
  type RoutePreset,
  type RoutePresetId,
} from "./world-data";
import { WorldScene } from "./world-scene";

const ROUTE_IDS: RoutePresetId[] = [
  "ridge-crossing",
  "saddle-pass",
  "basin-rim",
];

let mathematicsRendered = false;

function isRouteId(value: string): value is RoutePresetId {
  return ROUTE_IDS.some((routeId) => routeId === value);
}

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
  runNearViewport(document.querySelector("#mathematics"), () => {
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
  const caption = document.querySelector<HTMLElement>("#scene-caption")!;
  const indicator = document.querySelector<HTMLElement>("#chapter-indicator");
  const activeName = document.querySelector<HTMLElement>("#active-route-name")!;
  const activeId =
    document.querySelector<HTMLOutputElement>("#active-route-id")!;
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
  const routeButtons = [
    ...document.querySelectorAll<HTMLButtonElement>("button[data-route-id]"),
  ];
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
  const routeChoice = document.querySelector<HTMLElement>("#route-choice")!;
  const routeDetails = document.querySelector<HTMLElement>("#route-details")!;
  const progressFill = document.querySelector<HTMLElement>("#progress-fill");
  const progressItems = [
    ...document.querySelectorAll<HTMLLIElement>(".progress-rail li"),
  ];
  const chapters = [
    ...document.querySelectorAll<HTMLElement>(".chapter[data-act]"),
  ];
  const reducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;

  let worldScene: WorldScene;
  let selectedRouteId: RoutePresetId = "ridge-crossing";
  let releaseTimer = 0;
  let presetById = new Map<RoutePresetId, RoutePreset>();

  const updateRouteCopy = (preset: RoutePreset): void => {
    selectedRouteId = preset.id;
    document.body.dataset.activeRoute = preset.id;
    activeId.textContent = preset.id;
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

  try {
    const { data, metadata } = await loadWorldData();
    presetById = new Map(
      metadata.routePresets.map((preset) => [preset.id, preset]),
    );
    fillComparisonTable(comparisonBody, metadata.routePresets);
    worldScene = new WorldScene(canvas, data, metadata, {
      reducedMotion,
      onRouteSelected: updateRouteCopy,
    });
    updateRouteCopy(worldScene.selectedPreset);

    const residualValues =
      document.querySelectorAll<HTMLElement>("#residual-list dd");
    if (residualValues[0]) {
      residualValues[0].textContent = `${metadata.vertices.toLocaleString()} vertices / ${metadata.faces.toLocaleString()} faces`;
    }
    if (residualValues[1]) {
      residualValues[1].textContent = metadata.heatResidual.toExponential(2);
    }
    if (residualValues[2]) {
      residualValues[2].textContent = metadata.poissonResidual.toExponential(2);
    }
    loading.hidden = true;
    comparisonPanel.hidden = true;
    compareRoutes.setAttribute("aria-pressed", "false");
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "unknown loading error";
    showFallback(
      `The interactive world could not start (${message}). The explanation and mathematics remain available below.`,
    );
    return;
  }

  const selectRoute = (routeId: RoutePresetId): void => {
    worldScene.selectRoute(routeId);
    const preset = presetById.get(routeId);
    if (preset) updateRouteCopy(preset);
    comparisonPanel.hidden = true;
    compareRoutes.setAttribute("aria-pressed", "false");
    caption.textContent = worldScene.caption;
  };

  routeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const routeId = button.dataset.routeId ?? "";
      if (isRouteId(routeId)) selectRoute(routeId);
    });
  });

  releaseButton.addEventListener("click", () => {
    window.clearTimeout(releaseTimer);
    worldScene.releaseHeat();
    releaseButton.disabled = true;
    releaseButton.textContent = "Heat released";
    heatStatus.textContent =
      "Diffusion is moving through six exported C++ solutions.";
    caption.textContent = worldScene.caption;
    releaseTimer = window.setTimeout(
      () => {
        heatStatus.textContent =
          "Diffusion complete. Continue to read the direction field.";
      },
      reducedMotion ? 0 : 4300,
    );
  });

  replayRoute.addEventListener("click", () => {
    worldScene.replayRoute();
    comparisonPanel.hidden = true;
    compareRoutes.setAttribute("aria-pressed", "false");
    caption.textContent = `${worldScene.selectedPreset.label} replayed from its authored start.`;
  });

  chooseRoute.addEventListener("click", () => {
    worldScene.hideRouteComparison();
    comparisonPanel.hidden = true;
    compareRoutes.setAttribute("aria-pressed", "false");
    document.querySelector("#route-choice")?.scrollIntoView({
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
    const showComparisonState = (): void => {
      worldScene.setAct(7);
      worldScene.showRouteComparison();
      comparisonPanel.hidden = false;
      compareRoutes.setAttribute("aria-pressed", "true");
      caption.textContent = worldScene.caption;
    };
    showComparisonState();
    const mobile = window.matchMedia("(max-width: 760px)").matches;
    const stageBottom = document
      .querySelector<HTMLElement>("#world-stage")!
      .getBoundingClientRect().bottom;
    const desiredPanelTop = mobile
      ? Math.min(window.innerHeight * 0.62, stageBottom + 16)
      : 160;
    const targetTop =
      window.scrollY +
      comparisonPanel.getBoundingClientRect().top -
      desiredPanelTop;
    window.scrollTo({
      top: targetTop,
      behavior: reducedMotion ? "auto" : "smooth",
    });
    window.setTimeout(
      () => {
        showComparisonState();
        comparisonPanel.focus({ preventScroll: true });
      },
      reducedMotion ? 0 : 650,
    );
  });

  replayJourney.addEventListener("click", () => {
    window.clearTimeout(releaseTimer);
    worldScene.resetJourney();
    updateRouteCopy(worldScene.selectedPreset);
    releaseButton.disabled = false;
    releaseButton.textContent = "Release heat";
    heatStatus.textContent = "Six C++ generated diffusion states are ready.";
    comparisonPanel.hidden = true;
    compareRoutes.setAttribute("aria-pressed", "false");
    document.querySelector("#arrival")?.scrollIntoView({
      behavior: reducedMotion ? "auto" : "smooth",
      block: "start",
    });
  });

  let activeChapter: HTMLElement | null = null;
  let ticking = false;
  const activateChapter = (chapter: HTMLElement): void => {
    if (chapter === activeChapter) return;
    activeChapter = chapter;
    chapters.forEach((candidate) =>
      candidate.classList.toggle("is-active", candidate === chapter),
    );
    const act = Number(chapter.dataset.act ?? 0);
    worldScene.setAct(act);
    const heading = chapter.querySelector("h1, h2")?.textContent?.trim();
    if (indicator) indicator.textContent = heading ?? "Curved world";
    caption.textContent = worldScene.caption;
    progressItems.forEach((item, index) =>
      item.classList.toggle("is-active", index === act),
    );
    if (act === 7) {
      comparisonPanel.hidden = false;
      compareRoutes.setAttribute("aria-pressed", "true");
    } else if (comparisonPanel.hidden === false) {
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
      const rect = chapter.getBoundingClientRect();
      const distance =
        rect.top <= targetY && rect.bottom >= targetY
          ? 0
          : Math.min(
              Math.abs(rect.top - targetY),
              Math.abs(rect.bottom - targetY),
            );
      if (distance < nearestDistance) {
        nearest = chapter;
        nearestDistance = distance;
      }
    });
    activateChapter(nearest);
    if (progressFill) {
      const scrollable =
        document.documentElement.scrollHeight - window.innerHeight;
      const progress = scrollable > 0 ? window.scrollY / scrollable : 0;
      progressFill.style.height = `${Math.min(1, Math.max(0, progress)) * 100}%`;
    }
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
      window.clearTimeout(releaseTimer);
      worldScene.destroy();
    },
    { once: true },
  );
}

void start();
