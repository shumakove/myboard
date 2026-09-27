// Приёмка T0.1 · стек Docker Compose: показ во фрейме чужой страницы (ARCHITECTURE.md, 12)
// и загрузка интерфейса по PUBLIC_BASE_URL (ARCHITECTURE.md, 11).
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";

const token = "Q".repeat(43);

// Чужое происхождение — страница-хозяин на том же IP машины, но на другом порту
// (другой origin в той же частной сети, чтобы Chrome не резал фрейм по Private Network Access).
async function withOuterPage<T>(
  baseURL: string,
  src: string,
  run: (outerUrl: string) => Promise<T>,
) {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(
      `<!doctype html><html><body><iframe id="f" src="${src}" width="400" height="300"></iframe></body></html>`,
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "0.0.0.0", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    return await run(`http://${new URL(baseURL).hostname}:${port}/host.html`);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

async function framedDocument(page: Page, baseURL: string, path: string) {
  const src = new URL(path, baseURL).toString();
  return withOuterPage(baseURL, src, async (outerUrl) => {
    const loaded = page.waitForEvent(
      "framenavigated",
      (f) => f !== page.mainFrame(),
    );
    await page.goto(outerUrl);
    await loaded;
    await page.waitForTimeout(500);
    const frame = page.frames().find((f) => f !== page.mainFrame())!;
    // Заблокированный фрейм браузер заменяет страницей ошибки, документ SPA не загружается.
    try {
      return { url: frame.url(), title: await frame.title() };
    } catch {
      return { url: frame.url(), title: "" };
    }
  });
}

test("ARCH-NET-06 интерфейс открывается по PUBLIC_BASE_URL без ошибок загрузки", async ({
  page,
}) => {
  const failed: string[] = [];
  page.on("requestfailed", (r) => failed.push(r.url()));
  page.on("response", (r) => {
    if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`);
  });
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await page.waitForLoadState("networkidle");
  expect(failed).toEqual([]);
});

test("ARCH-FRAME-07 главная не показывается в чужом фрейме", async ({
  page,
  baseURL,
}) => {
  const doc = await framedDocument(page, baseURL!, "/");
  expect(doc.url.startsWith(baseURL!) && doc.title !== "").toBe(false);
});

test("ARCH-FRAME-07 страница участника /b/{token} не показывается в чужом фрейме", async ({
  page,
  baseURL,
}) => {
  const doc = await framedDocument(page, baseURL!, `/b/${token}`);
  expect(doc.url.startsWith(baseURL!) && doc.title !== "").toBe(false);
});

test("ARCH-FRAME-07 /b/{token}/embed показывается в чужом фрейме", async ({
  page,
  baseURL,
}) => {
  const doc = await framedDocument(page, baseURL!, `/b/${token}/embed`);
  expect(doc.url).toBe(new URL(`/b/${token}/embed`, baseURL).toString());
  expect(doc.title).not.toBe("");
});
