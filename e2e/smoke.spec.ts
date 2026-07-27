import { expect, test, type Page } from "@playwright/test";

const users = {
  admin: {
    username: "admin",
    password: "test",
    role: "admin",
    firstName: "Admin",
    lastName: "BeTrack",
    name: "Admin BeTrack",
    companyId: null,
  },
  finance: {
    username: "test.finance",
    password: "test",
    role: "finance",
    firstName: "Sophie",
    lastName: "Dubois",
    name: "Sophie Dubois",
    companyId: "c1",
  },
  cto: {
    username: "test.cto",
    password: "test",
    role: "cto",
    firstName: "Jean",
    lastName: "Dupont",
    name: "Jean Dupont",
    companyId: "c1",
  },
} as const;

async function loginAs(page: Page, user: (typeof users)[keyof typeof users]) {
  await page.addInitScript(
    (session) => localStorage.setItem("betrack_user", JSON.stringify(session)),
    user
  );
}

async function expectNoPageOverflow(page: Page) {
  const sizes = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(sizes.scroll).toBeLessThanOrEqual(sizes.client + 1);
}

test("login routes finance directly to its first authorized page", async ({ page }) => {
  await page.goto("/login");
  await page.getByPlaceholder("test.cto").fill("test.finance");
  await page.locator('input[type="password"]').fill("test");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/finance$/);
});

test("admin company detail exposes both hierarchy builders", async ({ page }) => {
  await loginAs(page, users.admin);
  await page.goto("/admin/companies/detail?id=c1");
  await expect(page.getByRole("button", { name: /Arborescence financière/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Arborescence géographique/ })).toBeVisible();
  await page.getByRole("button", { name: /Arborescence financière/ }).click();
  await expect(page.getByText("Aperçu live de l'arborescence")).toBeVisible();
  await expectNoPageOverflow(page);
});

test("unsaved hierarchy levels cannot create ghost values", async ({ page }) => {
  await loginAs(page, users.admin);
  await page.goto("/admin/companies/detail?id=c1");
  await page.getByRole("button", { name: /Arborescence financière/ }).click();
  await page.getByRole("button", { name: "Ajouter un niveau" }).click();
  await expect(page.getByText(/Enregistrez d'abord la structure/)).toBeVisible();
  await expect(page.getByRole("button", { name: /^Ajouter$/ }).last()).toBeDisabled();
  await expect(page.getByRole("button", { name: "Enregistrer la structure" })).toBeEnabled();
});

test("finance page renders configured P&L container without mobile overflow", async ({ page }) => {
  await loginAs(page, users.finance);
  await page.goto("/finance");
  await expect(page.getByText("Compte de résultat configuré")).toBeVisible();
  await expectNoPageOverflow(page);
});

test("dashboard widgets stay inside the mobile viewport", async ({ page }) => {
  await loginAs(page, users.cto);
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: /Tableau de bord exécutif/i })).toBeVisible();
  await expectNoPageOverflow(page);
});
