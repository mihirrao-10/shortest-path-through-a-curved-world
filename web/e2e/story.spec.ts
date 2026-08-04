import { expect, test, type Page } from "@playwright/test";

function monitorErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
}

async function expectBlackSurface(page: Page, selector: string): Promise<void> {
  const colors = await page.locator(selector).evaluateAll((elements) =>
    elements.map((element) => {
      let current: Element | null = element;
      while (current) {
        const color = getComputedStyle(current).backgroundColor;
        const channels = color.match(/[\d.]+/g)?.map(Number) ?? [];
        if (channels.length >= 3 && (channels[3] ?? 1) > 0)
          return channels.slice(0, 3);
        current = current.parentElement;
      }
      return [255, 255, 255];
    }),
  );
  expect(colors.length).toBeGreaterThan(0);
  expect(
    colors.every((channels) => channels.every((channel) => channel === 0)),
  ).toBe(true);
}

async function expectNoEmDash(page: Page): Promise<void> {
  const violations = await page.evaluate(() => {
    const values: string[] = [];
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
    );
    let node = walker.nextNode();
    while (node) {
      if (node.textContent?.includes("\u2014"))
        values.push(node.textContent.trim());
      node = walker.nextNode();
    }
    document
      .querySelectorAll<HTMLElement>("[aria-label], [title], [alt]")
      .forEach((element) => {
        ["aria-label", "title", "alt"].forEach((attribute) => {
          const value = element.getAttribute(attribute);
          if (value?.includes("\u2014")) values.push(value);
        });
      });
    return values;
  });
  expect(violations).toEqual([]);
}

test("the compact black story loads cleanly at every configured viewport", async ({
  page,
}, testInfo) => {
  const errors = monitorErrors(page);
  await page.goto("./", { waitUntil: "networkidle" });
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "The Shortest Path Through a Curved World",
    }),
  ).toBeVisible();
  await expect(page.locator("#loading")).toBeHidden();
  await expect(page.locator("#world-canvas")).toBeVisible();
  await expect(page.locator("#world-canvas")).toHaveAttribute(
    "data-active-route",
    "ridge-crossing",
  );
  await expectBlackSurface(page, "html");
  await expectBlackSurface(page, "body");
  await expectBlackSurface(page, "#world-stage");
  await expectNoHorizontalOverflow(page);
  await expectNoEmDash(page);

  const layout = await page.evaluate(() => {
    const stage = document
      .querySelector("#world-stage")!
      .getBoundingClientRect();
    const heading = document.querySelector("h1")!;
    return {
      stageWidth: stage.width,
      stageHeight: stage.height,
      bodyFontSize: Number.parseFloat(getComputedStyle(document.body).fontSize),
      headingFontSize: Number.parseFloat(getComputedStyle(heading).fontSize),
    };
  });
  expect(layout.bodyFontSize).toBeGreaterThanOrEqual(15);
  if (testInfo.project.name.startsWith("mobile")) {
    expect(layout.stageHeight).toBeLessThanOrEqual(360);
    expect(layout.headingFontSize).toBeLessThanOrEqual(40);
  } else {
    expect(layout.stageWidth).toBeLessThanOrEqual(622);
    expect(layout.stageHeight).toBeLessThanOrEqual(682);
    expect(layout.headingFontSize).toBeLessThanOrEqual(56);
  }
  expect(errors).toEqual([]);
});

test("all three authored routes update the active ID and real measurements", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-1280",
    "Exercise controls once on desktop.",
  );
  const errors = monitorErrors(page);
  await page.goto("./#route-choice", { waitUntil: "networkidle" });
  const canvas = page.locator("#world-canvas");
  const observedHeatLengths = new Set<string>();
  for (const routeId of [
    "ridge-crossing",
    "saddle-pass",
    "basin-rim",
  ] as const) {
    const button = page.locator(`button[data-route-id="${routeId}"]`);
    await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await expect(button).toHaveAttribute("aria-current", "true");
    await expect(page.locator("#active-route-id")).toHaveText(routeId);
    await expect(page.locator("#route-choice")).toHaveAttribute(
      "data-active-route-id",
      routeId,
    );
    await expect(page.locator("#route-details")).toHaveAttribute(
      "data-active-route-id",
      routeId,
    );
    await expect(canvas).toHaveAttribute("data-active-route", routeId);
    const metric = (await page.locator("#heat-length").textContent()) ?? "";
    expect(metric).toMatch(/^\d+\.\d{3} surface units$/);
    observedHeatLengths.add(metric);
  }
  expect(observedHeatLengths.size).toBe(3);

  const beforeReplay = Number(
    (await canvas.getAttribute("data-route-replay")) ?? 0,
  );
  await page.locator("#replay-route").click();
  await expect
    .poll(async () => Number(await canvas.getAttribute("data-route-replay")))
    .toBeGreaterThan(beforeReplay);

  await page.locator("#compare-routes").click();
  await expect(canvas).toHaveAttribute("data-comparison", "true");
  await expect(page.locator("#compare-routes")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator("#comparison-panel")).toBeVisible();
  await expect(page.locator("#comparison-table-body tr")).toHaveCount(3);
  await expect(page.locator("#comparison-legend [data-route-id]")).toHaveCount(
    3,
  );

  await page.locator("#choose-route").click();
  await expect(canvas).toHaveAttribute("data-comparison", "false");
  await expect(page.locator("#comparison-panel")).toBeHidden();
  await expectNoHorizontalOverflow(page);
  expect(errors).toEqual([]);
});

