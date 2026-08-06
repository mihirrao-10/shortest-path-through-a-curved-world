import "@fontsource/stix-two-text/latin-400.css";
import "@fontsource/stix-two-text/latin-400-italic.css";
import "@fontsource/stix-two-text/latin-600.css";
import { renderBenchmarkChart } from "./benchmark-chart";
import {
  canProceed,
  createInitialJourneyState,
  isActUnlocked,
  isCompareEligible,
  reduceJourney,
  type JourneyAct,
  type JourneyAction,
  type JourneyState,
} from "./journey-state";
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
let benchmarkRendered = false;

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Required element is missing: ${selector}`);
  return element;
}

function formatLength(value: number): string {
  return `${value.toFixed(3)} surface units`;
}

async function renderMathematics(): Promise<void> {
  if (mathematicsRendered) return;
  mathematicsRendered = true;
  try {
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
  } catch (error) {
    mathematicsRendered = false;
    document.querySelectorAll<HTMLElement>("[data-math]").forEach((element) => {
      if (!element.textContent?.trim()) {
        element.textContent = element.dataset.math ?? "";
      }
    });
    throw error;
  }
}

function clearHash(): void {
  if (!window.location.hash) return;
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${window.location.search}`,
  );
}

clearHash();
window.history.scrollRestoration = "manual";
window.scrollTo(0, 0);

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

function supportsWebGL(): boolean {
  try {
    const probe = document.createElement("canvas");
    return Boolean(probe.getContext("webgl2") || probe.getContext("webgl"));
  } catch {
    return false;
  }
}

function fallbackCaption(
  genus: SupportedGenus,
  state: JourneyState,
  route: RoutePreset | undefined,
): string {
  if (state.compareMode) {
    return "Comparison mode lists all three exported Heat Method traces and measurements.";
  }
  if (state.activeAct === 3 && route) {
    return `${route.label} is selected. Its exported measurements remain available in the fallback.`;
  }
  const captions = [
    `A written view of the closed Genus ${genus} world.`,
    "The ambient chord leaves the surface, so it is not a legal walking route.",
    "Edge Dijkstra is exact only on the mesh-edge graph.",
    "Select an exported start to reveal its three measured lengths.",
    state.heatReleased
      ? "All six exported heat states have completed."
      : "The beacon is ready to release six exported heat states.",
    "The exported facewise directions point away from the source.",
    "The equations define surface length and reconstruct a distance field.",
    "The comparison table uses three validated C++-exported traces.",
    "The chart reports measured CPU preprocessing and query times.",
    "The committed route follows the reconstructed field toward the beacon.",
    "C++20 and Eigen produced the geometry, fields, paths, and residuals.",
  ] as const;
  return captions[state.activeAct] ?? captions[0];
}

