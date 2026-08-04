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

async function expectDarkAndReadable(page: Page): Promise<void> {
  const selectors = [
    "html",
    "body",
    "main",
    ".world-stage",
    ".chapter",
    ".chapter-copy",
    ".branch",
    ".exploration-tree details",
    ".under-hood",
    ".under-intro",
    ".technical-grid",
    ".technical-grid article",
    ".implementation-notes",
    ".references",
    ".code-figure",
    "footer",
    ".loading",
    ".webgl-fallback",
  ];
  const failures = await page.evaluate((surfaceSelectors) => {
    const channels = (value: string): number[] =>
      value
        .match(/[\d.]+/g)
        ?.slice(0, 4)
        .map(Number) ?? [];
    const luminance = (rgb: number[]): number => {
      const linear = rgb.slice(0, 3).map((channel) => {
        const value = channel / 255;
        return value <= 0.04045
          ? value / 12.92
          : Math.pow((value + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
    };
    return surfaceSelectors.flatMap((selector) =>
      [...document.querySelectorAll<HTMLElement>(selector)].flatMap(
        (element) => {
          const style = getComputedStyle(element);
          const background = channels(style.backgroundColor);
          const foreground = channels(style.color);
          const backgroundLuminance = luminance(background);
          const foregroundLuminance = luminance(foreground);
          const contrast =
            (Math.max(backgroundLuminance, foregroundLuminance) + 0.05) /
            (Math.min(backgroundLuminance, foregroundLuminance) + 0.05);
          return background.length >= 3 &&
            backgroundLuminance <= 0.015 &&
            contrast >= 4.1
            ? []
            : [
                {
                  selector,
                  background: style.backgroundColor,
                  color: style.color,
                  backgroundLuminance,
                  contrast,
                },
              ];
        },
      ),
    );
  }, selectors);
  expect(failures).toEqual([]);
}

async function expectNoEmDash(page: Page): Promise<void> {
  const violations = await page.evaluate(() => {
    const results: string[] = [];
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
    );
    let node = walker.nextNode();
    while (node) {
      const value = node.textContent ?? "";
      if (value.includes("\u2014")) results.push(value.trim());
      node = walker.nextNode();
    }
    for (const element of document.querySelectorAll<HTMLElement>(
      "[aria-label], [title], [alt], [placeholder]",
    )) {
      for (const attribute of ["aria-label", "title", "alt", "placeholder"]) {
        const value = element.getAttribute(attribute);
        if (value?.includes("\u2014")) results.push(`${attribute}: ${value}`);
      }
    }
    return results;
  });
  expect(violations).toEqual([]);
}

test("the opening is compact, dark, and framed correctly at every viewport", async ({
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
  await expectDarkAndReadable(page);
  await expectNoHorizontalOverflow(page);
  await expectNoEmDash(page);

  const metrics = await page.evaluate(() => {
    const stage = document
      .querySelector("#world-stage")!
      .getBoundingClientRect();
    return {
      stageWidthRatio: stage.width / window.innerWidth,
      stageHeightRatio: stage.height / window.innerHeight,
      bodyFontSize: getComputedStyle(document.body).fontSize,
    };
  });
  expect(metrics.bodyFontSize).toBe("14px");
  if (testInfo.project.name.startsWith("mobile")) {
    expect(metrics.stageHeightRatio).toBeGreaterThanOrEqual(0.38);
    expect(metrics.stageHeightRatio).toBeLessThanOrEqual(0.405);
  } else {
    expect(metrics.stageWidthRatio).toBeGreaterThanOrEqual(0.49);
    expect(metrics.stageWidthRatio).toBeLessThanOrEqual(0.53);
  }
  expect(errors).toEqual([]);
});

test("every large section remains black while scrolling", async ({
  page,
}, testInfo) => {
  test.skip(
    !["desktop-1440", "mobile-390"].includes(testInfo.project.name),
    "Exercise one desktop and one mobile layout.",
  );
  const errors = monitorErrors(page);
  await page.goto("./", { waitUntil: "networkidle" });
  await page.evaluate(() => {
    document.documentElement.style.scrollBehavior = "auto";
  });
  const sections = page.locator(".chapter, #under-the-hood, footer");
  for (let index = 0; index < (await sections.count()); index += 1) {
    await sections.nth(index).evaluate((element) => {
      element.scrollIntoView({ behavior: "auto", block: "start" });
    });
    await expectDarkAndReadable(page);
    await expectNoHorizontalOverflow(page);
  }
  expect(errors).toEqual([]);
});

test("the exploration tree supports direct branches, history, and visited state", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440", "Run once on desktop.");
  const errors = monitorErrors(page);
  await page.goto("./#explore-map", { waitUntil: "networkidle" });
  await expect(
    page.getByRole("heading", { name: "Explore the system." }),
  ).toBeVisible();

  const geometry = page.locator(
    '.exploration-tree a[href="#intrinsic-distance"]',
  );
  await geometry.click();
  await expect(page).toHaveURL(/#intrinsic-distance$/);
  await expect(geometry).toHaveAttribute("data-visited", "true");

  await page.getByRole("link", { name: "Back to map" }).first().click();
  await expect(page).toHaveURL(/#explore-map$/);
  await page.locator('.exploration-tree a[href="#diffusion"]').click();
  await expect(page).toHaveURL(/#diffusion$/);
  await page.goBack();
  await expect(page).toHaveURL(/#explore-map$/);
  await page.goBack();
  await expect(page).toHaveURL(/#intrinsic-distance$/);
  await page.goForward();
  await expect(page).toHaveURL(/#explore-map$/);

  await page.goto("./#halfedge-mesh", { waitUntil: "networkidle" });
  await expect(
    page.getByRole("heading", { name: "Halfedge mesh representation" }),
  ).toBeVisible();
  await expect(page.locator("#world-canvas")).toHaveAttribute(
    "data-surface-mode",
    "mesh",
  );
  expect(errors).toEqual([]);
});

test("the mobile tree behaves as a compact nested branch selector", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-430", "Run once on mobile.");
  await page.goto("./#explore-map", { waitUntil: "networkidle" });
  const branches = page.locator(".exploration-tree details");
  await expect(branches).toHaveCount(3);
  const engineSummary = branches.nth(2).locator("summary");
  await engineSummary.focus();
  await page.keyboard.press("Enter");
  if (
    !(await branches
      .nth(2)
      .evaluate((element) => (element as HTMLDetailsElement).open))
  ) {
    await page.keyboard.press("Enter");
  }
  await expect(branches.nth(2)).toHaveAttribute("open", "");
  expect(
    await branches.evaluateAll(
      (elements) =>
        elements.filter((element) => (element as HTMLDetailsElement).open)
          .length,
    ),
  ).toBe(1);
  await expect(
    branches.nth(2).getByRole("link", { name: "Real CPU benchmarks" }),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.goto("./#under-the-hood", { waitUntil: "networkidle" });
  const underHeading = page.getByRole("heading", { name: "Under the hood" });
  await expect(underHeading).toBeVisible();
  const mobilePositions = await page.evaluate(() => ({
    stageBottom: document.querySelector("#world-stage")!.getBoundingClientRect()
      .bottom,
    headingTop: document.querySelector("#under-title")!.getBoundingClientRect()
      .top,
  }));
  expect(mobilePositions.headingTop).toBeGreaterThan(
    mobilePositions.stageBottom,
  );
});

test("route, field, heat, target, reset, and pointer controls update the real scene", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1280", "Run once on desktop.");
  const errors = monitorErrors(page);
  await page.goto("./#route-comparison-node", { waitUntil: "networkidle" });
  const canvas = page.locator("#world-canvas");

  for (const mode of ["heat", "edge", "chord", "compare"] as const) {
    const button = page.locator(`button[data-route-mode="${mode}"]`);
    await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await expect(canvas).toHaveAttribute("data-route-mode", mode);
  }

  for (const mode of [
    "surface",
    "heat",
    "distance",
    "contours",
    "mesh",
  ] as const) {
    const button = page.locator(`button[data-surface-mode="${mode}"]`);
    await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await expect(canvas).toHaveAttribute("data-surface-mode", mode);
  }

  const expectedFrames = [0, 3, 5];
  const heatButtons = page.locator("[data-heat-state]");
  for (let index = 0; index < expectedFrames.length; index += 1) {
    await heatButtons.nth(index).click();
    await expect(canvas).toHaveAttribute(
      "data-heat-frame",
      String(expectedFrames[index]),
    );
    await expect(canvas).toHaveAttribute("data-surface-mode", "heat");
  }

  let revision = Number(await canvas.getAttribute("data-route-revision"));
  for (const target of ["exterior", "tunnel", "farSide"] as const) {
    await page.locator(`button[data-target-preset="${target}"]`).click();
    await expect(canvas).toHaveAttribute("data-target", target);
    await expect
      .poll(async () =>
        Number(await canvas.getAttribute("data-route-revision")),
      )
      .toBeGreaterThan(revision);
    revision = Number(await canvas.getAttribute("data-route-revision"));
  }

  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.click(
    box!.x + box!.width * 0.67,
    box!.y + box!.height * 0.38,
  );
  await expect(canvas).toHaveAttribute("data-target", "custom");
  await expect
    .poll(async () => Number(await canvas.getAttribute("data-route-revision")))
    .toBeGreaterThan(revision);

  await page.locator("#reset-control").click();
  await expect(canvas).toHaveAttribute("data-target", "exterior");
  await expect(canvas).toHaveAttribute("data-route-mode", "heat");
  await expect(canvas).toHaveAttribute("data-surface-mode", "surface");
  expect(errors).toEqual([]);
});

test("release heat respects reduced motion and keeps keyboard controls usable", async ({
  browser,
  baseURL,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-390", "Run once on mobile.");
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
    hasTouch: true,
  });
  const page = await context.newPage();
  const errors = monitorErrors(page);
  await page.goto(`${baseURL}#release-heat`, { waitUntil: "networkidle" });
  await page.locator("#release-button").click();
  await expect(page.locator("#world-canvas")).toHaveAttribute(
    "data-heat-progress",
    "1.000",
  );
  const tunnel = page.locator('[data-target-preset="tunnel"]');
  await tunnel.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#world-canvas")).toHaveAttribute(
    "data-target",
    "tunnel",
  );
  await expectNoHorizontalOverflow(page);
  expect(errors).toEqual([]);
  await context.close();
});

test("the loading and fallback states use the same black surface", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-430", "Run once on mobile.");
  await page.route("**/data/world.bin", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/octet-stream",
      body: "unavailable",
    }),
  );
  await page.goto("./", { waitUntil: "networkidle" });
  await expect(page.locator("#webgl-fallback")).toBeVisible();
  await expectDarkAndReadable(page);
  await expectNoHorizontalOverflow(page);
});