test("compare action lands on the complete table at the narrowest viewport", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "mobile-320",
    "Exercise the shortest mobile viewport once.",
  );
  const errors = monitorErrors(page);
  await page.goto("./#route-choice", { waitUntil: "networkidle" });
  await page.locator("#compare-routes").click();
  await expect(page.locator("#world-canvas")).toHaveAttribute(
    "data-comparison",
    "true",
  );
  await expect(page.locator("#compare-routes")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator("#comparison-panel")).toBeVisible();
  await expect(page.locator("#chapter-indicator")).toContainText(
    "One field, three journeys",
  );
  const comparisonLayout = await page
    .locator("#comparison-table-body")
    .evaluate((body) => {
      const wrapper = body.closest(".comparison-table-wrap")!;
      const panel = body.closest("#comparison-panel")!.getBoundingClientRect();
      return {
        clientWidth: wrapper.clientWidth,
        scrollWidth: wrapper.scrollWidth,
        panelTop: panel.top,
        panelBottom: panel.bottom,
        viewportHeight: window.innerHeight,
      };
    });
  expect(comparisonLayout.scrollWidth).toBeLessThanOrEqual(
    comparisonLayout.clientWidth + 1,
  );
  expect(comparisonLayout.panelTop).toBeLessThan(
    comparisonLayout.viewportHeight,
  );
  expect(comparisonLayout.panelBottom).toBeGreaterThan(0);
  await expectNoHorizontalOverflow(page);
  expect(errors).toEqual([]);
});

test("major story surfaces remain pure black from mathematics through the footer", async ({
  page,
}, testInfo) => {
  test.skip(
    !["desktop-1440", "mobile-390"].includes(testInfo.project.name),
    "Inspect one desktop and one mobile surface stack.",
  );
  await page.goto("./", { waitUntil: "networkidle" });
  for (const selector of [
    "#arrival",
    "#route-choice",
    "#mathematics",
    "#under-the-hood",
    "footer",
  ]) {
    await page.locator(selector).scrollIntoViewIfNeeded();
    await expectBlackSurface(page, selector);
    await expectNoHorizontalOverflow(page);
  }
});

test("release, replay, and keyboard paths honor reduced motion", async ({
  browser,
  baseURL,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "mobile-390",
    "Exercise accessibility once.",
  );
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
    hasTouch: true,
  });
  const page = await context.newPage();
  const errors = monitorErrors(page);
  await page.goto(`${baseURL}#route-choice`, { waitUntil: "networkidle" });
  const saddle = page.locator("#route-saddle-pass");
  await saddle.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#world-canvas")).toHaveAttribute(
    "data-active-route",
    "saddle-pass",
  );
  const canvas = page.locator("#world-canvas");
  await canvas.focus();
  await page.keyboard.press("Enter");
  await expect(canvas).toHaveAttribute("data-active-route", "ridge-crossing");

  await page.locator("#compare-routes").click();
  await expect(canvas).toHaveAttribute("data-comparison", "true");
  await expect(page.locator("#comparison-panel")).toBeVisible();
  await page.locator("#choose-route").click();
  await expect(canvas).toHaveAttribute("data-comparison", "false");
  await expect(page.locator("#comparison-panel")).toBeHidden();

  await page.locator("#release-heat").scrollIntoViewIfNeeded();
  await page.locator("#release-button").click();
  await expect(canvas).toHaveAttribute("data-heat-progress", "1.000");
  await page.locator("#replay-journey").click();
  await expect(canvas).toHaveAttribute("data-active-route", "ridge-crossing");
  await expect(canvas).toHaveAttribute("data-heat-mode", "idle");
  await expect(page.locator("#release-button")).toBeEnabled();
  await expectNoHorizontalOverflow(page);
  expect(errors).toEqual([]);
  await context.close();
});

test("loading failure preserves the black fallback and readable story", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "mobile-320",
    "Exercise the narrow fallback once.",
  );
  await page.route("**/data/world.bin", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/octet-stream",
      body: "unavailable",
    }),
  );
  await page.goto("./", { waitUntil: "networkidle" });
  await expect(page.locator("#webgl-fallback")).toBeVisible();
  await expectBlackSurface(page, "#webgl-fallback");
  await expectNoHorizontalOverflow(page);
});
