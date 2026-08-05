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
  await page.locator("#loading").waitFor({ state: "hidden" });
  return { context, page };
}

async function settle(page, milliseconds = 700) {
  await page.waitForTimeout(milliseconds);
}

async function capture(page, path, milliseconds = 700) {
  await settle(page, milliseconds);
  await page.evaluate(async () => {
    const originalY = window.scrollY;
    window.scrollTo(0, originalY + 1);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    window.scrollTo(0, originalY);
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
  // Prime Chromium's compositor before writing the retained frame. Without a
  // warm-up capture, an occasional first screenshot can omit the text column
  // next to a WebGL canvas even though the page is fully painted on screen.
  await page.screenshot();
  await settle(page, 120);
  await page.screenshot({ path });
}

async function selectGenus(page, genus) {
  await page.locator(`button[data-genus="${genus}"]`).click();
  await page
    .locator("#world-canvas")
    .waitFor({ state: "visible", timeout: 20_000 });
  await page.locator("#world-canvas").evaluate(
    (canvas, expected) =>
      new Promise((resolve) => {
        const check = () => {
          if (canvas.dataset.topology === `genus-${expected}`) resolve();
          else requestAnimationFrame(check);
        };
        check();
      }),
    genus,
  );
  await page.locator("#loading").waitFor({ state: "hidden", timeout: 20_000 });
}

await mkdir("../docs/screenshots", { recursive: true });
await mkdir("public", { recursive: true });

const openingDesktop = await readyPage({ width: 1440, height: 900 });
await capture(openingDesktop.page, "../docs/screenshots/opening-desktop.png");
await openingDesktop.context.close();

const genusOne = await readyPage({ width: 1440, height: 900 });
await selectGenus(genusOne.page, 1);
await capture(genusOne.page, "../docs/screenshots/genus-1-desktop.png");
await genusOne.page.locator("#world-canvas").screenshot({
  path: "../docs/screenshots/genus-1-desktop.png",
});
await genusOne.context.close();

const genusThree = await readyPage({ width: 1440, height: 900 });
await selectGenus(genusThree.page, 3);
await capture(genusThree.page, "../docs/screenshots/genus-3-desktop.png");
await genusThree.page.locator("#world-canvas").screenshot({
  path: "../docs/screenshots/genus-3-desktop.png",
});
await genusThree.context.close();

const desktop = await readyPage({ width: 1440, height: 900 });
const canvas = desktop.page.locator("#world-canvas");
await desktop.page.locator("#straight-line").scrollIntoViewIfNeeded();
await capture(desktop.page, "../docs/screenshots/straight-line-desktop.png");

await desktop.page.locator("#release-heat").scrollIntoViewIfNeeded();
await desktop.page.locator("#release-button").click();
await canvas.waitFor({ state: "visible" });
await desktop.page.waitForFunction(
  () =>
    document.querySelector("#world-canvas")?.dataset.heatMode === "released",
  undefined,
  { timeout: 7_000 },
);
await capture(desktop.page, "../docs/screenshots/heat-desktop.png", 100);

await desktop.page.locator("#release-button").click();
await desktop.page.locator("#route-choice").scrollIntoViewIfNeeded();
await desktop.page.locator("#compare-routes").click();
await desktop.page.waitForFunction(
  () => document.querySelector("#world-canvas")?.dataset.comparison === "true",
);
await capture(desktop.page, "../docs/screenshots/comparison-desktop.png");

await desktop.page.locator("#direction").scrollIntoViewIfNeeded();
await capture(desktop.page, "../docs/screenshots/direction-desktop.png", 900);

await desktop.page.locator("#mathematics").scrollIntoViewIfNeeded();
await capture(desktop.page, "../docs/screenshots/mathematics-desktop.png", 900);

const desktopMetrics = await desktop.page.evaluate(() => ({
  viewport: [window.innerWidth, window.innerHeight],
  scrollWidth: document.documentElement.scrollWidth,
  bodyWidth: document.body.getBoundingClientRect().width,
  canvas: document
    .querySelector("#world-canvas")
    ?.getBoundingClientRect()
    .toJSON(),
}));
console.log("desktop", JSON.stringify(desktopMetrics));
await desktop.context.close();

const preview = await readyPage({ width: 1200, height: 675 });
await capture(preview.page, "public/project-preview.png");
await preview.context.close();

const mobile = await readyPage({ width: 390, height: 844 });
await capture(mobile.page, "../docs/screenshots/opening-mobile.png");
await mobile.context.close();

const genusThreeMobile = await readyPage({ width: 390, height: 844 });
await selectGenus(genusThreeMobile.page, 3);
await capture(genusThreeMobile.page, "../docs/screenshots/genus-3-mobile.png");
await genusThreeMobile.context.close();

const mathMobile = await readyPage({ width: 390, height: 844 });
await mathMobile.page.locator("#mathematics").scrollIntoViewIfNeeded();
await capture(mathMobile.page, "../docs/screenshots/math-mobile.png", 900);
const mobileMetrics = await mathMobile.page.evaluate(() => ({
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
await mathMobile.context.close();

await browser.close();
