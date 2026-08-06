import { expect, test, type Locator, type Page } from "@playwright/test";

function monitorErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

async function numericAttribute(
  locator: Locator,
  name: string,
): Promise<number> {
  return Number(await locator.getAttribute(name));
}

async function openReady(page: Page, path = "./"): Promise<void> {
  await page.goto(path, { waitUntil: "networkidle" });
  await expect(page.locator("#start-button")).toBeEnabled();
  await expect(page.locator("#startup-status")).toBeHidden();
}

async function begin(page: Page): Promise<void> {
  await page.locator("#start-button").click();
  await expect(page.locator("#journey-shell")).toBeVisible();
  await expect(page.locator("#opening-screen")).toBeHidden();
  await expect(page.locator("body")).toHaveAttribute("data-started", "true");
  await expect(page.locator("#arrival")).toBeVisible();
}

async function proceed(page: Page, act: number): Promise<void> {
  const button = page.locator(`[data-proceed-act="${act}"]`);
  await expect(button).toBeEnabled();
  await button.click();
  await expect(page.locator("body")).toHaveAttribute(
    "data-active-act",
    String(act + 1),
  );
  await expect(page.locator(`.chapter[data-act="${act + 1}"]`)).toBeVisible();
}

async function unlockRouteChoice(page: Page): Promise<void> {
  for (const act of [0, 1, 2]) await proceed(page, act);
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
}

async function expectBlackSurface(page: Page, selector: string): Promise<void> {
  const color = await page
    .locator(selector)
    .evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(color).toBe("rgb(0, 0, 0)");
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
      if (node.textContent?.includes("\u2014")) {
        values.push(node.textContent.trim());
      }
      node = walker.nextNode();
    }
    document
      .querySelectorAll<HTMLElement>("[aria-label], [title], [alt]")
      .forEach((element) => {
        for (const attribute of ["aria-label", "title", "alt"]) {
          const value = element.getAttribute(attribute);
          if (value?.includes("\u2014")) values.push(value);
        }
      });
    return values;
  });
  expect(violations).toEqual([]);
}

async function dispatchPointerDrag(
  canvas: Locator,
  deltaX: number,
  deltaY: number,
): Promise<void> {
  await canvas.evaluate(
    (element, delta) => {
      const rectangle = element.getBoundingClientRect();
      const startX = rectangle.left + rectangle.width * 0.45;
      const startY = rectangle.top + rectangle.height * 0.45;
      const common = {
        bubbles: true,
        cancelable: true,
        pointerId: 41,
        pointerType: "mouse",
        button: 0,
      };
      element.dispatchEvent(
        new PointerEvent("pointerdown", {
          ...common,
          buttons: 1,
          clientX: startX,
          clientY: startY,
        }),
      );
      element.dispatchEvent(
        new PointerEvent("pointermove", {
          ...common,
          buttons: 1,
          clientX: startX + delta.x,
          clientY: startY + delta.y,
        }),
      );
      element.dispatchEvent(
        new PointerEvent("pointerup", {
          ...common,
          buttons: 0,
          clientX: startX + delta.x,
          clientY: startY + delta.y,
        }),
      );
    },
    { x: deltaX, y: deltaY },
  );
}

async function dispatchPinch(
  canvas: Locator,
  startDistance: number,
  endDistance: number,
): Promise<void> {
  await canvas.evaluate(
    (element, distances) => {
      const rectangle = element.getBoundingClientRect();
      const centerX = rectangle.left + rectangle.width * 0.5;
      const centerY = rectangle.top + rectangle.height * 0.5;
      const event = (
        name: string,
        pointerId: number,
        x: number,
        buttons: number,
      ) =>
        element.dispatchEvent(
          new PointerEvent(name, {
            bubbles: true,
            cancelable: true,
            pointerId,
            pointerType: "touch",
            button: 0,
            buttons,
            clientX: x,
            clientY: centerY,
          }),
        );
      event("pointerdown", 51, centerX - distances.start / 2, 1);
      event("pointerdown", 52, centerX + distances.start / 2, 1);
      event("pointermove", 52, centerX + distances.end / 2, 1);
      event("pointermove", 51, centerX - distances.end / 2, 1);
      event("pointerup", 51, centerX - distances.end / 2, 0);
      event("pointerup", 52, centerX + distances.end / 2, 0);
    },
    { start: startDistance, end: endDistance },
  );
}

