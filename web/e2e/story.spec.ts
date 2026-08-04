import { expect, test, type Locator, type Page } from "@playwright/test";

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
        if (channels.length >= 3 && (channels[3] ?? 1) > 0) {
          return channels.slice(0, 3);
        }
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
      if (node.textContent?.includes("\u2014")) {
        values.push(node.textContent.trim());
      }
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

async function numericAttribute(
  locator: Locator,
  name: string,
): Promise<number> {
  return Number(await locator.getAttribute(name));
}

test("the toroidal story loads cleanly at every configured viewport", async ({
  page,
}) => {
  const errors = monitorErrors(page);
  await page.goto("./", { waitUntil: "networkidle" });
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "The Shortest Path Through a Curved World",
    }),
  ).toBeVisible();
  await expect(page.locator("#loading")).toBeHidden();

  const canvas = page.locator("#world-canvas");
  await expect(canvas).toBeVisible();
  await expect(canvas).toHaveAttribute("data-world-kind", "procedural-torus");
  await expect(canvas).toHaveAttribute("data-topology", "genus-1");
  await expect(canvas).toHaveAttribute("data-vertex-count", "10240");
  await expect(canvas).toHaveAttribute("data-face-count", "20480");
  await expect(canvas).toHaveAttribute("data-active-route", "ridge-crossing");
  await expect(canvas).toHaveAttribute("data-beacon-clickable", "true");
  await expect(canvas).toHaveAttribute("data-route-start-clickable", "true");
  await expect(canvas).toHaveAttribute(
    "aria-describedby",
    "world-instructions scene-caption",
  );
  expect(await canvas.getAttribute("role")).not.toBe("application");

  await expect(page.locator(".stage-controls button")).toHaveCount(4);
  await expect(page.locator("#explore-view")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect(page.locator(".stage-hint")).toContainText("Drag to orbit");
  await expect(page.locator("#world-instructions")).toContainText(
    "Escape exits Explore view",
  );
  await expect(page.locator(".code-figure")).toHaveCount(0);

  const documentText = (await page.content()).toLowerCase();
  const forbiddenTerms = ["cu" + "da", "cu" + "sparse", "nv" + "idia"];
  forbiddenTerms.forEach((term) => expect(documentText).not.toContain(term));

  await expectBlackSurface(page, "html");
  await expectBlackSurface(page, "body");
  await expectBlackSurface(page, "#world-stage");
  await expectNoHorizontalOverflow(page);
  await expectNoEmDash(page);

  const layout = await page.evaluate(() => {
    const stage = document
      .querySelector("#world-stage")!
      .getBoundingClientRect();
    const arrival = document.querySelector("#arrival")!.getBoundingClientRect();
    const heading = document.querySelector("h1")!;
    return {
      width: window.innerWidth,
      stage: {
        left: stage.left,
        right: stage.right,
        top: stage.top,
        bottom: stage.bottom,
        width: stage.width,
        height: stage.height,
      },
      arrival: {
        left: arrival.left,
        top: arrival.top,
      },
      bodyFontSize: Number.parseFloat(getComputedStyle(document.body).fontSize),
      bodyFontFamily: getComputedStyle(document.body).fontFamily,
      headingFontSize: Number.parseFloat(getComputedStyle(heading).fontSize),
    };
  });
  expect(layout.bodyFontFamily).toContain("STIX Two Text");
  expect(layout.bodyFontSize).toBeGreaterThanOrEqual(15);
  if (layout.width <= 900) {
    expect(layout.stage.bottom).toBeLessThanOrEqual(layout.arrival.top + 1);
    expect(layout.stage.height).toBeLessThanOrEqual(361);
    expect(layout.headingFontSize).toBeLessThanOrEqual(45);
  } else {
    expect(layout.stage.right).toBeLessThan(layout.arrival.left);
    expect(layout.stage.width).toBeLessThanOrEqual(602);
    expect(layout.stage.height).toBeLessThanOrEqual(642);
    expect(layout.headingFontSize).toBeLessThanOrEqual(56);
  }
  expect(errors).toEqual([]);
});

