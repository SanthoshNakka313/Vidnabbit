import { expect, submitUrl, test } from "./fixtures";

test.describe("download flow (mock API)", () => {
  test("paste → extract → choose format → progress → done", async ({ page, context, browserName }) => {
    test.skip(browserName !== "chromium", "clipboard permissions are Chromium-only");
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/download");

    // No Turnstile before a download starts.
    await expect(page.getByTestId("turnstile")).toHaveCount(0);

    await page.evaluate(() => navigator.clipboard.writeText("https://example.com/watch?v=bunny"));
    await page.getByRole("button", { name: "Paste" }).click();

    // Paste fills the field and submits automatically.
    await expect(page.getByLabel("Paste a link")).toHaveValue("https://example.com/watch?v=bunny");
    await expect(page.getByTestId("result-skeleton")).toBeVisible();

    // Focus moves to the result heading; remote title is literal text.
    const title = page.getByTestId("result-title");
    await expect(title).toHaveText("Big Buck Bunny <b>4K</b> & friends: open movie trailer");
    await expect(title).toBeFocused();
    await expect(page.getByTestId("live-region")).toContainText("Found: Big Buck Bunny");

    // Thumbnail is a plain remote <img> without a referrer.
    const img = page.locator("img[referrerpolicy='no-referrer']");
    await expect(img).toHaveAttribute("src", /^https:\/\//);

    // Groups and the recommended preset.
    await expect(page.getByRole("group", { name: "Video" })).toBeVisible();
    await expect(page.getByRole("group", { name: "Audio" })).toBeVisible();
    await expect(page.getByRole("radio", { name: /1080p · MP4/ })).toBeChecked();
    await expect(page.getByText("Recommended").first()).toBeVisible();

    // Hidden formats behind the disclosure.
    await expect(page.getByRole("radio", { name: /WebM/ })).toHaveCount(0);
    await page.getByRole("button", { name: "Show all 7 formats" }).click();
    await expect(page.getByRole("radio", { name: /WebM/ })).toBeVisible();

    // Choose 720p and start.
    await page.getByRole("radio", { name: /720p · MP4/ }).check();
    await expect(page.getByTestId("copyright-notice")).toContainText(
      "Only download content you own or have permission to use.",
    );
    await page.getByRole("button", { name: /Download 720p · MP4 · ~64.2 MB/ }).click();

    // Turnstile renders only now, then the job runs.
    await expect(page.getByTestId("turnstile-stub")).toBeVisible();
    const bar = page.getByRole("progressbar");
    await expect(bar).toBeVisible();
    await expect(bar).toHaveAttribute("aria-valuenow", /^\d+$/, { timeout: 5000 });
    await expect(page.getByTestId("live-region")).toContainText("%");

    // Done.
    const save = page.getByRole("link", { name: "Save file" });
    await expect(save).toBeVisible({ timeout: 15_000 });
    await expect(save).toBeFocused();
    await expect(save).toHaveAttribute("href", /\/mock\/vidnabbit-sample\.txt$/);
    await expect(page.getByText("Expires in 1 hour")).toBeVisible();
    await expect(page.getByTestId("job-done").getByTestId("copyright-notice")).toBeVisible();
    await expect(page.getByTestId("live-region")).toHaveText("Your file is ready");

    // Paste a new link resets and focuses the input.
    await page.getByRole("button", { name: "Paste a new link" }).click();
    await expect(page.getByLabel("Paste a link")).toBeFocused();
    await expect(page.getByLabel("Paste a link")).toHaveValue("");
  });

  test("keyboard only: submit with Enter and download", async ({ page }) => {
    await page.goto("/download");
    await page.getByLabel("Paste a link").focus();
    await page.keyboard.type("example.com/podcast/episode-1");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("result-title")).toBeFocused();
    await expect(page.getByRole("radio", { name: /MP3/ })).toBeChecked();
    await page.getByRole("button", { name: /Download Audio · MP3/ }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("link", { name: "Save file" })).toBeFocused({ timeout: 15_000 });
  });

  test("cancel during progress returns to the format list", async ({ page }) => {
    await page.goto("/download");
    await submitUrl(page, "https://example.com/watch?v=1");
    await page.getByRole("button", { name: /^Download/ }).click();
    await expect(page.getByRole("progressbar")).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("progressbar")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Download 1080p/ })).toBeEnabled();
  });

  test("server asks for a bot check before extracting", async ({ page }) => {
    await page.goto("/download");
    await submitUrl(page, "https://example.com/watch?mock=extract_challenge");
    await expect(page.getByRole("heading", { name: "Quick check needed" })).toBeVisible();
    await expect(page.getByTestId("turnstile-stub")).toBeVisible();
    await expect(page.getByTestId("result-title")).toBeVisible();
  });

  test("job failure shows an error with a retry", async ({ page }) => {
    await page.goto("/download");
    await submitUrl(page, "https://example.com/watch?mock=job_failed");
    await page.getByRole("button", { name: /^Download/ }).click();
    const alert = page.locator("[role=alert][data-error-code]");
    await expect(alert).toContainText("didn't respond properly", { timeout: 15_000 });
    await expect(alert.getByRole("heading")).toBeFocused();
    await expect(alert.getByRole("button", { name: "Try again" })).toBeVisible();
  });

  test("rejected job token: Try the check again recovers", async ({ page }) => {
    await page.goto("/download");
    await submitUrl(page, "https://example.com/watch?mock=challenge_required");
    await page.getByRole("button", { name: /^Download/ }).click();
    await expect(page.locator("[role=alert][data-error-code]")).toContainText("Quick check needed");
    await page.getByRole("button", { name: "Try the check again" }).click();
    await expect(page.getByRole("link", { name: "Save file" })).toBeVisible({ timeout: 15_000 });
  });
});