test("a fresh visit is a true locked opening at every viewport", async ({
  page,
}) => {
  const errors = monitorErrors(page);
  await openReady(page, "./#under-the-hood");

  await expect(page.locator("#opening-screen")).toBeVisible();
  await expect(page.locator("#journey-shell")).toBeHidden();
  await expect(page.locator("#world-canvas")).toBeHidden();
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "The Shortest Path Through a Curved World",
    }),
  ).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Start" })).toBeVisible();
  const repositoryLink = page.getByRole("link", {
    name: "Open The Shortest Path Through a Curved World on GitHub",
  });
  await expect(repositoryLink).toBeVisible();
  await expect(repositoryLink).toHaveAttribute(
    "href",
    "https://github.com/mihirrao-10/shortest-path-through-a-curved-world",
  );
  await expect(repositoryLink).toHaveAttribute("target", "_blank");
  await expect(repositoryLink).toHaveAttribute(
    "rel",
    /\bnoopener\b.*\bnoreferrer\b/,
  );
  await expect(repositoryLink.locator("svg")).toHaveAttribute(
    "aria-hidden",
    "true",
  );
  await repositoryLink.focus();
  await expect(repositoryLink).toBeFocused();
  await expect(page.locator(".opening-screen__premise")).toHaveText(
    "A beacon is visible across a world you are not allowed to leave.",
  );
  await expect(page.locator("body > *:visible")).toHaveCount(1);
  await page.locator("#start-button").focus();
  await expect(page.locator("#start-button")).toBeFocused();
  expect(new URL(page.url()).hash).toBe("");
  expect(
    await page.evaluate(() => document.documentElement.scrollHeight),
  ).toBeLessThanOrEqual(await page.evaluate(() => window.innerHeight + 1));

  await page.keyboard.press("End");
  await page.keyboard.press("PageDown");
  await page.mouse.wheel(0, 800);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page.locator("body")).toHaveAttribute(
    "data-max-unlocked-act",
    "0",
  );
  await expectBlackSurface(page, "html");
  await expectBlackSurface(page, "body");
  await expectBlackSurface(page, "#opening-screen");
  await expectNoHorizontalOverflow(page);
  await expectNoEmDash(page);
  expect(errors).toEqual([]);
});

