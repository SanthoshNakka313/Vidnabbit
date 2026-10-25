import { test as base, expect, type Page } from "@playwright/test";

/**
 * Replaces the Cloudflare Turnstile script with a stub that immediately
 * passes, so e2e runs offline. The real script is loaded the same way
 * (injected by our bundle under the nonce/strict-dynamic CSP).
 */
const TURNSTILE_STUB = `
  window.turnstile = {
    render: function (el, opts) {
      var box = document.createElement("div");
      box.setAttribute("data-testid", "turnstile-stub");
      box.textContent = "Turnstile (test stub)";
      el.appendChild(box);
      setTimeout(function () { opts.callback("e2e-token"); }, 150);
      return "stub-widget";
    },
    remove: function () {},
  };
`;

export async function stubTurnstile(page: Page) {
  await page.route("https://challenges.cloudflare.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/javascript", body: TURNSTILE_STUB }),
  );
}

export const test = base.extend({
  page: async ({ page }, provide) => {
    await stubTurnstile(page);
    await provide(page);
  },
});

export { expect };

export async function submitUrl(page: Page, url: string) {
  await page.getByLabel("Paste a link").fill(url);
  await page.getByRole("button", { name: "Nab it" }).click();
}
