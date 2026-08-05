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
  const color = await page
    .locator(selector)
    .evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(color).toMatch(/^rgb\(0, 0, 0\)$/);
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
        for (const attribute of ["aria-label", "title", "alt"]) {
          const value = element.getAttribute(attribute);
          if (value?.includes("\u2014")) values.push(value);
        }
      });
    return values;
  });
  expect(violations).toEqual([]);
}

async function expectMonochromeText(page: Page): Promise<void> {
  const coloredText = await page.evaluate(() =>
    [...document.body.querySelectorAll<HTMLElement>("*")]
      .filter((element) => {
        const rectangle = element.getBoundingClientRect();
        const hasDirectText = [...element.childNodes].some(
          (node) =>
            node.nodeType === Node.TEXT_NODE &&
            Boolean(node.textContent?.trim()),
        );
        return (
          hasDirectText &&
          rectangle.width > 0 &&
          rectangle.height > 0 &&
          getComputedStyle(element).visibility !== "hidden"
        );
      })
      .flatMap((element) => {
        const match = getComputedStyle(element).color.match(
          /^rgba?\((\d+),\s*(\d+),\s*(\d+)/,
        );
        if (!match) return [];
        const channels = match.slice(1, 4).map(Number);
        return Math.max(...channels) - Math.min(...channels) > 0
          ? [
              {
                tag: element.tagName,
                id: element.id,
                className: element.className,
                color: getComputedStyle(element).color,
              },
            ]
          : [];
      }),
  );
  expect(coloredText).toEqual([]);
}

async function numericAttribute(
  locator: Locator,
  name: string,
): Promise<number> {
  return Number(await locator.getAttribute(name));
}

async function selectGenus(page: Page, genus: 1 | 2 | 3): Promise<void> {
  const button = page.locator(`button[data-genus="${genus}"]`);
  await button.click();
  await expect(page.locator("#loading")).toBeHidden();
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#world-canvas")).toHaveAttribute(
    "data-topology",
    `genus-${genus}`,
  );
}

test("Genus 2 opens cleanly in the minimal layout at every viewport", async ({
  page,
}) => {
  const errors = monitorErrors(page);
  await page.goto("./", { waitUntil: "networkidle" });
  await expect(page.locator("#loading")).toBeHidden();
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "The Shortest Path Through a Curved World",
    }),
  ).toBeVisible();
  await expect(page.locator(".site-header")).toHaveCount(0);
  await expect(page.locator(".progress-rail")).toHaveCount(0);
  await expect(
    page.locator(".stage-hint, .source-key, .stage-vignette"),
  ).toHaveCount(0);

  const canvas = page.locator("#world-canvas");
  await expect(canvas).toBeVisible();
  await expect(canvas).toHaveAttribute(
    "data-world-kind",
    "implicit-thickened-loop-graph",
  );
  await expect(canvas).toHaveAttribute("data-topology", "genus-2");
  await expect(canvas).toHaveAttribute("data-euler-characteristic", "-2");
  await expect(canvas).toHaveAttribute("data-native-routes", "true");
  await expect(canvas).toHaveAttribute("data-atmosphere", "false");
  await expect(canvas).toHaveAttribute("data-active-scenes", "1");
  await expect(canvas).toHaveAttribute("data-heat-mode", "idle");
  await expect(canvas).toHaveAttribute(
    "aria-describedby",
    "world-instructions scene-caption",
  );
  expect(
    Number(await canvas.getAttribute("data-vertex-count")),
  ).toBeGreaterThan(5_000);
  expect(Number(await canvas.getAttribute("data-face-count"))).toBeGreaterThan(
    10_000,
  );
  expect(
    await numericAttribute(canvas, "data-camera-distance"),
  ).toBeGreaterThan(5);

  await expect(page.locator("button[data-genus]")).toHaveCount(3);
  await expect(page.locator('button[data-genus="2"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator(".stage-controls button")).toHaveCount(7);
  await expect(page.locator("button[data-route-id]")).toHaveCount(3);
  await expect(page.locator("#release-button")).toHaveAttribute(
    "aria-pressed",
    "false",
  );

  const stageLayout = await page.evaluate(() => {
    const canvas = document
      .querySelector("#world-canvas")!
      .getBoundingClientRect();
    const controls = document
      .querySelector(".stage-controls")!
      .getBoundingClientRect();
    const stageStyle = getComputedStyle(
      document.querySelector("#world-stage")!,
    );
    return {
      canvasBottom: canvas.bottom,
      controlsTop: controls.top,
      borderTop: stageStyle.borderTopWidth,
      shadow: stageStyle.boxShadow,
      bodyFontSize: Number.parseFloat(getComputedStyle(document.body).fontSize),
    };
  });
  expect(stageLayout.controlsTop).toBeGreaterThanOrEqual(
    stageLayout.canvasBottom,
  );
  expect(stageLayout.borderTop).toBe("0px");
  expect(stageLayout.shadow).toBe("none");
  expect(stageLayout.bodyFontSize).toBeGreaterThanOrEqual(15);

  await expectBlackSurface(page, "html");
  await expectBlackSurface(page, "body");
  await expectBlackSurface(page, "#world-stage");
  await expectBlackSurface(page, ".canvas-frame");
  await expectNoHorizontalOverflow(page);
  await expectNoEmDash(page);
  await expectMonochromeText(page);

  const overlappingControls = await page
    .locator(".stage-controls button")
    .evaluateAll((buttons) => {
      const rectangles = buttons.map((button) =>
        button.getBoundingClientRect(),
      );
      for (let first = 0; first < rectangles.length; first += 1) {
        for (let second = first + 1; second < rectangles.length; second += 1) {
          const a = rectangles[first]!;
          const b = rectangles[second]!;
          if (
            Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
            Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1
          ) {
            return true;
          }
        }
      }
      return false;
    });
  expect(overlappingControls).toBe(false);
  expect(errors).toEqual([]);
});