test("every route, heat replay, and comparison mode uses measured data", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-1280",
    "Exercise the full route flow once on desktop.",
  );
  const errors = monitorErrors(page);
  await page.goto("./#route-choice", { waitUntil: "networkidle" });
  const canvas = page.locator("#world-canvas");
  const observedHeatLengths = new Set<string>();
  for (const routeId of [
    "ridge-crossing",
    "inner-saddle-pass",
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

  await page.locator("#release-heat").scrollIntoViewIfNeeded();
  await page.locator("#release-button").click();
  await expect(canvas).toHaveAttribute("data-heat-mode", "animation");
  await expect
    .poll(async () => numericAttribute(canvas, "data-heat-progress"))
    .toBeGreaterThan(0);

  await page.locator("#replay-journey").click();
  await expect(canvas).toHaveAttribute("data-active-route", "ridge-crossing");
  await expect(canvas).toHaveAttribute("data-heat-mode", "idle");
  await expect(page.locator("#release-button")).toBeEnabled();
  await expectNoHorizontalOverflow(page);
  expect(errors).toEqual([]);
});

test("pointer, keyboard, trackpad, focus, and scroll controls cooperate", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-1440",
    "Exercise camera interactions once on desktop.",
  );
  const errors = monitorErrors(page);
  await page.goto("./", { waitUntil: "networkidle" });
  const canvas = page.locator("#world-canvas");
  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  const box = bounds!;

  await expect.poll(() => canvas.getAttribute("data-auto-orbit")).toBe("true");

  const mouseStart = await numericAttribute(canvas, "data-camera-azimuth");
  await page.mouse.move(box.x + box.width * 0.52, box.y + box.height * 0.48);
  await page.mouse.down();
  await expect(canvas).toHaveClass(/is-dragging/);
  await page.mouse.move(box.x + box.width * 0.68, box.y + box.height * 0.38, {
    steps: 5,
  });
  await page.mouse.up();
  await expect(canvas).not.toHaveClass(/is-dragging/);
  await expect
    .poll(() => numericAttribute(canvas, "data-camera-azimuth"))
    .not.toBe(mouseStart);
  await expect(canvas).toHaveAttribute("data-focus-target", "manual");
  await expect(canvas).toHaveAttribute("data-auto-orbit", "false");

  const syntheticStart = await numericAttribute(
    canvas,
    "data-camera-goal-elevation",
  );
  await canvas.evaluate((element) => {
    const rectangle = element.getBoundingClientRect();
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
        clientX: rectangle.left + rectangle.width * 0.45,
        clientY: rectangle.top + rectangle.height * 0.45,
      }),
    );
    element.dispatchEvent(
      new PointerEvent("pointermove", {
        ...common,
        buttons: 1,
        clientX: rectangle.left + rectangle.width * 0.48,
        clientY: rectangle.top + rectangle.height * 0.62,
      }),
    );
    element.dispatchEvent(
      new PointerEvent("pointerup", {
        ...common,
        buttons: 0,
        clientX: rectangle.left + rectangle.width * 0.48,
        clientY: rectangle.top + rectangle.height * 0.62,
      }),
    );
  });
  await expect
    .poll(() => numericAttribute(canvas, "data-camera-goal-elevation"))
    .not.toBe(syntheticStart);

  await canvas.focus();
  const keyboardAzimuth = await numericAttribute(
    canvas,
    "data-camera-goal-azimuth",
  );
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(() => numericAttribute(canvas, "data-camera-goal-azimuth"))
    .not.toBe(keyboardAzimuth);
  const keyboardDistance = await numericAttribute(
    canvas,
    "data-camera-goal-distance",
  );
  await page.keyboard.press("+");
  await expect
    .poll(() => numericAttribute(canvas, "data-camera-goal-distance"))
    .toBeLessThan(keyboardDistance);

  const manualGoal = await canvas.getAttribute("data-camera-goal-azimuth");
  await page.locator("#mathematics").scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  await expect(canvas).toHaveAttribute("data-focus-target", "manual");
  await expect(canvas).toHaveAttribute("data-camera-goal-azimuth", manualGoal!);

  const explore = page.locator("#explore-view");
  await explore.click();
  await expect(explore).toHaveAttribute("aria-pressed", "true");
  await expect(canvas).toHaveAttribute("data-explore-view", "true");
  const trackpadAzimuth = await numericAttribute(
    canvas,
    "data-camera-goal-azimuth",
  );
  const wheelResult = await canvas.evaluate((element) => {
    const event = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaX: 70,
      deltaY: 35,
    });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(wheelResult).toBe(true);
  await expect
    .poll(() => numericAttribute(canvas, "data-camera-goal-azimuth"))
    .not.toBe(trackpadAzimuth);

  const pinchDistance = await numericAttribute(
    canvas,
    "data-camera-goal-distance",
  );
  await canvas.evaluate((element) => {
    element.dispatchEvent(
      new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        deltaY: -55,
      }),
    );
  });
  await expect
    .poll(() => numericAttribute(canvas, "data-camera-goal-distance"))
    .toBeLessThan(pinchDistance);

  await page.locator("#reset-view").focus();
  await page.keyboard.press("Escape");
  await expect(explore).toHaveAttribute("aria-pressed", "false");
  await expect(canvas).toHaveAttribute("data-explore-view", "false");

  await page.locator("#reset-view").click();
  await expect(canvas).toHaveAttribute("data-focus-target", "route");
  await expect(page.locator("#scene-caption")).toContainText(
    "selected route and beacon",
  );
  await page.locator("#focus-beacon").click();
  await expect(canvas).toHaveAttribute("data-focus-target", "beacon");
  await expect(page.locator("#scene-caption")).toContainText(
    "amber heat source",
  );
  await page.locator("#focus-route-start").click();
  await expect(canvas).toHaveAttribute("data-focus-target", "route-start");
  await expect(page.locator("#scene-caption")).toContainText(
    "ridge crossing start",
  );

  await page.mouse.dblclick(box.x + 12, box.y + box.height * 0.55);
  await expect(canvas).toHaveAttribute("data-focus-target", "route");

  await page.evaluate(() => window.scrollTo(0, 0));
  const beforeScroll = await page.evaluate(() => window.scrollY);
  const verticalWheelPrevented = await canvas.evaluate((element) => {
    const event = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaY: 120,
    });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(verticalWheelPrevented).toBe(false);
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.wheel(0, 420);
  await expect
    .poll(() => page.evaluate(() => window.scrollY))
    .toBeGreaterThan(beforeScroll);
  expect(errors).toEqual([]);
});