test("the complete guided journey unlocks one chapter at a time", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-1440",
    "Run the complete animated journey once on desktop.",
  );
  const errors = monitorErrors(page);
  await openReady(page);
  const openingTitleSize = await page
    .locator("#opening-screen-title")
    .evaluate((element) => getComputedStyle(element).fontSize);
  await begin(page);

  const canvas = page.locator("#world-canvas");
  await expect(canvas).toBeVisible();
  await expect(canvas).toHaveAttribute(
    "data-world-kind",
    "implicit-thickened-loop-graph",
  );
  await expect(canvas).toHaveAttribute("data-topology", "genus-2");
  await expect(canvas).toHaveAttribute("data-native-routes", "true");
  await expect(canvas).toHaveAttribute("data-heat-mode", "idle");
  await expect(page.locator("#arrival [data-math] .katex")).toHaveCount(1);
  await expect(page.locator(".stage-header .view-controls button")).toHaveCount(
    4,
  );
  await expect(page.locator(".stage-footer button[data-genus]")).toHaveCount(5);
  await expect(page.locator("#compare-routes")).toBeHidden();
  await expect(page.locator("#world-instructions")).toHaveClass(/sr-only/);
  expect(
    await page.locator("#world-instructions").evaluate((element) => ({
      width: element.getBoundingClientRect().width,
      height: element.getBoundingClientRect().height,
      clipped: getComputedStyle(element).clipPath,
    })),
  ).toEqual({ width: 1, height: 1, clipped: "inset(50%)" });
  await expect(
    page.locator(".stage-hint, .source-key, .stage-vignette"),
  ).toHaveCount(0);

  const initialLayout = await page.evaluate(() => {
    const stage = document
      .querySelector("#world-stage")!
      .getBoundingClientRect();
    const title = document
      .querySelector("#arrival-title")!
      .getBoundingClientRect();
    const header = document
      .querySelector(".stage-header")!
      .getBoundingClientRect();
    const canvas = document
      .querySelector("#world-canvas")!
      .getBoundingClientRect();
    const footer = document
      .querySelector(".stage-footer")!
      .getBoundingClientRect();
    return {
      stageRight: stage.right,
      titleLeft: title.left,
      headerBottom: header.bottom,
      canvasTop: canvas.top,
      canvasBottom: canvas.bottom,
      footerTop: footer.top,
    };
  });
  expect(initialLayout.stageRight).toBeLessThan(initialLayout.titleLeft);
  expect(initialLayout.headerBottom).toBeLessThanOrEqual(
    initialLayout.canvasTop + 1,
  );
  expect(initialLayout.footerTop).toBeGreaterThan(initialLayout.canvasBottom);
  expect(
    await page
      .locator("#arrival-title")
      .evaluate((element) => getComputedStyle(element).fontSize),
  ).toBe(openingTitleSize);

  await page.keyboard.press("End");
  await page.keyboard.press("PageDown");
  await expect(page.locator("body")).toHaveAttribute(
    "data-max-unlocked-act",
    "0",
  );
  await expect(page.locator("#straight-line")).toBeHidden();

  await proceed(page, 0);
  await expect(page.locator("#arrival")).toBeVisible();
  await expect(page.locator("#straight-line")).toBeVisible();
  await expect(page.locator("#triangles")).toBeHidden();
  await expect(canvas).toHaveAttribute("data-route-selected", "false");
  await expect(canvas).toHaveAttribute("data-active-route", "");
  await expect(canvas).toHaveAttribute("data-visible-heat-paths", "1");
  expect(
    await page
      .locator("#straight-title")
      .evaluate((element) => getComputedStyle(element).fontSize),
  ).toBe(openingTitleSize);

  await proceed(page, 1);
  await proceed(page, 2);
  await expect(page.locator("#route-proceed")).toBeDisabled();
  await expect(canvas).toHaveAttribute("data-route-selected", "false");
  await expect(
    page.locator('button[data-route-id][aria-pressed="true"]'),
  ).toHaveCount(0);
  await expect(page.locator("#replay-route, #choose-route")).toHaveCount(0);

  const measuredRoutes = new Set<string>();
  for (const routeId of ["outer-ridge", "basin-rim", "central-neck"]) {
    const routeButton = page.locator(`button[data-route-id="${routeId}"]`);
    await routeButton.click();
    await expect(routeButton).toHaveAttribute("aria-pressed", "true");
    await expect(canvas).toHaveAttribute("data-active-route", routeId);
    await expect(canvas).toHaveAttribute("data-visible-heat-paths", "1");
    for (const metric of [
      "#ambient-length",
      "#dijkstra-length",
      "#heat-length",
    ]) {
      await expect(page.locator(metric)).toHaveText(
        /^\d+\.\d{3} surface units$/,
      );
    }
    measuredRoutes.add(
      [
        await page.locator("#ambient-length").textContent(),
        await page.locator("#dijkstra-length").textContent(),
        await page.locator("#heat-length").textContent(),
      ].join("/"),
    );
  }
  expect(measuredRoutes.size).toBe(3);
  await expect(page.locator("#route-proceed")).toBeEnabled();

  await proceed(page, 3);
  await expect(page.locator("body")).toHaveAttribute(
    "data-route-locked",
    "true",
  );
  await expect(
    page.locator('button[data-route-id="central-neck"]'),
  ).toHaveAttribute("aria-current", "step");
  expect(
    await page
      .locator("button[data-route-id]")
      .evaluateAll((buttons) =>
        buttons.every((button) => (button as HTMLButtonElement).disabled),
      ),
  ).toBe(true);
  await page
    .locator('button[data-route-id="basin-rim"]')
    .evaluate((element: HTMLButtonElement) => element.click());
  await expect(canvas).toHaveAttribute("data-active-route", "central-neck");
  await expect(page.locator("#compare-routes")).toBeHidden();

  await expect(page.locator("#heat-proceed")).toBeDisabled();
  await canvas.evaluate((element) => {
    const frames: string[] = [];
    (window as Window & { __heatFrames?: string[] }).__heatFrames = frames;
    new MutationObserver(() => {
      const frame = (element as HTMLElement).dataset.heatFrame;
      if (frame && !frames.includes(frame)) frames.push(frame);
    }).observe(element, {
      attributes: true,
      attributeFilter: ["data-heat-frame"],
    });
  });
  await page.locator("#release-button").click();
  await expect(canvas).toHaveAttribute("data-heat-mode", "animation");
  await expect(canvas).toHaveAttribute("data-heat-mode", "released", {
    timeout: 7_000,
  });
  await expect(canvas).toHaveAttribute("data-heat-progress", "1.000");
  expect(
    await page.evaluate(
      () => (window as Window & { __heatFrames?: string[] }).__heatFrames,
    ),
  ).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9"]);
  await expect(page.locator("#release-button")).toBeDisabled();
  await expect(page.locator("#release-button")).toHaveText("Heat released");
  await expect(page.locator("#heat-proceed")).toBeEnabled();

  await proceed(page, 4);
  await proceed(page, 5);
  await expect(page.locator("#math-title")).toBeInViewport();
  await expect(page.locator("#compare-routes")).toBeHidden();
  await proceed(page, 6);
  await expect(page.locator("#compare-routes")).toBeVisible();
  await expect(page.locator("#compare-routes")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await page.locator("#compare-routes").click();
  await expect(page.locator("#compare-routes")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(canvas).toHaveAttribute("data-comparison", "true");
  await expect(canvas).toHaveAttribute("data-visible-heat-paths", "3");
  await expect(page.locator("#comparison-panel")).toBeVisible();
  await expect(page.locator("#comparison-table-body tr")).toHaveCount(3);
  await expect(page.locator("#comparison-legend [data-route-id]")).toHaveCount(
    3,
  );
  await page.locator("#compare-routes").click();
  await expect(canvas).toHaveAttribute("data-comparison", "false");
  await expect(canvas).toHaveAttribute("data-visible-heat-paths", "1");
  await expect(canvas).toHaveAttribute("data-active-route", "central-neck");
  await expect(page.locator("#comparison-panel")).toBeHidden();

  await proceed(page, 7);
  await expect(page.locator("#benchmark-chart svg")).toBeVisible();
  await expect(page.locator("#benchmark-caption")).toContainText("CPU");
  await proceed(page, 8);
  await proceed(page, 9);
  await expect(page.locator("#under-the-hood")).toBeVisible();
  await expect(page.locator("#under-title")).toBeInViewport();
  await expect(page.locator("#site-footer")).toBeVisible();
  await expect(page.locator("#replay-journey")).toBeVisible();
  await expectNoEmDash(page);

  await page.locator("#replay-journey").click();
  await expect(page.locator("#opening-screen")).toBeVisible();
  await expect(page.locator("#journey-shell")).toBeHidden();
  await expect(page.locator("body")).toHaveAttribute("data-started", "false");
  await expect(page.locator("body")).toHaveAttribute(
    "data-max-unlocked-act",
    "0",
  );
  await expect(canvas).toHaveAttribute("data-route-selected", "false");
  await expect(canvas).toHaveAttribute("data-route-locked", "false");
  await expect(canvas).toHaveAttribute("data-heat-mode", "idle");
  await expect(canvas).toHaveAttribute("data-comparison", "false");
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect(new URL(page.url()).hash).toBe("");
  expect(errors).toEqual([]);
});

