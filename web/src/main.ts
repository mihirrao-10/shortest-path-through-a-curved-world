import { renderBenchmarkChart } from "./benchmark-chart";
import "./style.css";
import { loadWorldData } from "./world-data";
import { WorldScene } from "./world-scene";

const chapterNames = [
  "01 / Arrival",
  "02 / The straight line",
  "03 / Triangles",
  "04 / Heat",
  "05 / Direction",
  "06 / Mathematics",
  "07 / Scale",
  "08 / The answer",
];

let mathematicsRendered = false;

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

async function start(): Promise<void> {
  const mathematics = document.querySelector<HTMLElement>("#mathematics")!;
  runNearViewport(mathematics, () => {
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
  const releaseButton =
    document.querySelector<HTMLButtonElement>("#release-button")!;
  const heatStatus = document.querySelector<HTMLElement>("#heat-status")!;
  const replayButton =
    document.querySelector<HTMLButtonElement>("#replay-button")!;
  const chapterIndicator =
    document.querySelector<HTMLElement>("#chapter-indicator")!;
  const progressFill = document.querySelector<HTMLElement>("#progress-fill")!;
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
  try {
    const { data, metadata } = await loadWorldData();
    worldScene = new WorldScene(canvas, data, {
      reducedMotion,
      onExplorerPlaced: () => {
        caption.textContent =
          "Explorer placed. Scroll to test the straight-line answer.";
      },
    });
    const residualList = document.querySelector<HTMLElement>("#residual-list");
    if (residualList) {
      const values = residualList.querySelectorAll("dd");
      if (values[0])
        values[0].textContent = `${metadata.vertices.toLocaleString()} vertices / ${metadata.faces.toLocaleString()} faces`;
      if (values[1])
        values[1].textContent = metadata.heatResidual.toExponential(2);
      if (values[2])
        values[2].textContent = metadata.poissonResidual.toExponential(2);
    }
    loading.hidden = true;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "unknown loading error";
    showFallback(
      `The interactive world could not start (${message}). The full story and mathematics remain available below.`,
    );
    return;
  }

  let activeAct = -1;
  let ticking = false;
  const updateStory = (): void => {
    ticking = false;
    const targetY =
      window.innerHeight * (window.innerWidth <= 820 ? 0.72 : 0.52);
    let active = chapters[0]!;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const chapter of chapters) {
      const rect = chapter.getBoundingClientRect();
      const distance =
        rect.top <= targetY && rect.bottom >= targetY
          ? 0
          : Math.min(
              Math.abs(rect.top - targetY),
              Math.abs(rect.bottom - targetY),
            );
      if (distance < bestDistance) {
        bestDistance = distance;
        active = chapter;
      }
    }
    const nextAct = Number(active.dataset.act ?? 0);
    if (nextAct !== activeAct) {
      activeAct = nextAct;
      chapters.forEach((chapter) =>
        chapter.classList.toggle("is-active", chapter === active),
      );
      progressItems.forEach((item, index) =>
        item.classList.toggle("is-active", index === Math.min(nextAct, 6)),
      );
      chapterIndicator.textContent = chapterNames[nextAct] ?? chapterNames[0]!;
      worldScene.setAct(nextAct);
      caption.textContent = worldScene.caption;
    }
    const scrollable =
      document.documentElement.scrollHeight - window.innerHeight;
    const progress = scrollable > 0 ? window.scrollY / scrollable : 0;
    progressFill.style.height = `${Math.min(1, Math.max(0, progress)) * 100}%`;
  };
  const requestStoryUpdate = (): void => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(updateStory);
    }
  };
  window.addEventListener("scroll", requestStoryUpdate, { passive: true });
  window.addEventListener("resize", requestStoryUpdate, { passive: true });
  updateStory();

  releaseButton.addEventListener("click", () => {
    worldScene.releaseHeat();
    releaseButton.disabled = true;
    releaseButton.textContent = "Heat released";
    heatStatus.textContent =
      "Heat is moving through the exported triangle-mesh solutions.";
    window.setTimeout(
      () => {
        heatStatus.textContent =
          "Diffusion complete. Scroll to read its direction.";
      },
      reducedMotion ? 0 : 5300,
    );
  });

  replayButton.addEventListener("click", () => {
    worldScene.replay();
    releaseButton.disabled = false;
    releaseButton.innerHTML =
      '<span class="release-icon" aria-hidden="true"></span>Release Heat';
    heatStatus.textContent = "Six diffusion states, solved by the C++ engine.";
    document
      .querySelector("#arrival")
      ?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth" });
  });

  window.addEventListener("beforeunload", () => worldScene.destroy(), {
    once: true,
  });
}

void start();
