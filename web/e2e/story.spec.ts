import { expect, test } from "@playwright/test";

test("the guided story renders, advances, and stays within the viewport", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("./", { waitUntil: "networkidle" });
  await expect(
    page.getByRole("heading", {
      name: "The Shortest Path Through a Curved World",
    }),
  ).toBeVisible();
  await expect(page.locator("#loading")).toBeHidden();
  await expect(page.locator("#world-canvas")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);

  await page.locator("#release-heat").scrollIntoViewIfNeeded();
  const release = page.locator("#release-button");
  await expect(release).toHaveAccessibleName("Release Heat");
  await expect(release).toBeVisible();
  await release.click();
  await expect(release).toBeDisabled();

  for (const selector of [
    "#direction",
    "#mathematics",
    "#scale",
    "#under-the-hood",
  ]) {
    await page.locator(selector).scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    ).toBe(true);
  }
  await expect(
    page.getByRole("heading", { name: "Under the hood" }),
  ).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("keyboard and reduced-motion paths remain usable", async ({
  browser,
  baseURL,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "mobile-390",
    "The five-viewport story test already covers layout; exercise this accessibility path once.",
  );
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  await page.goto(baseURL ?? "./", { waitUntil: "networkidle" });
  const canvas = page.locator("#world-canvas");
  await canvas.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#scene-caption")).toContainText("Explorer placed");
  await page.getByRole("link", { name: "Skip to the story" }).focus();
  await expect(
    page.getByRole("link", { name: "Skip to the story" }),
  ).toBeFocused();
  await context.close();
});