test("camera input follows the explicit direct-manipulation contract", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-1280",
    "Exercise controller state once on desktop.",
  );
  const errors = monitorErrors(page);
  await openReady(page);
  await begin(page);
  const canvas = page.locator("#world-canvas");

  let azimuth = await numericAttribute(canvas, "data-camera-goal-azimuth");
  let elevation = await numericAttribute(canvas, "data-camera-goal-elevation");
  await dispatchPointerDrag(canvas, 60, 55);
  await expect
    .poll(() => numericAttribute(canvas, "data-camera-goal-azimuth"))
    .toBeLessThan(azimuth);
  await expect
    .poll(() => numericAttribute(canvas, "data-camera-goal-elevation"))
    .toBeGreaterThan(elevation);

  let distance = await numericAttribute(canvas, "data-camera-goal-distance");
  await dispatchPinch(canvas, 90, 150);
  await expect
    .poll(() => numericAttribute(canvas, "data-camera-goal-distance"))
    .toBeLessThan(distance);
  distance = await numericAttribute(canvas, "data-camera-goal-distance");
  await dispatchPinch(canvas, 150, 80);
  await expect
    .poll(() => numericAttribute(canvas, "data-camera-goal-distance"))
    .toBeGreaterThan(distance);

  await page.locator("#explore-view").click();
  await expect(canvas).toHaveAttribute("data-explore-view", "true");
  azimuth = await numericAttribute(canvas, "data-camera-goal-azimuth");
  elevation = await numericAttribute(canvas, "data-camera-goal-elevation");
  expect(
    await canvas.evaluate((element) => {
      const event = new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        deltaX: 70,
        deltaY: 45,
      });
      element.dispatchEvent(event);
      return event.defaultPrevented;
    }),
  ).toBe(true);
  await expect
    .poll(() => numericAttribute(canvas, "data-camera-goal-azimuth"))
    .toBeLessThan(azimuth);
  await expect
    .poll(() => numericAttribute(canvas, "data-camera-goal-elevation"))
    .toBeGreaterThan(elevation);

  distance = await numericAttribute(canvas, "data-camera-goal-distance");
  await canvas.evaluate((element) =>
    element.dispatchEvent(
      new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        deltaY: -55,
      }),
    ),
  );
  await expect
    .poll(() => numericAttribute(canvas, "data-camera-goal-distance"))
    .toBeLessThan(distance);

  await canvas.focus();
  azimuth = await numericAttribute(canvas, "data-camera-goal-azimuth");
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(() => numericAttribute(canvas, "data-camera-goal-azimuth"))
    .toBeLessThan(azimuth);
  elevation = await numericAttribute(canvas, "data-camera-goal-elevation");
  await page.keyboard.press("ArrowUp");
  await expect
    .poll(() => numericAttribute(canvas, "data-camera-goal-elevation"))
    .toBeLessThan(elevation);
  await page.keyboard.press("Escape");
  await expect(canvas).toHaveAttribute("data-explore-view", "false");

  await proceed(page, 0);
  expect(
    await canvas.evaluate((element) => {
      const event = new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        deltaY: 120,
      });
      element.dispatchEvent(event);
      return event.defaultPrevented;
    }),
  ).toBe(false);
  const scrollBefore = await page.evaluate(() => window.scrollY);
  await page.mouse.move(200, 300);
  await page.mouse.wheel(0, 420);
  await expect
    .poll(() => page.evaluate(() => window.scrollY))
    .toBeGreaterThan(scrollBefore);
  expect(errors).toEqual([]);
});

