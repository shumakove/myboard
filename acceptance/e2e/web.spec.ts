// Приёмка T0.3 · каркас интерфейса: маршруты раздела 4 ARCHITECTURE.md открываются
// без ошибок, адреса API и WebSocket — только адрес страницы (раздел 10).
// Идентификаторы проверок — docs/qa/reports/T0.3.md (ARCH-WEB-*, ARCH-WEBNET-*).
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { apiUserLogin, createBoardUser } from "./user";

// Форма токена — 32 байта в URL-безопасной кодировке (43 символа) с `-` и `_`.
// Значения постоянные: имена тестов должны совпадать во всех воркерах Playwright.
const token = "qa-T0_3-".padEnd(43, "Zz9_-");
const boardId = "5b0c7e4a-1d2f-4c3b-9a8e-7f6d5c4b3a21";
const objectId = "0f1e2d3c-4b5a-4968-8776-655443322110";

const ROUTES = [
  "/login",
  "/",
  `/boards/${boardId}`,
  "/templates",
  `/t/${token}`,
  "/admin/login",
  "/admin/users",
  `/b/${token}`,
  `/b/${token}/embed`,
  `/b/${token}?object=${objectId}`,
];

interface Watch {
  problems: string[];
  sockets: string[];
  requests: string[];
}

/** Собирает ошибки консоли, исключения, упавшие запросы и все адреса запросов. */
function watch(page: Page): Watch {
  const w: Watch = { problems: [], sockets: [], requests: [] };
  page.on("console", (m) => {
    if (m.type() === "error") w.problems.push(`console.error: ${m.text()}`);
  });
  page.on("pageerror", (e) => w.problems.push(`pageerror: ${e.message}`));
  page.on("requestfailed", (r) => w.problems.push(`requestfailed: ${r.url()}`));
  page.on("response", (r) => {
    if (r.status() >= 400) w.problems.push(`${r.status()} ${r.url()}`);
  });
  page.on("request", (r) => w.requests.push(r.url()));
  page.on("websocket", (ws) => w.sockets.push(ws.url()));
  return w;
}

// Страницы пользователя досок без сессии: запрос к API получает `401`, и вкладка уходит
// на `/login` (ACC-03, ACC-05, с T2.1 — `/boards/{id}` запрашивает доску). Ответ `401`
// от `/api/*` и строка браузера «Failed to load resource … 401» — не ошибка приложения.
const USER_ROUTES = ["/", `/boards/${boardId}`, "/templates"];

function isAuthRejection(problem: string): boolean {
  return /^401 https?:\/\/[^/]+\/api\//.test(problem) || /status of 401 \(Unauthorized\)/.test(problem);
}

// С T3.1 страница `/b/{token}` спрашивает `GET /api/share/{token}`; для выдуманного токена
// стенда сервер отвечает отказом `404` (SHR-05), и браузер пишет «Failed to load resource … 404».
// Это требуемый отказ, а не ошибка приложения; другие ответы 404 по-прежнему считаются ошибкой.
function isLinkRejection(problem: string): boolean {
  return /^404 https?:\/\/[^/]+\/api\/share\//.test(problem);
}

function appProblems(w: Watch): string[] {
  const linkRefused = w.problems.some(isLinkRejection);
  return w.problems.filter(
    (p) =>
      !isAuthRejection(p) &&
      !isLinkRejection(p) &&
      !(linkRefused && /status of 404 \(Not Found\)/.test(p)),
  );
}

async function rootText(page: Page): Promise<string> {
  return (await page.locator("#root").innerText()).trim();
}

async function open(page: Page, path: string) {
  const response = await page.goto(path);
  await page.waitForLoadState("networkidle");
  return response;
}

for (const path of ROUTES) {
  test(`ARCH-WEB-01 ARCH-WEB-02 ARCH-WEB-08 ${path} открывается без ошибок, по-английски`, async ({
    page,
  }) => {
    const w = watch(page);
    const response = await open(page, path);
    expect(response?.status()).toBe(200);
    expect(response?.headers()["content-type"]).toContain("text/html");
    const text = await rootText(page);
    expect(text).not.toBe("");
    await expect(page.locator("#root")).toBeVisible();
    expect(text).not.toMatch(/[Ѐ-ӿ]/);
    expect(await page.locator("html").getAttribute("lang")).toBe("en");
    if (USER_ROUTES.includes(path)) {
      expect(new URL(page.url()).pathname).toBe("/login");
      expect(appProblems(w)).toEqual([]);
    } else if (path.startsWith("/b/") && !path.includes("/embed")) {
      await expect(page.getByText("This link is not available.")).toBeVisible();
      expect(appProblems(w)).toEqual([]);
    } else {
      expect(w.problems).toEqual([]);
    }
  });
}

test("ARCH-WEB-01 T2.1 signed-in user opens / and own /boards/{id} with no console errors", async ({
  boardUserPage: page,
}) => {
  const res = await page.request.post("/api/boards", { data: { title: "Own board" } });
  const own = (await res.json()) as { id: string };
  const w = watch(page);
  for (const path of ["/", `/boards/${own.id}`, "/templates"]) {
    await open(page, path);
    expect(new URL(page.url()).pathname).toBe(path);
    expect(await rootText(page)).not.toBe("");
  }
  expect(w.problems).toEqual([]);
});

