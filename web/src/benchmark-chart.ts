interface BenchmarkCase {
  majorSegments: number;
  minorSegments: number;
  vertices: number;
  faces: number;
  meshMilliseconds: number;
  operatorAssemblyMilliseconds: number;
  factorizationMilliseconds: number;
  preprocessingMilliseconds: number;
  oneHeatQueryMilliseconds: number;
  meanReusedHeatQueryMilliseconds: number;
  dijkstraQueryMilliseconds: number;
  heatResidual: number;
  poissonResidual: number;
}

interface BenchmarkData {
  schema: string;
  clock: string;
  precision: string;
  warmupQueries: number;
  reusedSourceCount: number;
  dijkstraRepetitions: number;
  cases: BenchmarkCase[];
}

const SVG_NS = "http://www.w3.org/2000/svg";

function formatCount(value: number): string {
  if (value >= 1000)
    return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  return String(value);
}

function svgElement<K extends keyof SVGElementTagNameMap>(
  name: K,
  attributes: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes))
    element.setAttribute(key, String(value));
  return element;
}

function linePath(
  cases: BenchmarkCase[],
  x: (index: number) => number,
  y: (value: number) => number,
  value: (entry: BenchmarkCase) => number,
): string {
  return cases
    .map(
      (entry, index) =>
        `${index === 0 ? "M" : "L"}${x(index).toFixed(2)},${y(value(entry)).toFixed(2)}`,
    )
    .join(" ");
}

export async function renderBenchmarkChart(
  container: HTMLElement,
  caption: HTMLElement,
): Promise<void> {
  const response = await fetch(
    `${import.meta.env.BASE_URL}data/benchmarks.cpu.json`,
  );
  if (!response.ok)
    throw new Error(`Benchmark request failed (${response.status})`);
  const data = (await response.json()) as BenchmarkData;
  if (data.schema !== "geodesic-benchmark-v2" || data.cases.length < 2) {
    throw new Error("Benchmark schema is invalid");
  }

  const width = 600;
  const height = 278;
  const margin = { top: 28, right: 20, bottom: 48, left: 48 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const x = (index: number): number =>
    margin.left + (index / (data.cases.length - 1)) * plotWidth;
  const minimumLog = -2.2;
  const maximumLog = 3;
  const y = (milliseconds: number): number => {
    const log = Math.log10(Math.max(milliseconds, 10 ** minimumLog));
    return (
      margin.top + ((maximumLog - log) / (maximumLog - minimumLog)) * plotHeight
    );
  };

  const svg = svgElement("svg", {
    viewBox: `0 0 ${width} ${height}`,
    role: "presentation",
    "aria-hidden": "true",
  });
  const ticks = [0.01, 0.1, 1, 10, 100, 1000];
  for (const tick of ticks) {
    const yPosition = y(tick);
    svg.append(
      svgElement("line", {
        x1: margin.left,
        x2: width - margin.right,
        y1: yPosition,
        y2: yPosition,
        class: "chart-grid",
      }),
    );
    const label = svgElement("text", {
      x: margin.left - 8,
      y: yPosition + 3,
      "text-anchor": "end",
      class: "chart-axis-label",
    });
    label.textContent = tick < 1 ? `${tick} ms` : `${tick} ms`;
    svg.append(label);
  }

  data.cases.forEach((entry, index) => {
    const xPosition = x(index);
    const label = svgElement("text", {
      x: xPosition,
      y: height - 22,
      "text-anchor": "middle",
      class: "chart-axis-label",
    });
    label.textContent = `${formatCount(entry.faces)} faces`;
    svg.append(label);
  });

  const series = [
    {
      key: (entry: BenchmarkCase) => entry.preprocessingMilliseconds,
      className: "chart-line-preprocess",
      color: "#4d837b",
    },
    {
      key: (entry: BenchmarkCase) => entry.meanReusedHeatQueryMilliseconds,
      className: "chart-line-query",
      color: "#f4b65e",
    },
    {
      key: (entry: BenchmarkCase) => entry.dijkstraQueryMilliseconds,
      className: "chart-line-dijkstra",
      color: "#d7a8ff",
    },
  ];
  for (const item of series) {
    svg.append(
      svgElement("path", {
        d: linePath(data.cases, x, y, item.key),
        class: item.className,
      }),
    );
    data.cases.forEach((entry, index) => {
      svg.append(
        svgElement("circle", {
          cx: x(index),
          cy: y(item.key(entry)),
          r: 4,
          fill: item.color,
          class: "chart-point",
        }),
      );
    });
  }
  container.replaceChildren(svg);

  const largest = data.cases.at(-1)!;
  caption.textContent =
    `Measured locally in double precision: ${largest.faces.toLocaleString()} faces, ` +
    `${largest.preprocessingMilliseconds.toFixed(1)} ms preprocessing, ` +
    `${largest.meanReusedHeatQueryMilliseconds.toFixed(2)} ms mean reused Heat Method query, and ` +
    `${largest.dijkstraQueryMilliseconds.toFixed(2)} ms edge-Dijkstra query ` +
    `(${data.reusedSourceCount} Heat Method sources and ${data.dijkstraRepetitions} Dijkstra runs after ${data.warmupQueries} warm-up). ` +
    "Dijkstra is faster at the largest measured CPU case here; it computes a mesh-edge graph distance, while the Heat Method reconstructs a surface field.";
}