test("genus switching preserves a compatible committed route without bypassing milestones", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-1280",
    "Exercise all exported worlds once.",
  );
  const errors = monitorErrors(page);
  await openReady(page);
  await begin(page);
  await unlockRouteChoice(page);
  await page.locator('button[data-route-id="basin-rim"]').click();
  await proceed(page, 3);

  const canvas = page.locator("#world-canvas");
  const payloads = new Set<string>();
  const measurements = new Set<string>();
  for (const genus of [2, 1, 3, 4, 5] as const) {
    const button = page.locator(`button[data-genus="${genus}"]`);
    if (genus !== 2) await button.click();
    await expect(page.locator("#loading")).toBeHidden();
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await expect(canvas).toHaveAttribute("data-topology", `genus-${genus}`);
    await expect(canvas).toHaveAttribute(
      "data-euler-characteristic",
      String(2 - 2 * genus),
    );
    await expect(canvas).toHaveAttribute("data-active-route", "basin-rim");
    await expect(canvas).toHaveAttribute("data-route-locked", "true");
    await expect(canvas).toHaveAttribute("data-active-scenes", "1");
    await expect(page.locator("body")).toHaveAttribute(
      "data-max-unlocked-act",
      "4",
    );
    await expect(page.locator("body")).toHaveAttribute(
      "data-heat-released",
      "false",
    );
    payloads.add(
      `${await canvas.getAttribute("data-vertex-count")}/${await canvas.getAttribute("data-face-count")}`,
    );
    measurements.add((await page.locator("#heat-length").textContent()) ?? "");
    await expect(page.locator("#residual-list dd").first()).toContainText(
      `Genus ${genus}`,
    );
    if (genus >= 3) {
      await testInfo.attach(`genus-${genus}-authored-view`, {
        body: await canvas.screenshot(),
        contentType: "image/png",
      });
    }
  }
  expect(payloads.size).toBe(5);
  expect(measurements.size).toBe(5);

  await page.locator("#release-button").click();
  await expect(canvas).toHaveAttribute("data-heat-mode", "animation");
  await testInfo.attach("genus-5-heat-early", {
    body: await canvas.screenshot(),
    contentType: "image/png",
  });
  await expect
    .poll(() => numericAttribute(canvas, "data-heat-frame"), {
      timeout: 7_000,
    })
    .toBeGreaterThanOrEqual(5);
  await testInfo.attach("genus-5-heat-middle", {
    body: await canvas.screenshot(),
    contentType: "image/png",
  });
  await expect(canvas).toHaveAttribute("data-heat-mode", "released", {
    timeout: 7_000,
  });
  await expect(canvas).toHaveAttribute("data-heat-frame", "9");
  await testInfo.attach("genus-5-heat-final", {
    body: await canvas.screenshot(),
    contentType: "image/png",
  });
  expect(errors).toEqual([]);
});