test("ARCH-WEB-03 разные маршруты показывают разные страницы", async ({ page, browser, baseURL }) => {
  const texts = new Map<string, string>();
  for (const path of ROUTES) {
    await open(page, path);
    texts.set(path, await rootText(page));
  }
  // С T1.2 `/`, а с T1.4 и остальные страницы пользователя досок без сессии ведут
  // на `/login` (ACC-03, ACC-05), поэтому их смотрит вошедший пользователь досок —
  // назначение страниц по разделу 4.
  const userRoutes = ["/", `/boards/${boardId}`, "/templates"];
  const userCtx = await browser.newContext({ baseURL });
  await apiUserLogin(userCtx.request, await createBoardUser(browser, baseURL));
  const userPage = await userCtx.newPage();
  for (const path of userRoutes) {
    await open(page, path);
    expect(new URL(page.url()).pathname).toBe("/login");
    await open(userPage, path);
    expect(new URL(userPage.url()).pathname).toBe(path);
    texts.set(path, await rootText(userPage));
  }
  await userCtx.close();
  const objectRoute = ROUTES[ROUTES.length - 1]!;
  const distinct = ROUTES.filter((p) => p !== objectRoute);
  const unique = new Set(distinct.map((p) => texts.get(p)));
  expect(unique.size).toBe(distinct.length);
  // Ссылка на объект — та же страница участника, что и /b/{token}.
  expect(texts.get(objectRoute)).toBe(texts.get(`/b/${token}`));
  // Неизвестный путь не совпадает ни с одной страницей раздела 4.
  await open(page, "/no-such-page");
  expect(unique.has(await rootText(page))).toBe(false);
});

test("ARCH-WEB-04 переход между маршрутами без перезагрузки и «назад»", async ({ page }) => {
  const direct = new Map<string, string>();
  for (const path of ROUTES) {
    await open(page, path);
    direct.set(path, await rootText(page));
  }
  const w = watch(page);
  await open(page, "/login");
  // Метка в window пропадёт, если документ перезагрузится.
  await page.evaluate(() => ((window as unknown as { qaMark: number }).qaMark = 1));
  for (const path of ROUTES) {
    await page.evaluate((p) => {
      history.pushState(null, "", p);
      dispatchEvent(new PopStateEvent("popstate"));
    }, path);
    await expect.poll(() => rootText(page)).toBe(direct.get(path));
  }
  await page.goBack();
  await expect.poll(() => rootText(page)).toBe(direct.get(ROUTES[ROUTES.length - 2]!));
  await page.goBack();
  await expect.poll(() => rootText(page)).toBe(direct.get(ROUTES[ROUTES.length - 3]!));
  expect(appProblems(w)).toEqual([]);
  expect(await page.evaluate(() => (window as unknown as { qaMark?: number }).qaMark)).toBe(1);
});

for (const path of [
  "/login/",
  `/b/${token}/`,
  `/boards/${encodeURIComponent("any id-_.~")}`,
  `/t/${"A".repeat(43)}`,
  `/b/${token}?object=`,
]) {
  test(`ARCH-WEB-05 граничный путь ${path} открывается без ошибок`, async ({ page }) => {
    const w = watch(page);
    const response = await open(page, path);
    expect(response?.status()).toBe(200);
    expect(await rootText(page)).not.toBe("");
    if (path.startsWith("/boards/")) {
      expect(new URL(page.url()).pathname).toBe("/login");
      expect(appProblems(w)).toEqual([]);
    } else if (path.startsWith("/b/") && !path.includes("/embed")) {
      await expect(page.getByText("This link is not available.")).toBeVisible();
      expect(appProblems(w)).toEqual([]);
    } else {
      expect(w.problems).toEqual([]);
    }
  });
}

for (const path of ["/no-such-page", "/boards", "/b/", "/admin", `/b/${token}/embed/extra`]) {
  test(`ARCH-WEB-06 неизвестный путь ${path} не роняет приложение`, async ({ page }) => {
    const w = watch(page);
    const response = await open(page, path);
    expect(response?.status()).toBe(200);
    expect(await rootText(page)).not.toBe("");
    expect(w.problems).toEqual([]);
  });
}

test("ARCH-WEBNET-02 ARCH-WEBNET-03 запросы и сокеты идут только на адрес страницы", async ({
  page,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  const wsOrigin = origin.replace(/^http/, "ws");
  const w = watch(page);
  for (const path of ROUTES) await open(page, path);
  const foreign = w.requests.filter((u) => !u.startsWith(origin + "/"));
  expect(foreign).toEqual([]);
  const apiOutsidePrefix = w.requests
    .map((u) => new URL(u).pathname)
    .filter((p) => p.includes("/api") && !p.startsWith("/api/"));
  expect(apiOutsidePrefix).toEqual([]);
  // Сокет, если страница его открывает, — только `ws(s)://<хост страницы>/api/ws`.
  for (const url of w.sockets) expect(url.startsWith(`${wsOrigin}/api/ws`)).toBe(true);
});

test("ARCH-WEB-09 /b/{token}/embed во внешнем фрейме отрисовывает приложение", async ({
  page,
  baseURL,
}) => {
  const src = new URL(`/b/${token}/embed`, baseURL).toString();
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(`<!doctype html><iframe src="${src}" width="600" height="400"></iframe>`);
  });
  await new Promise<void>((resolve) => server.listen(0, "0.0.0.0", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await page.goto(`http://${new URL(baseURL!).hostname}:${port}/`);
    const frame = page.frameLocator("iframe");
    await expect(frame.locator("#root")).not.toBeEmpty();
    expect((await frame.locator("#root").innerText()).trim()).not.toBe("");
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
