import { expect, test } from "./fixtures";

test("security headers and nonce CSP are sent", async ({ request }) => {
  const res = await request.get("/");
  const h = res.headers();
  const csp = h["content-security-policy"];
  expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic' https:\/\/challenges\.cloudflare\.com/);
  expect(csp).toContain("frame-src https://challenges.cloudflare.com");
  expect(csp).toContain("img-src 'self' blob: data: https:");
  expect(csp).toContain("connect-src 'self' http://localhost:8000");
  expect(csp).toContain("object-src 'none'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).not.toContain("unsafe-eval");
  expect(h["strict-transport-security"]).toContain("max-age=63072000");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["x-frame-options"]).toBe("DENY");
  expect(h["referrer-policy"]).toBe("no-referrer");
  expect(h["permissions-policy"]).toContain("camera=()");
  // A fresh nonce per request.
  const again = (await request.get("/")).headers()["content-security-policy"];
  expect(again).not.toBe(csp);
});

for (const [path, heading] of [
  ["/supported-sites", "Supported sites"],
  ["/copyright", "Copyright and takedown"],
  ["/terms", "Terms of use"],
  ["/privacy", "Privacy"],
  ["/how-it-works", "How VidNabbit works"],
] as const) {
  test(`${path} renders without horizontal scroll`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await expect(page.getByRole("contentinfo")).toContainText("does not host content");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
  });
}

test("legal pages are dated, have a contact and no draft text", async ({ page }) => {
  for (const path of ["/terms", "/privacy", "/copyright"]) {
    await page.goto(path);
    await expect(page.getByText(/Last updated: \d+ \w+ \d{4}/)).toBeVisible();
    await expect(page.getByRole("link", { name: "abuse@vidnabbit.com" }).first()).toBeVisible();
    await expect(page.getByText(/draft|placeholder/i)).toHaveCount(0);
  }
});

test("home has no horizontal scroll with a result shown", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Paste a link").fill("https://example.com/watch?v=1");
  await page.getByRole("button", { name: "Nab it" }).click();
  await expect(page.getByTestId("result-title")).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
});

test("takedown form validates and submits", async ({ page }) => {
  await page.goto("/copyright");
  await page.getByRole("button", { name: "Send request" }).click();
  await expect(page.getByText("Enter at least one link.")).toBeVisible();
  await expect(page.getByLabel("Links to remove (one per line)")).toBeFocused();

  await page.getByLabel("Links to remove (one per line)").fill("https://example.com/v/1\nhttps://example.com/v/2");
  await page.getByLabel("Your name").fill("Ada Rights");
  await page.getByLabel("Email").fill("not-an-email");
  await page.getByRole("button", { name: "Send request" }).click();
  await expect(page.getByText("Enter a valid email.")).toBeVisible();

  await page.getByLabel("Email").fill("ada@example.com");
  await page.getByLabel(/good-faith belief/).check();
  await page.getByLabel(/information in this request is accurate/).check();
  await page.getByLabel("Signature (type your full name)").fill("Ada Rights");
  await page.getByRole("button", { name: "Send request" }).click();
  await expect(page.getByRole("heading", { name: "Request received" })).toBeFocused();
});

test("mobile menu opens, closes with Escape and restores focus", async ({ page, isMobile }) => {
  test.skip(!isMobile, "menu only exists below 640px");
  await page.goto("/");
  const menu = page.getByRole("button", { name: "Menu" });
  await menu.click();
  await expect(menu).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("link", { name: "Supported sites" }).first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await expect(menu).toBeFocused();
});
