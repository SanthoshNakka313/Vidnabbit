import { expect, submitUrl, test } from "./fixtures";

test.describe("error states (mock API)", () => {
  test("DRM-protected service", async ({ page }) => {
    await page.goto("/download");
    await submitUrl(page, "https://www.netflix.com/watch/80100172");
    const alert = page.locator("[role=alert][data-error-code]");
    await expect(alert).toHaveAttribute("data-error-code", "drm_protected");
    const heading = alert.getByRole("heading", { name: "This content is copy-protected" });
    await expect(heading).toBeFocused();
    await expect(alert).toContainText("DRM");
    await expect(alert.getByRole("button", { name: "Try another link" })).toBeVisible();
    // The next step moves focus back to the URL box, with the link kept.
    await alert.getByRole("button", { name: "Try another link" }).click();
    await expect(page.getByLabel("Paste a link")).toBeFocused();
    await expect(page.getByLabel("Paste a link")).toHaveValue("https://www.netflix.com/watch/80100172");
  });

  test("private content", async ({ page }) => {
    await page.goto("/download");
    await submitUrl(page, "https://example.com/private/clip-42");
    const alert = page.locator("[role=alert][data-error-code]");
    await expect(alert.getByRole("heading", { name: "This content is private" })).toBeFocused();
    await expect(alert).toContainText("Only public links can be downloaded.");
  });

  test("rate limited shows a countdown before retry", async ({ page }) => {
    await page.goto("/download");
    await submitUrl(page, "https://example.com/watch?mock=rate_limited");
    const alert = page.locator("[role=alert][data-error-code]");
    await expect(alert.getByRole("heading", { name: "You're going a bit fast" })).toBeVisible();
    await expect(alert).toContainText("Please wait 60 seconds");
    const retry = alert.getByRole("button", { name: /Try again in \d+s/ });
    await expect(retry).toBeDisabled();
  });

  test("live streams are refused with a friendly message", async ({ page }) => {
    await page.goto("/download");
    await submitUrl(page, "https://example.com/live/now");
    await expect(page.locator("[role=alert][data-error-code]")).toContainText("Live streams can't be downloaded");
  });

  test("rights-holder block links to the copyright page", async ({ page }) => {
    await page.goto("/download");
    await submitUrl(page, "https://example.com/watch?mock=blocked_by_rights_holder");
    await expect(
      page.locator("[role=alert][data-error-code]").getByRole("link", { name: "Learn about our copyright policy" }),
    ).toHaveAttribute("href", "/copyright");
  });

  test("client-side validation blocks bad links without calling the API", async ({ page }) => {
    await page.goto("/download");
    await submitUrl(page, "ftp://example.com/file");
    const input = page.getByLabel("Paste a link");
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByText("Only links starting with http:// or https:// are supported.")).toBeVisible();
    await expect(input).toBeFocused();
    await expect(page.getByTestId("result-skeleton")).toHaveCount(0);
  });

  test("hostile remote strings render as text and never execute", async ({ page }) => {
    let dialog = false;
    page.on("dialog", (d) => {
      dialog = true;
      void d.dismiss();
    });
    await page.goto("/download");
    await submitUrl(page, "https://example.com/watch?mock=xss");
    await expect(page.getByTestId("result-title")).toHaveText("<img src=x onerror=alert(1)>");
    await expect(page.getByText('<script>alert("uploader")</script>')).toBeVisible();
    await expect(page.locator("img[src^='javascript']")).toHaveCount(0);
    expect(dialog).toBe(false);
  });
});