test("genus selection is lazy, cached, scroll-stable, and metadata-driven", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-1280",
    "Exercise all native worlds once on desktop.",
  );
  const errors = monitorErrors(page);
  const binaryRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("world.bin")) binaryRequests.push(request.url());
  });
  await page.goto("./#route-choice", { waitUntil: "networkidle" });
  const canvas = page.locator("#world-canvas");
  const initialScroll = await page.evaluate(() => window.scrollY);
  const payloads = new Map<number, string>();
  const sceneGenerations = new Set<number>();

  for (const genus of [2, 1, 3] as const) {
    if (genus !== 2) await selectGenus(page, genus);
    payloads.set(
      genus,
      `${await canvas.getAttribute("data-vertex-count")}/${await canvas.getAttribute("data-face-count")}`,
    );
    await expect(canvas).toHaveAttribute(
      "data-euler-characteristic",
      String(2 - 2 * genus),
    );
    await expect(canvas).toHaveAttribute("data-active-scenes", "1");
    sceneGenerations.add(
      Number(await canvas.getAttribute("data-scene-generation")),
    );
    await expect(page.locator("button[data-route-id]")).toHaveCount(3);
    await expect(canvas).toHaveAttribute("data-active-route", "outer-ridge");
    await expect(page.locator("#ambient-length")).toContainText(
      "surface units",
    );
    expect(
      Math.abs((await page.evaluate(() => window.scrollY)) - initialScroll),
    ).toBeLessThan(4);
  }
  expect(new Set(payloads.values()).size).toBe(3);

  await selectGenus(page, 2);
  await expect(canvas).toHaveAttribute("data-load-source", "cache");
  await expect(canvas).toHaveAttribute("data-active-scenes", "1");
  sceneGenerations.add(
    Number(await canvas.getAttribute("data-scene-generation")),
  );
  expect(sceneGenerations.size).toBe(4);
  const genusTwoRequests = binaryRequests.filter((url) =>
    url.includes("genus-2/world.bin"),
  );
  expect(genusTwoRequests).toHaveLength(1);
  expect(binaryRequests).toHaveLength(3);

  const beforeOrbit = await numericAttribute(
    canvas,
    "data-camera-goal-azimuth",
  );
  await canvas.focus();
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(() => numericAttribute(canvas, "data-camera-goal-azimuth"))
    .not.toBe(beforeOrbit);
  expect(errors).toEqual([]);
});