test("world bundles load lazily, cache after selection, and never prefetch higher genera", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-1440",
    "Inspect the production request contract once.",
  );
  const worldRequests: string[] = [];
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.includes("/data/worlds/")) worldRequests.push(pathname);
  });

  await openReady(page);
  expect(
    worldRequests.filter((path) => path.endsWith("manifest.json")),
  ).toHaveLength(1);
  expect(
    worldRequests.filter((path) => path.includes("/genus-2/")),
  ).toHaveLength(2);
  for (const genus of [1, 3, 4, 5]) {
    expect(
      worldRequests.some((path) => path.includes(`/genus-${genus}/`)),
    ).toBe(false);
  }

  await begin(page);
  await page.locator('button[data-genus="4"]').click();
  await expect(page.locator("#world-canvas")).toHaveAttribute(
    "data-topology",
    "genus-4",
  );
  expect(
    worldRequests.filter((path) => path.includes("/genus-4/")),
  ).toHaveLength(2);
  await page.locator('button[data-genus="5"]').click();
  await expect(page.locator("#world-canvas")).toHaveAttribute(
    "data-topology",
    "genus-5",
  );
  expect(
    worldRequests.filter((path) => path.includes("/genus-5/")),
  ).toHaveLength(2);
  await page.locator('button[data-genus="4"]').click();
  await expect(page.locator("#world-canvas")).toHaveAttribute(
    "data-topology",
    "genus-4",
  );
  await expect(page.locator("#world-canvas")).toHaveAttribute(
    "data-load-source",
    "cache",
  );
  expect(
    worldRequests.filter((path) => path.includes("/genus-4/")),
  ).toHaveLength(2);
});