async function start(): Promise<void> {
  const openingScreen = required<HTMLElement>("#opening-screen");
  const startButton = required<HTMLButtonElement>("#start-button");
  const startupStatus = required<HTMLElement>("#startup-status");
  const journeyShell = required<HTMLElement>("#journey-shell");
  const announcer = required<HTMLElement>("#journey-announcer");
  const skipLink = required<HTMLAnchorElement>(".skip-link");
  const backToWorld = required<HTMLAnchorElement>("#back-to-world");
  const siteFooter = required<HTMLElement>("#site-footer");
  const stage = required<HTMLElement>("#world-stage");
  const canvas = required<HTMLCanvasElement>("#world-canvas");
  const loading = required<HTMLElement>("#loading");
  const loadingCopy = required<HTMLElement>("#loading p");
  const fallback = required<HTMLElement>("#webgl-fallback");
  const fallbackCopy = required<HTMLElement>("#webgl-fallback p");
  const caption = required<HTMLElement>("#scene-caption");
  const activeName = required<HTMLElement>("#active-route-name");
  const activeDescription = required<HTMLElement>("#active-route-description");
  const ambientLength = required<HTMLElement>("#ambient-length");
  const dijkstraLength = required<HTMLElement>("#dijkstra-length");
  const heatLength = required<HTMLElement>("#heat-length");
  const routePrompt = required<HTMLElement>("#route-selection-prompt");
  const routeDetails = required<HTMLElement>("#route-details");
  const routeChoice = required<HTMLElement>("#route-choice");
  const routeButtonsContainer = required<HTMLElement>("#route-buttons");
  const comparisonPanel = required<HTMLElement>("#comparison-panel");
  const comparisonBody = required<HTMLElement>("#comparison-table-body");
  const comparisonLegend = required<HTMLElement>("#comparison-legend");
  const compareRoutes = required<HTMLButtonElement>("#compare-routes");
  const releaseButton = required<HTMLButtonElement>("#release-button");
  const heatStatus = required<HTMLElement>("#heat-status");
  const replayJourney = required<HTMLButtonElement>("#replay-journey");
  const exploreView = required<HTMLButtonElement>("#explore-view");
  const resetView = required<HTMLButtonElement>("#reset-view");
  const focusBeacon = required<HTMLButtonElement>("#focus-beacon");
  const focusRouteStart = required<HTMLButtonElement>("#focus-route-start");
  const chart = required<HTMLElement>("#benchmark-chart");
  const chartCaption = required<HTMLElement>("#benchmark-caption");
  const chapters = [
    ...document.querySelectorAll<HTMLElement>(".chapter[data-act]"),
  ];
  const proceedButtons = [
    ...document.querySelectorAll<HTMLButtonElement>("[data-proceed-act]"),
  ];
  const genusButtons = [
    ...document.querySelectorAll<HTMLButtonElement>("button[data-genus]"),
  ];
  const viewButtons = [exploreView, resetView, focusBeacon, focusRouteStart];
  const reducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  const repository = new WorldDataRepository();
  const webglCapable = supportsWebGL();

  let journey = createInitialJourneyState();
  let worldScene: WorldScene | undefined;
  let activeBundle: WorldBundle | undefined;
  let activeGenus: SupportedGenus = 2;
  let defaultGenus: SupportedGenus = 2;
  let presetById = new Map<RoutePresetId, RoutePreset>();
  let routeButtons: HTMLButtonElement[] = [];
  let loadingGenus = false;
  let storyTraveling = false;
  let openingTransitionTimer = 0;
  let journeyFocusTimer = 0;
  const fallbackHeatTimers = new Set<number>();

  const chapterAct = (chapter: HTMLElement): JourneyAct =>
    Number(chapter.dataset.act ?? 0) as JourneyAct;

  const chapterForAct = (act: JourneyAct): HTMLElement | undefined =>
    chapters.find((chapter) => chapterAct(chapter) === act);

  const activePreset = (): RoutePreset | undefined =>
    journey.routeSelected ? presetById.get(journey.routeSelected) : undefined;

  const announce = (message: string): void => {
    announcer.textContent = "";
    requestAnimationFrame(() => {
      announcer.textContent = message;
    });
  };

  const updateStageHeight = (): void => {
    if (!journey.started || window.innerWidth > 820) {
      document.documentElement.style.setProperty(
        "--mobile-stage-height",
        "0px",
      );
      return;
    }
    document.documentElement.style.setProperty(
      "--mobile-stage-height",
      `${Math.ceil(stage.getBoundingClientRect().height)}px`,
    );
  };

  const setViewAvailability = (available: boolean): void => {
    viewButtons.forEach((button) => {
      button.disabled = !available;
      if (!available) {
        button.setAttribute(
          "aria-label",
          `${button.textContent?.trim() ?? "View control"}, unavailable without WebGL`,
        );
      } else {
        button.removeAttribute("aria-label");
      }
    });
  };

  const showFallback = (message: string): void => {
    worldScene?.destroy();
    worldScene = undefined;
    canvas.hidden = true;
    fallback.hidden = false;
    loading.hidden = true;
    fallbackCopy.textContent = message;
    document.body.dataset.webgl = "fallback";
    setViewAvailability(false);
  };

  const showCanvas = (): void => {
    canvas.hidden = false;
    fallback.hidden = true;
    document.body.dataset.webgl = "active";
    setViewAvailability(true);
  };

  const clearFallbackHeat = (): void => {
    fallbackHeatTimers.forEach((timer) => window.clearTimeout(timer));
    fallbackHeatTimers.clear();
  };

  const updateRouteCopy = (preset: RoutePreset | undefined): void => {
    const selected = preset !== undefined;
    routeDetails.hidden = !selected;
    routePrompt.hidden = selected;
    routeChoice.dataset.activeRouteId = preset?.id ?? "";
    routeDetails.dataset.activeRouteId = preset?.id ?? "";
    if (!preset) return;
    activeName.textContent = preset.label;
    activeDescription.textContent = preset.description;
    ambientLength.textContent = formatLength(preset.ambientChordLength);
    dijkstraLength.textContent = formatLength(preset.edgeDijkstraRouteLength);
    heatLength.textContent = formatLength(preset.tracedHeatMethodRouteLength);
  };

  const updateRouteButtons = (): void => {
    routeButtons.forEach((button) => {
      const routeId = button.dataset.routeId ?? "";
      const selected = journey.routeSelected === routeId;
      button.setAttribute("aria-pressed", String(selected));
      button.classList.toggle("is-active", selected);
      button.classList.toggle("is-committed", selected && journey.routeLocked);
      button.disabled = journey.routeLocked;
      if (selected) button.setAttribute("aria-current", "step");
      else button.removeAttribute("aria-current");
      const preset = presetById.get(routeId);
      if (preset) {
        button.setAttribute(
          "aria-label",
          journey.routeLocked && selected
            ? `${preset.label}, committed route`
            : `${preset.label}. ${preset.description}`,
        );
      }
    });
  };

  const updateHeatInterface = (): void => {
    releaseButton.setAttribute(
      "aria-pressed",
      String(journey.heatAnimating || journey.heatReleased),
    );
    releaseButton.disabled = journey.heatAnimating || journey.heatReleased;
    if (journey.heatReleased) {
      releaseButton.textContent = "Heat released";
      heatStatus.textContent =
        "All six exported heat states are complete. The final state remains visible.";
    } else if (journey.heatAnimating) {
      releaseButton.textContent = "Heat spreading";
    } else {
      releaseButton.textContent = "Release heat";
      heatStatus.textContent = "Six exported diffusion states are ready.";
    }
  };

  const syncFallback = (): void => {
    if (worldScene) return;
    fallback.dataset.act = String(journey.activeAct);
    fallback.dataset.routeSelected = String(journey.routeSelected !== null);
    fallback.dataset.routeLocked = String(journey.routeLocked);
    fallback.dataset.heatReleased = String(journey.heatReleased);
    fallback.dataset.comparison = String(journey.compareMode);
    caption.textContent = fallbackCaption(activeGenus, journey, activePreset());
  };

  const syncScene = (): void => {
    if (!worldScene) {
      syncFallback();
      return;
    }
    worldScene.setAct(journey.activeAct);
    if (journey.routeSelected) {
      if (canvas.dataset.activeRoute !== journey.routeSelected) {
        worldScene.selectRoute(journey.routeSelected, false);
      }
    } else if (canvas.dataset.routeSelected === "true") {
      worldScene.clearRouteSelection();
    }
    worldScene.setRouteLocked(journey.routeLocked);
    if (journey.heatReleased && canvas.dataset.heatMode !== "released") {
      worldScene.restoreHeatCompletion();
    } else if (
      !journey.heatReleased &&
      !journey.heatAnimating &&
      canvas.dataset.heatMode !== "idle"
    ) {
      worldScene.setHeatEnabled(false);
    }
    if (journey.compareMode) worldScene.showRouteComparison(false);
    else worldScene.hideRouteComparison();
    caption.textContent = worldScene.caption;
  };

  const renderJourney = (): void => {
    document.body.dataset.started = String(journey.started);
    document.body.dataset.activeAct = String(journey.activeAct);
    document.body.dataset.maxUnlockedAct = String(journey.maxUnlockedAct);
    document.body.dataset.routeSelected = String(
      journey.routeSelected !== null,
    );
    document.body.dataset.routeLocked = String(journey.routeLocked);
    document.body.dataset.heatReleased = String(journey.heatReleased);
    document.body.dataset.comparison = String(journey.compareMode);
    journeyShell.hidden = !journey.started;
    if (!journey.started) {
      openingScreen.hidden = false;
      openingScreen.removeAttribute("aria-hidden");
    }

    chapters.forEach((chapter) => {
      const act = chapterAct(chapter);
      const unlocked = isActUnlocked(journey, act);
      chapter.hidden = !unlocked;
      chapter.inert = !unlocked;
      chapter.dataset.unlocked = String(unlocked);
      chapter.classList.toggle(
        "is-active",
        unlocked && act === journey.activeAct,
      );
      if (unlocked) chapter.removeAttribute("aria-hidden");
      else chapter.setAttribute("aria-hidden", "true");
    });

    proceedButtons.forEach((button) => {
      const act = Number(button.dataset.proceedAct ?? 0) as JourneyAct;
      button.disabled = !canProceed(journey, act);
    });

    compareRoutes.hidden = !isCompareEligible(journey);
    compareRoutes.setAttribute("aria-pressed", String(journey.compareMode));
    comparisonPanel.hidden = !journey.compareMode;
    siteFooter.hidden = !journey.technicalUnlocked;
    skipLink.href = `#${chapterForAct(journey.activeAct)?.id ?? "arrival"}`;
    updateRouteCopy(activePreset());
    updateRouteButtons();
    updateHeatInterface();
    syncScene();
    requestAnimationFrame(updateStageHeight);
  };

  const dispatch = (action: JourneyAction): boolean => {
    const next = reduceJourney(journey, action);
    if (next === journey) return false;
    journey = next;
    renderJourney();
    return true;
  };

  const prepareAct = (act: JourneyAct): void => {
    if (!mathematicsRendered) {
      void renderMathematics().catch(() => {
        // Raw expressions remain readable if KaTeX cannot initialize.
      });
    }
    if (act >= 8 && !benchmarkRendered) {
      benchmarkRendered = true;
      void renderBenchmarkChart(chart, chartCaption).catch(() => {
        benchmarkRendered = false;
        chartCaption.textContent =
          "Measured CPU benchmark data could not be loaded in this browser.";
      });
    }
  };

  const moveToChapter = (chapter: HTMLElement, focusHeading = true): void => {
    window.clearTimeout(journeyFocusTimer);
    storyTraveling = true;
    updateStageHeight();
    const beginsAtTop =
      window.innerWidth <= 820 ||
      chapter.getBoundingClientRect().height > window.innerHeight * 0.96;
    chapter.scrollIntoView({
      behavior: reducedMotion ? "auto" : "smooth",
      block: beginsAtTop ? "start" : "center",
    });
    const finish = (): void => {
      if (focusHeading) {
        chapter
          .querySelector<HTMLElement>("h1, h2")
          ?.focus({ preventScroll: true });
      }
      storyTraveling = false;
    };
    journeyFocusTimer = window.setTimeout(finish, reducedMotion ? 0 : 520);
  };

  const revealNextChapter = (act: JourneyAct): void => {
    const previousMax = journey.maxUnlockedAct;
    if (!dispatch({ type: "PROCEED", act })) return;
    const destination = journey.activeAct;
    prepareAct(destination);
    const chapter = chapterForAct(destination);
    if (!chapter) return;
    if (journey.maxUnlockedAct > previousMax) {
      const title = chapter.querySelector("h1, h2")?.textContent?.trim();
      if (title) announce(`Chapter unlocked: ${title}`);
    }
    moveToChapter(chapter);
  };

  const rebuildRouteButtons = (presets: readonly RoutePreset[]): void => {
    routeButtonsContainer.replaceChildren();
    comparisonLegend.replaceChildren();
    routeButtons = presets.map((preset) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "route-button";
      button.dataset.routeId = preset.id;
      button.setAttribute("aria-pressed", "false");
      const label = document.createElement("span");
      label.textContent = preset.label;
      const description = document.createElement("small");
      description.textContent = preset.description;
      button.append(label, description);
      button.addEventListener("click", () => {
        if (journey.routeLocked) return;
        dispatch({ type: "SELECT_ROUTE", routeId: preset.id });
        caption.textContent =
          worldScene?.caption ?? fallbackCaption(activeGenus, journey, preset);
      });
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
      residualValues[0].textContent =
        `Genus ${bundle.metadata.topology.genus}, ` +
        `${bundle.metadata.vertices.toLocaleString()} vertices / ` +
        `${bundle.metadata.faces.toLocaleString()} faces`;
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
    worldScene = undefined;
    if (!webglCapable) {
      showFallback(
        "WebGL is unavailable. The exported measurements, guided story, and mathematics remain fully accessible.",
      );
      return;
    }
    try {
      worldScene = new WorldScene(canvas, bundle.data, bundle.metadata, {
        reducedMotion,
        onExploreChange: (engaged) => {
          exploreView.setAttribute("aria-pressed", String(engaged));
          exploreView.textContent = engaged
            ? "Exit Explore view"
            : "Explore view";
        },
        onCaptionChange: (nextCaption) => {
          caption.textContent = nextCaption;
        },
        onHeatStateChange: (state) => {
          if (state === "released") {
            dispatch({ type: "COMPLETE_HEAT" });
          }
        },
        onHeatFrameChange: (frame, frameCount) => {
          if (!journey.heatReleased) {
            heatStatus.textContent = `Heat state ${frame} of ${frameCount}: warmth is spreading over the surface.`;
          }
        },
      });
      showCanvas();
      canvas.setAttribute(
        "aria-label",
        `${bundle.metadata.accessibleLabel} with an amber heat source and exported route starts`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      showFallback(
        `The WebGL view could not start (${message}). The exported measurements, guided story, and mathematics remain available.`,
      );
    }
  };

  const applyBundle = (bundle: WorldBundle): void => {
    activeBundle = bundle;
    activeGenus = bundle.metadata.topology.genus;
    presetById = new Map(
      bundle.metadata.routePresets.map((preset) => [preset.id, preset]),
    );
    journey = reduceJourney(journey, {
      type: "WORLD_CHANGED",
      routeIds: bundle.metadata.routePresets.map((preset) => preset.id),
    });
    rebuildRouteButtons(bundle.metadata.routePresets);
    fillComparisonTable(comparisonBody, bundle.metadata.routePresets);
    updateExportedMeasurements(bundle);
    document.body.dataset.genus = String(activeGenus);
    createScene(bundle);
    renderJourney();
  };

  const switchWorld = async (
    genus: SupportedGenus,
    initial = false,
  ): Promise<boolean> => {
    if (loadingGenus || (!initial && genus === activeGenus && activeBundle)) {
      return false;
    }
    loadingGenus = true;
    clearFallbackHeat();
    const preservedScroll = window.scrollY;
    const wasCached = repository.isCached(genus);
    setGenusControls(genus, true);
    loading.hidden = false;
    loading.dataset.genus = String(genus);
    loadingCopy.textContent = wasCached
      ? `Restoring cached Genus ${genus} world`
      : `Loading Genus ${genus} world`;
    try {
      const bundle = await repository.loadWorld(genus);
      applyBundle(bundle);
      canvas.dataset.loadSource = wasCached ? "cache" : "network";
      loading.hidden = true;
      setGenusControls(genus, false);
      window.scrollTo({ top: preservedScroll, behavior: "auto" });
      syncScene();
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      if (initial || !activeBundle) {
        showFallback(
          `The exported world data could not load (${message}). The written explanation and mathematics remain available.`,
        );
      } else {
        loadingCopy.textContent = `Genus ${genus} could not load: ${message}`;
        window.setTimeout(() => {
          loading.hidden = true;
        }, 2600);
      }
      setGenusControls(activeGenus, false);
      window.scrollTo({ top: preservedScroll, behavior: "auto" });
      return false;
    } finally {
      loadingGenus = false;
    }
  };

  const markPreparing = (message: string): void => {
    startButton.disabled = true;
    startButton.setAttribute("aria-describedby", "startup-status");
    startupStatus.hidden = false;
    startupStatus.textContent = message;
  };

  const markReady = (): void => {
    startButton.disabled = false;
    startButton.removeAttribute("aria-describedby");
    startupStatus.hidden = true;
    startButton.focus({ preventScroll: true });
  };

  const beginJourney = (): void => {
    if (startButton.disabled || journey.started) return;
    clearHash();
    window.scrollTo({ top: 0, behavior: "auto" });
    dispatch({ type: "START" });
    prepareAct(0);
    openingScreen.setAttribute("aria-hidden", "true");
    worldScene?.resetJourney();
    syncScene();
    const first = chapterForAct(0);
    if (first) {
      first.querySelector<HTMLElement>("h1")?.focus({ preventScroll: true });
    }
    window.clearTimeout(openingTransitionTimer);
    openingTransitionTimer = window.setTimeout(
      () => {
        openingScreen.hidden = true;
      },
      reducedMotion ? 0 : 170,
    );
  };

  const completeFallbackHeat = (): void => {
    clearFallbackHeat();
    const frameDelay = reducedMotion ? 28 : 620;
    for (let frame = 1; frame <= 6; frame += 1) {
      const timer = window.setTimeout(
        () => {
          fallbackHeatTimers.delete(timer);
          fallback.dataset.heatFrame = String(frame);
          heatStatus.textContent = `Heat state ${frame} of 6: exported warmth is spreading across the fallback view.`;
          if (frame === 6) dispatch({ type: "COMPLETE_HEAT" });
        },
        frameDelay * (frame - 1),
      );
      fallbackHeatTimers.add(timer);
    }
  };

  const replay = (): void => {
    clearFallbackHeat();
    window.clearTimeout(openingTransitionTimer);
    window.clearTimeout(journeyFocusTimer);
    storyTraveling = false;
    worldScene?.resetJourney();
    journey = reduceJourney(journey, { type: "REPLAY" });
    clearHash();
    window.scrollTo({ top: 0, behavior: "auto" });
    renderJourney();
    caption.textContent = fallbackCaption(activeGenus, journey, undefined);
    if (activeGenus !== defaultGenus) {
      markPreparing("Restoring the default curved world");
      void switchWorld(defaultGenus).finally(markReady);
    } else {
      markReady();
    }
  };

  const activateVisibleChapter = (chapter: HTMLElement): void => {
    const act = chapterAct(chapter);
    if (!isActUnlocked(journey, act) || act === journey.activeAct) return;
    dispatch({ type: "SET_ACTIVE_ACT", act });
    prepareAct(act);
  };

  const updateStory = (): void => {
    if (!journey.started || storyTraveling) return;
    const unlocked = chapters.filter(
      (chapter) =>
        !chapter.hidden && isActUnlocked(journey, chapterAct(chapter)),
    );
    if (unlocked.length === 0) return;
    const mobile = window.innerWidth <= 820;
    const stageHeight = mobile ? stage.getBoundingClientRect().height : 0;
    const targetY = mobile
      ? Math.min(
          window.innerHeight - 24,
          stageHeight + (window.innerHeight - stageHeight) * 0.42,
        )
      : window.innerHeight * 0.5;
    let nearest = unlocked[0]!;
    let nearestDistance = Number.POSITIVE_INFINITY;
    unlocked.forEach((chapter) => {
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
    activateVisibleChapter(nearest);
  };

  let storyTicking = false;
  const requestStoryUpdate = (): void => {
    if (storyTicking) return;
    storyTicking = true;
    requestAnimationFrame(() => {
      storyTicking = false;
      updateStory();
    });
  };

  startButton.addEventListener("click", beginJourney);
  proceedButtons.forEach((button) => {
    button.addEventListener("click", () => {
      revealNextChapter(Number(button.dataset.proceedAct ?? 0) as JourneyAct);
    });
  });

  genusButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const genus = Number(button.dataset.genus);
      if (genus === 1 || genus === 2 || genus === 3) {
        void switchWorld(genus);
      }
    });
  });

  exploreView.addEventListener("click", () => worldScene?.toggleExplore());
  resetView.addEventListener("click", () => worldScene?.resetView());
  focusBeacon.addEventListener("click", () => worldScene?.focusBeacon());
  focusRouteStart.addEventListener("click", () =>
    worldScene?.focusRouteStart(),
  );

  releaseButton.addEventListener("click", () => {
    if (!dispatch({ type: "RELEASE_HEAT" })) return;
    if (worldScene) worldScene.releaseHeat();
    else completeFallbackHeat();
  });

  compareRoutes.addEventListener("click", () => {
    if (!dispatch({ type: "TOGGLE_COMPARE" })) return;
    announce(
      journey.compareMode
        ? "Comparison mode on. All three Heat Method traces and the comparison table are visible."
        : "Comparison mode off. The committed route is visible.",
    );
    if (journey.compareMode && journey.activeAct === 7) {
      comparisonPanel.focus({ preventScroll: true });
    }
  });

  replayJourney.addEventListener("click", replay);

  const navigateWithoutHash = (event: Event, act: JourneyAct): void => {
    event.preventDefault();
    if (!isActUnlocked(journey, act)) return;
    dispatch({ type: "SET_ACTIVE_ACT", act });
    const chapter = chapterForAct(act);
    if (chapter) moveToChapter(chapter);
    clearHash();
  };
  skipLink.addEventListener("click", (event) =>
    navigateWithoutHash(event, journey.activeAct),
  );
  backToWorld.addEventListener("click", (event) =>
    navigateWithoutHash(event, 0),
  );

  const blockOpeningNavigation = (event: Event): void => {
    if (!journey.started) {
      event.preventDefault();
      window.scrollTo(0, 0);
    }
  };
  window.addEventListener("wheel", blockOpeningNavigation, {
    passive: false,
    capture: true,
  });
  window.addEventListener("touchmove", blockOpeningNavigation, {
    passive: false,
    capture: true,
  });
  document.addEventListener("keydown", (event) => {
    if (!journey.started && (event.key === "End" || event.key === "PageDown")) {
      event.preventDefault();
      window.scrollTo(0, 0);
    }
  });

  window.addEventListener("hashchange", () => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    const target = id ? document.getElementById(id) : null;
    const targetAct = target?.dataset.act;
    if (!journey.started || !target || targetAct === undefined) {
      clearHash();
      window.scrollTo({ top: journey.started ? window.scrollY : 0 });
      return;
    }
    const act = Number(targetAct) as JourneyAct;
    if (!isActUnlocked(journey, act)) {
      clearHash();
      const current = chapterForAct(journey.activeAct);
      if (current) moveToChapter(current, false);
      return;
    }
    dispatch({ type: "SET_ACTIVE_ACT", act });
    moveToChapter(target, false);
  });

  window.addEventListener("scroll", requestStoryUpdate, { passive: true });
  window.addEventListener("resize", () => {
    updateStageHeight();
    requestStoryUpdate();
  });
  new ResizeObserver(updateStageHeight).observe(stage);

  renderJourney();
  markPreparing("Preparing the curved world");
  try {
    const manifest = await repository.loadManifest();
    defaultGenus = manifest.defaultGenus;
    activeGenus = manifest.defaultGenus;
    await switchWorld(manifest.defaultGenus, true);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    showFallback(
      `The exported world data could not load (${message}). The written explanation and mathematics remain available.`,
    );
  }
  markReady();

  window.addEventListener(
    "beforeunload",
    () => {
      clearFallbackHeat();
      worldScene?.destroy();
    },
    { once: true },
  );
}

void start();