test("comparison remains complete at the narrowest viewport", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "mobile-320",
    "Exercise the narrow comparison once.",
  );
  const errors = monitorErrors(page);
  await page.goto("./#route-choice", { waitUntil: "networkidle" });
  await page.locator("#compare-routes").click();
  await expect(page.locator("#world-canvas")).toHaveAttribute(
    "data-comparison",
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

test("reduced motion disables idle orbit and keeps controls immediate", async ({
  browser,
  baseURL,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "mobile-390",
    "Exercise reduced motion once.",
  );
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
    hasTouch: true,
  });
  const page = await context.newPage();
  const errors = monitorErrors(page);
  await page.goto(`${baseURL}`, { waitUntil: "networkidle" });
  const canvas = page.locator("#world-canvas");
  await expect(canvas).toHaveAttribute("data-auto-orbit", "false");
  const stableAzimuth = await canvas.getAttribute("data-camera-azimuth");
  await page.waitForTimeout(500);
  await expect(canvas).toHaveAttribute("data-camera-azimuth", stableAzimuth!);

  await page.locator("#route-inner-saddle-pass").click();
  await expect(canvas).toHaveAttribute(
    "data-active-route",
    "inner-saddle-pass",
  );
  await canvas.focus();
  const beforeKey = await numericAttribute(canvas, "data-camera-azimuth");
  await page.keyboard.press("ArrowLeft");
  await expect
    .poll(() => numericAttribute(canvas, "data-camera-azimuth"))
    .not.toBe(beforeKey);
  await page.keyboard.press("r");
  await expect(canvas).toHaveAttribute("data-focus-target", "route");

  await page.locator("#release-heat").scrollIntoViewIfNeeded();
  await page.locator("#release-button").click();
  await expect(canvas).toHaveAttribute("data-heat-progress", "1.000");
  await expectNoHorizontalOverflow(page);
  expect(errors).toEqual([]);
  await context.close();
});

test("the fallback remains dark, readable, and toroidal", async ({
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
  const fallbackShape = await page
    .locator(".fallback-world")
    .evaluate((node) => {
      const rectangle = node.getBoundingClientRect();
      return {
        ratio: rectangle.width / rectangle.height,
        radius: getComputedStyle(node).borderRadius,
      };
    });
  expect(fallbackShape.ratio).toBeGreaterThan(1.3);
  expect(fallbackShape.radius).toContain("50%");
  await expectNoHorizontalOverflow(page);
});