test("a failed higher-genus load preserves the active world and offers retry", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "tablet-1024",
    "Exercise recoverable world loading once.",
  );
  let failOnce = true;
  await page.route("**/data/worlds/genus-4/world.meta.json", async (route) => {
    if (failOnce) {
      failOnce = false;
      await route.fulfill({ status: 503, body: "temporary failure" });
    } else {
      await route.continue();
    }
  });
  await openReady(page);
  await begin(page);
  const scrollBefore = await page.evaluate(() => window.scrollY);
  await page.locator('button[data-genus="4"]').click();
  await expect(page.locator("#loading p")).toContainText(
    "Select it again to retry.",
  );
  await expect(page.locator("#world-canvas")).toHaveAttribute(
    "data-topology",
    "genus-2",
  );
  await expect(page.locator('button[data-genus="2"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);

  await page.locator('button[data-genus="4"]').click();
  await expect(page.locator("#loading")).toBeHidden();
  await expect(page.locator("#world-canvas")).toHaveAttribute(
    "data-topology",
    "genus-4",
  );
  await expect(page.locator('button[data-genus="4"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("keyboard-only and reduced-motion users can complete and replay the journey", async ({
  browser,
  baseURL,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "mobile-390",
    "Exercise the reduced-motion keyboard flow once.",
  );
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
    hasTouch: true,
  });
  const page = await context.newPage();
  const errors = monitorErrors(page);
  await page.goto(baseURL!, { waitUntil: "networkidle" });
  await expect(page.locator("#start-button")).toBeEnabled();
  await expect(page.locator("#start-button")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#arrival-title")).toBeFocused();

  for (const act of [0, 1, 2]) {
    const button = page.locator(`[data-proceed-act="${act}"]`);
    await button.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("body")).toHaveAttribute(
      "data-active-act",
      String(act + 1),
    );
  }
  const route = page.locator('button[data-route-id="outer-ridge"]');
  await route.focus();
  await page.keyboard.press("Enter");
  await expect(route).toHaveAttribute("aria-pressed", "true");
  await page.locator("#route-proceed").focus();
  await page.keyboard.press("Enter");

  await page.locator("#release-button").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("body")).toHaveAttribute(
    "data-heat-released",
    "true",
    { timeout: 2_000 },
  );
  await expect(page.locator("#world-canvas")).toHaveAttribute(
    "data-auto-orbit",
    "false",
  );
  await expect(page.locator("#world-canvas")).toHaveAttribute(
    "data-heat-frame",
    "9",
  );

  for (const act of [4, 5, 6, 7, 8, 9]) {
    const button = page.locator(`[data-proceed-act="${act}"]`);
    await button.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("body")).toHaveAttribute(
      "data-active-act",
      String(act + 1),
    );
  }
  await expect(page.locator("#under-title")).toBeFocused();
  await page.locator("#replay-journey").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#opening-screen")).toBeVisible();
  await expect(page.locator("#start-button")).toBeFocused();
  await expectNoHorizontalOverflow(page);
  expect(errors).toEqual([]);
  await context.close();
});

test("the WebGL fallback follows Start, route, heat, compare, and replay rules", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "mobile-320",
    "Exercise the complete fallback once.",
  );
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      contextId: string,
      options?: unknown,
    ) {
      if (contextId.startsWith("webgl")) return null;
      return original.call(this, contextId as "2d", options as never);
    } as typeof HTMLCanvasElement.prototype.getContext;
  });
  const errors = monitorErrors(page);
  await openReady(page);
  await expect(page.locator("#webgl-fallback")).toBeHidden();
  await begin(page);
  await expect(page.locator("body")).toHaveAttribute("data-webgl", "fallback");
  await expect(page.locator("#world-canvas")).toBeHidden();
  await expect(page.locator("#webgl-fallback")).toBeVisible();
  await expect(page.locator("#webgl-fallback")).toContainText(
    "native C++ pipeline",
  );
  await expectBlackSurface(page, "#webgl-fallback");

  await unlockRouteChoice(page);
  await page.locator('button[data-route-id="basin-rim"]').click();
  await expect(page.locator("#webgl-fallback")).toHaveAttribute(
    "data-route-selected",
    "true",
  );
  await proceed(page, 3);
  await expect(page.locator("#webgl-fallback")).toHaveAttribute(
    "data-route-locked",
    "true",
  );
  await page.locator("#release-button").click();
  await expect(page.locator("body")).toHaveAttribute(
    "data-heat-released",
    "true",
    { timeout: 7_000 },
  );
  await expect(page.locator("#webgl-fallback")).toHaveAttribute(
    "data-heat-frame",
    "9",
  );
  for (const act of [4, 5, 6]) await proceed(page, act);
  await page.locator("#compare-routes").click();
  await expect(page.locator("#webgl-fallback")).toHaveAttribute(
    "data-comparison",
    "true",
  );
  await expect(page.locator("#comparison-panel")).toBeVisible();
  for (const act of [7, 8, 9]) await proceed(page, act);
  await page.locator("#replay-journey").click();
  await expect(page.locator("#opening-screen")).toBeVisible();
  await expect(page.locator("body")).toHaveAttribute("data-started", "false");
  await expectNoHorizontalOverflow(page);
  expect(errors).toEqual([]);
});

