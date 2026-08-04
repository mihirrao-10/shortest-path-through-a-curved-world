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

await mkdir("../docs/screenshots", { recursive: true });
await mkdir("public", { recursive: true });

const desktop = await readyPage({ width: 1440, height: 900 });
await desktop.page.waitForTimeout(700);
await desktop.page.screenshot({
  path: "../docs/screenshots/opening-desktop.png",
});

await desktop.page.locator('button[data-target-preset="tunnel"]').click();
await desktop.page.locator("#ambient-failure").scrollIntoViewIfNeeded();
await desktop.page.waitForTimeout(700);
await desktop.page.screenshot({
  path: "../docs/screenshots/straight-line-desktop.png",
});

await desktop.page.locator("#release-heat").scrollIntoViewIfNeeded();
await desktop.page.locator("#release-button").click();
await desktop.page.waitForTimeout(2700);
await desktop.page.screenshot({ path: "../docs/screenshots/heat-desktop.png" });

await desktop.page.locator("#direction-field").scrollIntoViewIfNeeded();
await desktop.page.waitForTimeout(900);
await desktop.page.screenshot({
  path: "../docs/screenshots/direction-desktop.png",
});

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
await preview.page.waitForTimeout(700);
await preview.page.screenshot({ path: "public/project-preview.png" });
await preview.context.close();

const mobile = await readyPage({ width: 390, height: 844 });
await mobile.page.waitForTimeout(700);
await mobile.page.screenshot({
  path: "../docs/screenshots/opening-mobile.png",
});
await mobile.page.locator("#explore-map").scrollIntoViewIfNeeded();
await mobile.page.waitForTimeout(900);
await mobile.page.screenshot({ path: "../docs/screenshots/math-mobile.png" });
const mobileMetrics = await mobile.page.evaluate(() => ({
  viewport: [window.innerWidth, window.innerHeight],
  scrollWidth: document.documentElement.scrollWidth,
  bodyWidth: document.body.getBoundingClientRect().width,
  stage: document
    .querySelector("#world-stage")
    ?.getBoundingClientRect()
    .toJSON(),
  map: document
    .querySelector("#explore-map .chapter-copy")
    ?.getBoundingClientRect()
    .toJSON(),
}));
console.log("mobile", JSON.stringify(mobileMetrics));
await mobile.context.close();

await browser.close();