test("all routes on every genus use red, green, and neutral native geometry", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-1440",
    "Exercise route selection and comparison once.",
  );
  const errors = monitorErrors(page);
  await page.goto("./#route-choice", { waitUntil: "networkidle" });
  const canvas = page.locator("#world-canvas");
  await expect(canvas).toHaveAttribute("data-ambient-color", "#ff3030");
  await expect(canvas).toHaveAttribute("data-heat-path-color", "#39ff88");
  await expect(canvas).toHaveAttribute("data-dijkstra-color", "#f1f1f1");

  for (const genus of [1, 2, 3] as const) {
    if (genus !== 2) await selectGenus(page, genus);
    const routeButtons = page.locator("button[data-route-id]");
    await expect(routeButtons).toHaveCount(3);
    const measurements = new Set<string>();
    for (let index = 0; index < 3; index += 1) {
      const button = routeButtons.nth(index);
      await button.click();
      await expect(button).toHaveAttribute("aria-pressed", "true");
      const routeId = await button.getAttribute("data-route-id");
      await expect(canvas).toHaveAttribute("data-active-route", routeId!);
      for (const metric of [
        "#ambient-length",
        "#dijkstra-length",
        "#heat-length",
      ]) {
        await expect(page.locator(metric)).toHaveText(
          /^\d+\.\d{3} surface units$/,
        );
      }
      measurements.add(
        (await page.locator("#heat-length").textContent()) ?? "",
      );
      const beforeReplay = Number(
        (await canvas.getAttribute("data-route-replay")) ?? 0,
      );
      await page.locator("#replay-route").click();
      await expect
        .poll(async () =>
          Number(await canvas.getAttribute("data-route-replay")),
        )
        .toBeGreaterThan(beforeReplay);
    }
    expect(measurements.size).toBe(3);
    await page.locator("#compare-routes").click();
    await expect(canvas).toHaveAttribute("data-comparison", "true");
    await expect(page.locator("#comparison-table-body tr")).toHaveCount(3);
    await expect(
      page.locator("#comparison-legend [data-route-id]"),
    ).toHaveCount(3);
  }
  await expectNoHorizontalOverflow(page);
  expect(errors).toEqual([]);
});

test("heat is reversible, replayable, and reset by switching or replaying", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-1280",
    "Exercise the full heat lifecycle once.",
  );
  const errors = monitorErrors(page);
  await page.goto("./#release-heat", { waitUntil: "networkidle" });
  const canvas = page.locator("#world-canvas");
  const button = page.locator("#release-button");
  await expect(button).toHaveText("Release heat");
  await expect(button).toHaveAttribute("aria-pressed", "false");
  await button.click();
  await expect(button).toHaveText("Remove heat");
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await expect(canvas).toHaveAttribute("data-heat-mode", "animation");
  await expect
    .poll(() => numericAttribute(canvas, "data-heat-progress"))
    .toBeGreaterThan(0.05);
  await expect(canvas).toHaveAttribute("data-heat-mode", "released", {
    timeout: 7_000,
  });
  await expect(canvas).toHaveAttribute("data-heat-progress", "1.000");

  await button.click();
  await expect(button).toHaveText("Release heat");
  await expect(button).toHaveAttribute("aria-pressed", "false");
  await expect(canvas).toHaveAttribute("data-heat-mode", "idle");
  await expect(canvas).not.toHaveAttribute("data-heat-progress", /.+/);
  await button.click();
  await expect(canvas).toHaveAttribute("data-heat-mode", "animation");
  await selectGenus(page, 1);
  await expect(button).toHaveAttribute("aria-pressed", "false");
  await expect(canvas).toHaveAttribute("data-heat-mode", "idle");

  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await page.locator("#replay-journey").click();
  await expect(button).toHaveAttribute("aria-pressed", "false");
  await expect(canvas).toHaveAttribute("data-heat-mode", "idle");
  expect(errors).toEqual([]);
});