test("stage, controls, title, and active copy do not overlap at supported sizes", async ({
  page,
}) => {
  const errors = monitorErrors(page);
  await openReady(page);
  await begin(page);
  await expectNoHorizontalOverflow(page);

  const layout = await page.evaluate(() => {
    const rect = (selector: string) =>
      document.querySelector(selector)!.getBoundingClientRect().toJSON();
    const controls = [
      ...document.querySelectorAll<HTMLElement>(
        ".stage-header button:not([hidden]), .stage-footer button:not([hidden])",
      ),
    ].map((element) => element.getBoundingClientRect().toJSON());
    const title = document.querySelector("#arrival-title")!;
    return {
      stage: rect("#world-stage"),
      title: title.getBoundingClientRect().toJSON(),
      titleScrollWidth: title.scrollWidth,
      titleClientWidth: title.clientWidth,
      canvas: rect("#world-canvas"),
      header: rect(".stage-header"),
      footer: rect(".stage-footer"),
      controls,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    };
  });
  expect(layout.titleScrollWidth).toBeLessThanOrEqual(
    layout.titleClientWidth + 1,
  );
  expect(layout.header.bottom).toBeLessThanOrEqual(layout.canvas.top + 1);
  expect(layout.footer.top).toBeGreaterThan(layout.canvas.bottom);
  expect(layout.stage.height).toBeLessThan(layout.viewport.height * 0.88);

  for (let first = 0; first < layout.controls.length; first += 1) {
    for (let second = first + 1; second < layout.controls.length; second += 1) {
      const a = layout.controls[first]!;
      const b = layout.controls[second]!;
      const overlaps =
        Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
        Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
      expect(overlaps).toBe(false);
    }
  }

  if (layout.viewport.width > 820) {
    expect(layout.stage.right).toBeLessThan(layout.title.left);
  } else {
    const selectorRows = await page
      .locator(".genus-selector button")
      .evaluateAll((buttons) =>
        buttons.map((button) => Math.round(button.getBoundingClientRect().top)),
      );
    expect(new Set(selectorRows).size).toBeGreaterThanOrEqual(2);
    expect(layout.stage.bottom).toBeLessThanOrEqual(layout.title.top + 1);
    await proceed(page, 0);
    await page.waitForTimeout(600);
    const positions = await page.evaluate(() => ({
      stageBottom: document
        .querySelector("#world-stage")!
        .getBoundingClientRect().bottom,
      titleTop: document
        .querySelector("#straight-title")!
        .getBoundingClientRect().top,
    }));
    expect(positions.titleTop).toBeGreaterThanOrEqual(
      positions.stageBottom - 1,
    );
  }
  await expectNoEmDash(page);
  expect(errors).toEqual([]);
});

test("corrupt native data still opens a dark written fallback", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "mobile-375",
    "Exercise data failure recovery once.",
  );
  await page.route("**/data/worlds/genus-2/world.bin", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/octet-stream",
      body: "unavailable",
    }),
  );
  await openReady(page);
  await begin(page);
  await expect(page.locator("#webgl-fallback")).toBeVisible();
  await expect(page.locator("#webgl-fallback")).toContainText(
    "written explanation",
  );
  await expectBlackSurface(page, "#webgl-fallback");
  await expectNoHorizontalOverflow(page);
});
