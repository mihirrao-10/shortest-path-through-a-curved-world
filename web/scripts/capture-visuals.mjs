import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";

const baseUrl =
  process.env.VISUAL_PREVIEW_URL ??
  "http://127.0.0.1:4173/shortest-path-through-a-curved-world/";
const browser = await chromium.launch({ headless: true });

async function readyPage(viewport) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    colorScheme: "dark",
  });
  const page = await context.newPage();
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.locator("#start-button").waitFor({ state: "visible" });
  await page.waitForFunction(
    () => !document.querySelector("#start-button")?.hasAttribute("disabled"),
  );
  return { context, page };
}

async function settle(page, milliseconds = 600) {
  await page.waitForTimeout(milliseconds);
}

async function capture(page, path, milliseconds = 600) {
  await settle(page, milliseconds);
  await page.screenshot();
  await settle(page, 100);
  await page.screenshot({ path });
}

async function begin(page) {
  await page.locator("#start-button").click();
  await page.locator("#opening-screen").waitFor({ state: "hidden" });
  await page.locator("#world-canvas").waitFor({ state: "visible" });
}

async function proceed(page, act) {
  const button = page.locator(`[data-proceed-act="${act}"]`);
  await button.waitFor({ state: "visible" });
  await button.click();
  await page.waitForFunction(
    (expected) => document.body.dataset.activeAct === String(expected),
    act + 1,
  );
  await settle(page, 560);
}

async function selectGenus(page, genus) {
  await page.locator(`button[data-genus="${genus}"]`).click();
  await page.waitForFunction(
    (expected) =>
      document.querySelector("#world-canvas")?.dataset.topology ===
      `genus-${expected}`,
    genus,
  );
  await page.locator("#loading").waitFor({ state: "hidden" });
}

await mkdir("../docs/screenshots", { recursive: true });
await mkdir("public", { recursive: true });

const openingDesktop = await readyPage({ width: 1440, height: 900 });
await capture(
  openingDesktop.page,
  "../docs/screenshots/opening-desktop.png",
  100,
);
await openingDesktop.context.close();

const desktop = await readyPage({ width: 1440, height: 900 });
await begin(desktop.page);
await capture(desktop.page, "../docs/screenshots/journey-start-desktop.png");

await proceed(desktop.page, 0);
await capture(desktop.page, "../docs/screenshots/straight-line-desktop.png");
await proceed(desktop.page, 1);
await proceed(desktop.page, 2);
await desktop.page.locator('button[data-route-id="outer-ridge"]').click();
await capture(desktop.page, "../docs/screenshots/route-choice-desktop.png");

await proceed(desktop.page, 3);
await desktop.page.locator("#release-button").click();
await desktop.page.waitForFunction(
  () =>
    document.querySelector("#world-canvas")?.dataset.heatMode === "released",
  undefined,
  { timeout: 7_000 },
);
await capture(desktop.page, "../docs/screenshots/heat-desktop.png", 120);

await proceed(desktop.page, 4);
await capture(desktop.page, "../docs/screenshots/direction-desktop.png", 850);
await proceed(desktop.page, 5);
await capture(desktop.page, "../docs/screenshots/mathematics-desktop.png", 850);
await proceed(desktop.page, 6);
await desktop.page.locator("#compare-routes").click();
await desktop.page.waitForFunction(
  () => document.querySelector("#world-canvas")?.dataset.comparison === "true",
);
await capture(desktop.page, "../docs/screenshots/comparison-desktop.png");

await proceed(desktop.page, 7);
await proceed(desktop.page, 8);
await proceed(desktop.page, 9);
await capture(
  desktop.page,
  "../docs/screenshots/under-the-hood-desktop.png",
  850,
);

const desktopMetrics = await desktop.page.evaluate(() => ({
  viewport: [window.innerWidth, window.innerHeight],
  scrollWidth: document.documentElement.scrollWidth,
  bodyWidth: document.body.getBoundingClientRect().width,
  maxUnlockedAct: document.body.dataset.maxUnlockedAct,
  activeAct: document.body.dataset.activeAct,
}));
console.log("desktop", JSON.stringify(desktopMetrics));
await desktop.context.close();

for (const genus of [1, 3]) {
  const genusPage = await readyPage({ width: 1440, height: 900 });
  await begin(genusPage.page);
  await selectGenus(genusPage.page, genus);
  await capture(
    genusPage.page,
    `../docs/screenshots/genus-${genus}-desktop.png`,
  );
  await genusPage.context.close();
}

const tablet = await readyPage({ width: 768, height: 1024 });
await begin(tablet.page);
await capture(tablet.page, "../docs/screenshots/journey-start-tablet.png");
await tablet.context.close();

const preview = await readyPage({ width: 1200, height: 675 });
await begin(preview.page);
await capture(preview.page, "public/project-preview.png");
await preview.context.close();

const openingMobile = await readyPage({ width: 390, height: 844 });
await capture(
  openingMobile.page,
  "../docs/screenshots/opening-mobile.png",
  100,
);
await openingMobile.context.close();

const mobile = await readyPage({ width: 390, height: 844 });
await begin(mobile.page);
await capture(mobile.page, "../docs/screenshots/journey-start-mobile.png");
await proceed(mobile.page, 0);
await proceed(mobile.page, 1);
await proceed(mobile.page, 2);
await mobile.page.locator('button[data-route-id="basin-rim"]').click();
await capture(mobile.page, "../docs/screenshots/route-choice-mobile.png");
await proceed(mobile.page, 3);
await mobile.page.locator("#release-button").click();
await mobile.page.waitForFunction(
  () => document.body.dataset.heatReleased === "true",
  undefined,
  { timeout: 7_000 },
);
await proceed(mobile.page, 4);
await proceed(mobile.page, 5);
await capture(mobile.page, "../docs/screenshots/math-mobile.png", 850);

const mobileMetrics = await mobile.page.evaluate(() => ({
  viewport: [window.innerWidth, window.innerHeight],
  scrollWidth: document.documentElement.scrollWidth,
  bodyWidth: document.body.getBoundingClientRect().width,
  stage: document
    .querySelector("#world-stage")
    ?.getBoundingClientRect()
    .toJSON(),
  math: document
    .querySelector("#mathematics .chapter-copy")
    ?.getBoundingClientRect()
    .toJSON(),
}));
console.log("mobile", JSON.stringify(mobileMetrics));
await mobile.context.close();

const genusThreeMobile = await readyPage({ width: 390, height: 844 });
await begin(genusThreeMobile.page);
await selectGenus(genusThreeMobile.page, 3);
await capture(genusThreeMobile.page, "../docs/screenshots/genus-3-mobile.png");
await genusThreeMobile.context.close();

await browser.close();