test("mouse, synthetic pointer, keyboard, trackpad, focus, and scrolling cooperate", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-1440",
    "Exercise camera controls once on desktop.",
  );
  const errors = monitorErrors(page);
  await page.goto("./", { waitUntil: "networkidle" });
  const canvas = page.locator("#world-canvas");
  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  const box = bounds!;

  const mouseStart = await numericAttribute(canvas, "data-camera-azimuth");
  await page.mouse.move(box.x + box.width * 0.52, box.y + box.height * 0.48);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.68, box.y + box.height * 0.38, {
    steps: 5,
  });
  await page.mouse.up();
  await expect
    .poll(() => numericAttribute(canvas, "data-camera-azimuth"))
    .not.toBe(mouseStart);
  await expect(canvas).toHaveAttribute("data-focus-target", "manual");

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
        clientX: rectangle.left + rectangle.width * 0.5,
        clientY: rectangle.top + rectangle.height * 0.62,
      }),
    );
    element.dispatchEvent(
      new PointerEvent("pointerup", {
        ...common,
        buttons: 0,
        clientX: rectangle.left + rectangle.width * 0.5,
        clientY: rectangle.top + rectangle.height * 0.62,
      }),
    );
  });
  await expect
    .poll(() => numericAttribute(canvas, "data-camera-goal-elevation"))
    .not.toBe(syntheticStart);

  await canvas.focus();
  const keyboardDistance = await numericAttribute(
    canvas,
    "data-camera-goal-distance",
  );
  await page.keyboard.press("+");
  await expect
    .poll(() => numericAttribute(canvas, "data-camera-goal-distance"))
    .toBeLessThan(keyboardDistance);

  await page.locator("#explore-view").click();
  await expect(canvas).toHaveAttribute("data-explore-view", "true");
  const trackpadAzimuth = await numericAttribute(
    canvas,
    "data-camera-goal-azimuth",
  );
  expect(
    await canvas.evaluate((element) => {
      const event = new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        deltaX: 70,
        deltaY: 35,
      });
      element.dispatchEvent(event);
      return event.defaultPrevented;
    }),
  ).toBe(true);
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
  await page.keyboard.press("Escape");
  await expect(canvas).toHaveAttribute("data-explore-view", "false");

  await page.locator("#reset-view").click();
  await expect(canvas).toHaveAttribute("data-focus-target", "route");
  await page.locator("#focus-beacon").click();
  await expect(canvas).toHaveAttribute("data-focus-target", "beacon");
  await page.locator("#focus-route-start").click();
  await expect(canvas).toHaveAttribute("data-focus-target", "route-start");
  await page.mouse.dblclick(box.x + 12, box.y + box.height * 0.55);
  await expect(canvas).toHaveAttribute("data-focus-target", "route");

  await page.evaluate(() => window.scrollTo(0, 0));
  const beforeScroll = await page.evaluate(() => window.scrollY);
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
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.wheel(0, 420);
  await expect
    .poll(() => page.evaluate(() => window.scrollY))
    .toBeGreaterThan(beforeScroll);
  expect(errors).toEqual([]);
});

test("reduced motion completes heat immediately and remains reversible", async ({
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
  await page.goto(`${baseURL}#release-heat`, { waitUntil: "networkidle" });
  const canvas = page.locator("#world-canvas");
  const button = page.locator("#release-button");
  await expect(canvas).toHaveAttribute("data-auto-orbit", "false");
  await button.click();
  await expect(canvas).toHaveAttribute("data-heat-mode", "released");
  await expect(canvas).toHaveAttribute("data-heat-progress", "1.000");
  await expect(button).toHaveText("Remove heat");
  await button.click();
  await expect(canvas).toHaveAttribute("data-heat-mode", "idle");
  await expect(button).toHaveText("Release heat");
  await expectNoHorizontalOverflow(page);
  expect(errors).toEqual([]);
  await context.close();
});

test("failed native data retains a dark readable fallback", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "mobile-320",
    "Exercise the narrow fallback once.",
  );
  await page.route("**/data/worlds/genus-2/world.bin", (route) =>
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
