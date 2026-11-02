import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBoardDocument } from "../realtime/boardDocument";
import { createEmbed, createLinkCard, setObjectLink } from "./embeds";
import { createObject, objectMap } from "./sceneObjects";
import { click, element, object, renderScene, scene } from "./testScene";

// T7.3: встраивание и ссылки через интерфейс сцены (EMB-01…EMB-03); сеть — двойник fetch.

const MEDIA = "0f8b1c3e-9a6d-4e2b-8c1f-2a3b4c5d6e7f";

function pasteText(text: string) {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: {
      files: [],
      getData: (type: string) => (type === "text/plain" ? text : ""),
    },
  });
  act(() => {
    document.body.dispatchEvent(event);
  });
  return event;
}

async function chooseTool(name: string) {
  const user = userEvent.setup();
  await user.click(
    within(screen.getByRole("toolbar", { name: "Tools" })).getByRole("button", {
      name: /^All tools/,
    }),
  );
  await user.click(
    within(screen.getByRole("dialog", { name: "All tools" })).getByRole(
      "button",
      { name },
    ),
  );
  return user;
}

function frame(id: string): HTMLIFrameElement {
  const found = element(id).querySelector("iframe");
  if (found === null) throw new Error("нет фрейма");
  return found;
}

describe("EMB-01: встроенная страница", () => {
  it("с панели: код из диалога ставит объект с адресом и размером из кода", async () => {
    const { board } = renderScene();
    const user = await chooseTool("Embed");
    const dialog = screen.getByRole("dialog", { name: "Embed" });

    fireEvent.change(within(dialog).getByLabelText("Iframe code"), {
      target: {
        value:
          '<iframe src="https://video.test/e/1" width="640" height="400"></iframe>',
      },
    });
    await user.click(within(dialog).getByRole("button", { name: "Add embed" }));

    const [embed] = scene(board);
    expect(embed?.type).toBe("iframe");
    expect(embed?.embed?.src).toBe("https://video.test/e/1");
    expect([embed?.width, embed?.height]).toEqual([640, 400]);
    expect(screen.queryByRole("dialog", { name: "Embed" })).toBeNull();
    // Новый объект выделен.
    expect(element(embed?.id ?? "")).toHaveAttribute("aria-selected", "true");
    expect(frame(embed?.id ?? "")).toHaveAttribute(
      "src",
      "https://video.test/e/1",
    );
  });

  it("с панели: негодный код не ставит объект и объясняет, что нужно", async () => {
    const { board } = renderScene();
    const user = await chooseTool("Embed");
    const dialog = screen.getByRole("dialog", { name: "Embed" });

    fireEvent.change(within(dialog).getByLabelText("Iframe code"), {
      target: { value: '<iframe src="javascript:alert(1)"></iframe>' },
    });
    await user.click(within(dialog).getByRole("button", { name: "Add embed" }));

    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "Paste an iframe code",
    );
    expect(scene(board)).toHaveLength(0);
  });

  it("из буфера: код iframe становится объектом, а не текстом", () => {
    const { board } = renderScene();

    const event = pasteText('<iframe src="https://a.test/x"></iframe>');

    expect(event.defaultPrevented).toBe(true);
    const [embed] = scene(board);
    expect(embed?.type).toBe("iframe");
    expect(embed?.embed?.src).toBe("https://a.test/x");
    expect([embed?.width, embed?.height]).toEqual([560, 360]);
  });

  it("из буфера: опасный код и простой текст остаются текстом (CVS-09)", () => {
    const { board } = renderScene();

    pasteText('<iframe src="javascript:alert(1)"></iframe>');
    pasteText("just text");

    expect(scene(board).map((o) => o.type)).toEqual(["text", "text"]);
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("фрейм ограничен: нет перехода вкладки доски, адрес доски не передаётся", () => {
    const board = createBoardDocument();
    const id = createEmbed(
      board.objects,
      { x: 0, y: 0 },
      { src: "https://a.test/", width: null, height: null },
      "Alice",
    );
    renderScene(board);

    const sandbox = frame(id).getAttribute("sandbox") ?? "";
    expect(sandbox).toContain("allow-scripts");
    expect(sandbox).not.toContain("allow-top-navigation");
    expect(frame(id)).toHaveAttribute("referrerpolicy", "no-referrer");
  });

  it("адрес, записанный в документ мимо интерфейса, в фрейм не попадает", () => {
    const board = createBoardDocument();
    const id = createEmbed(
      board.objects,
      { x: 0, y: 0 },
      { src: "https://a.test/", width: null, height: null },
      "Alice",
    );
    objectMap(board.objects, id)?.set("src", "javascript:alert(1)");
    renderScene(board);

    expect(element(id).querySelector("iframe")).toBeNull();
    expect(element(id)).toHaveTextContent("This embed has no valid address.");
  });

  it("Interact включает работу со страницей до нажатия вне объекта", async () => {
    const board = createBoardDocument();
    const id = createEmbed(
      board.objects,
      { x: 0, y: 0 },
      { src: "https://a.test/", width: null, height: null },
      "Alice",
    );
    renderScene(board);
    const user = userEvent.setup();
    const shell = () => element(id).querySelector(".embed-object");

    expect(shell()).toHaveAttribute("data-live", "false");
    await user.click(
      within(element(id)).getByRole("button", { name: "Interact" }),
    );
    expect(shell()).toHaveAttribute("data-live", "true");
    expect(
      within(element(id)).getByRole("button", { name: "Stop interacting" }),
    ).toHaveAttribute("aria-pressed", "true");

    fireEvent.pointerDown(document.body);
    expect(shell()).toHaveAttribute("data-live", "false");
  });

  it("объект двигают за него самого, как любой другой (CVS-12)", () => {
    const board = createBoardDocument();
    const id = createEmbed(
      board.objects,
      { x: 0, y: 0 },
      { src: "https://a.test/", width: null, height: null },
      "Alice",
    );
    renderScene(board);

    click(element(id), [10, 10]);

    expect(element(id)).toHaveAttribute("aria-selected", "true");
  });
});

describe("EMB-02: карточка ссылки", () => {
  let requests: { url: string; body: string }[];
  let answer: () => Response;

  beforeEach(() => {
    requests = [];
    answer = () =>
      Response.json({
        url: "https://news.test/a",
        title: "Big news",
        image: {
          id: MEDIA,
          name: "link-preview",
          mime: "image/png",
          size: 4,
          url: `/api/media/${MEDIA}`,
        },
      });
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init: RequestInit) => {
        requests.push({ url, body: init.body as string });
        return Promise.resolve(answer());
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function addCard(address: string) {
    const user = await chooseTool("Link card");
    const dialog = screen.getByRole("dialog", { name: "Link card" });
    await user.type(within(dialog).getByLabelText("Page address"), address);
    await user.click(within(dialog).getByRole("button", { name: "Add card" }));
    return dialog;
  }

  it("показывает название и изображение страницы и ведёт по адресу", async () => {
    const { board } = renderScene();

    await addCard("news.test/a");

    await waitFor(() => {
      expect(scene(board)).toHaveLength(1);
    });
    expect(requests).toEqual([
      {
        url: "/api/boards/test-board/link-preview",
        body: JSON.stringify({ url: "https://news.test/a" }),
      },
    ]);
    const [card] = scene(board);
    expect(card?.type).toBe("linkcard");
    expect(card?.text).toBe("Big news");
    const link = within(element(card?.id ?? "")).getByRole("link", {
      name: "Big news",
    });
    expect(link).toHaveAttribute("href", "https://news.test/a");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(element(card?.id ?? "").querySelector("img")).toHaveAttribute(
      "src",
      `/api/media/${MEDIA}`,
    );
    expect(screen.queryByRole("dialog", { name: "Link card" })).toBeNull();
  });

  it("страница ничего не отдала: карточка с адресом вместо названия, без картинки", async () => {
    answer = () =>
      Response.json({ url: "https://news.test/", title: null, image: null });
    const { board } = renderScene();

    await addCard("https://news.test/");

    await waitFor(() => {
      expect(scene(board)).toHaveLength(1);
    });
    const [card] = scene(board);
    expect(card?.height).toBe(96);
    expect(
      within(element(card?.id ?? "")).getByRole("link", { name: "news.test" }),
    ).toHaveAttribute("href", "https://news.test/");
    expect(element(card?.id ?? "").querySelector("img")).toBeNull();
  });

  it("негодный адрес на сервер не уходит", async () => {
    const { board } = renderScene();

    const dialog = await addCard("javascript:alert(1)");

    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "Enter an http or https address.",
    );
    expect(requests).toHaveLength(0);
    expect(scene(board)).toHaveLength(0);
  });

  it("нет доступа к доске: объяснение, объекта нет", async () => {
    answer = () => new Response("{}", { status: 404 });
    const { board } = renderScene();

    const dialog = await addCard("news.test");

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "You no longer have access to this board.",
    );
    expect(scene(board)).toHaveLength(0);
  });

  it("у заблокированной карточки адрес открывается, а объект не двигается", () => {
    const board = createBoardDocument();
    const id = createLinkCard(
      board.objects,
      { x: 0, y: 0 },
      { url: "https://news.test/a", title: "Big news", media: null },
      "Alice",
    );
    objectMap(board.objects, id)?.set("locked", true);
    renderScene(board);

    const link = within(element(id)).getByRole("link", { name: "Big news" });

    expect(link).toHaveAttribute("href", "https://news.test/a");
    // Нажатия ссылки холст не перехватывает: браузер открывает адрес сам.
    expect(link).toHaveAttribute("data-canvas-ignore");
    const before = object(board, id);
    click(link, [10, 10]);
    expect([object(board, id).x, object(board, id).y]).toEqual([
      before.x,
      before.y,
    ]);
  });

  it("адрес, записанный в документ мимо интерфейса, ссылкой не становится", () => {
    const board = createBoardDocument();
    const id = createLinkCard(
      board.objects,
      { x: 0, y: 0 },
      { url: "https://news.test/a", title: "Big news", media: null },
      "Alice",
    );
    objectMap(board.objects, id)?.set("url", "javascript:alert(1)");
    renderScene(board);

    expect(within(element(id)).queryByRole("link")).toBeNull();
    expect(element(id)).toHaveTextContent("Big news");
  });

  it("CVS-08: название — текст объекта, по которому ищет поиск", () => {
    const board = createBoardDocument();
    createLinkCard(
      board.objects,
      { x: 0, y: 0 },
      { url: "https://news.test/a", title: "Big news", media: null },
      "Alice",
    );
    expect(scene(board)[0]?.text).toBe("Big news");
  });
});

describe("EMB-03: ссылка у объекта", () => {
  function sticky(board: ReturnType<typeof createBoardDocument>, text = "A") {
    return createObject(board.objects, "sticky", { x: 0, y: 0 }, text, "Alice");
  }

  async function openLinkPanel(id: string) {
    click(element(id), [10, 10]);
    const user = userEvent.setup();
    const bar = screen.getByRole("toolbar", { name: "Selection" });
    await user.click(within(bar).getByRole("button", { name: "Link" }));
    return {
      user,
      panel: within(within(bar).getByRole("group", { name: "Link" })),
    };
  }

  it("внешний адрес: значок открывает его, виден всем (в документе)", async () => {
    const board = createBoardDocument();
    const id = sticky(board);
    renderScene(board);

    const { user, panel } = await openLinkPanel(id);
    await user.type(panel.getByLabelText("Link address"), "example.com/x");
    await user.click(panel.getByRole("button", { name: "Attach link" }));

    expect(object(board, id).link).toEqual({
      kind: "url",
      url: "https://example.com/x",
    });
    const badge = within(element(id)).getByRole("link", { name: "Open link" });
    expect(badge).toHaveAttribute("href", "https://example.com/x");
    expect(badge).toHaveAttribute("target", "_blank");
    expect(badge.getAttribute("rel")).toContain("noopener");
  });

  it("негодный адрес не записывается", async () => {
    const board = createBoardDocument();
    const id = sticky(board);
    renderScene(board);

    const { user, panel } = await openLinkPanel(id);
    await user.type(
      panel.getByLabelText("Link address"),
      "javascript:alert(1)",
    );
    await user.click(panel.getByRole("button", { name: "Attach link" }));

    expect(panel.getByRole("alert")).toHaveTextContent(
      "Enter an http or https address.",
    );
    expect(object(board, id).link).toBeNull();
  });

  it("ссылка на объект этой доски переносит вид к нему и выделяет его", async () => {
    const board = createBoardDocument();
    const id = sticky(board);
    const target = createObject(
      board.objects,
      "sticky",
      { x: 3000, y: 1000 },
      "Target",
      "Alice",
    );
    const { camera } = renderScene(board);

    const { user, panel } = await openLinkPanel(id);
    await user.type(
      panel.getByLabelText("Link address"),
      `${window.location.origin}/b/tok?object=${target}`,
    );
    await user.click(panel.getByRole("button", { name: "Attach link" }));
    expect(object(board, id).link).toEqual({ kind: "object", id: target });

    await user.click(
      within(element(id)).getByRole("button", { name: "Go to linked object" }),
    );

    expect(camera().x).toBe(3100);
    expect(camera().y).toBe(1100);
    expect(element(target)).toHaveAttribute("aria-selected", "true");
  });

  it("объект выбирают из списка объектов доски", async () => {
    const board = createBoardDocument();
    const id = sticky(board);
    const target = sticky(board, "Target");
    renderScene(board);

    const { user, panel } = await openLinkPanel(id);
    await user.click(panel.getByRole("button", { name: "Link to object" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: /Target/,
      }),
    );

    expect(object(board, id).link).toEqual({ kind: "object", id: target });
  });

  it("объекта по ссылке больше нет: вид на месте и сообщение", async () => {
    const board = createBoardDocument();
    const id = sticky(board);
    setObjectLink(board.objects, id, { kind: "object", id: "gone" }, "Alice");
    const { camera } = renderScene(board);
    const before = camera();
    const user = userEvent.setup();

    await user.click(
      within(element(id)).getByRole("button", { name: "Go to linked object" }),
    );

    expect(camera()).toEqual(before);
    expect(
      screen.getByText("The linked object is not on this board."),
    ).toBeInTheDocument();
  });

  it("ссылку убирают", async () => {
    const board = createBoardDocument();
    const id = sticky(board);
    setObjectLink(
      board.objects,
      id,
      { kind: "url", url: "https://a.test/" },
      "Bob",
    );
    renderScene(board);

    const { user, panel } = await openLinkPanel(id);
    await user.click(panel.getByRole("button", { name: "Remove link" }));

    expect(object(board, id).link).toBeNull();
    expect(within(element(id)).queryByRole("link")).toBeNull();
  });

  it("CVS-19: у заблокированного объекта ссылка работает, но не меняется", () => {
    const board = createBoardDocument();
    const id = sticky(board);
    setObjectLink(
      board.objects,
      id,
      { kind: "url", url: "https://a.test/" },
      "Alice",
    );
    objectMap(board.objects, id)?.set("locked", true);
    renderScene(board);

    click(element(id), [10, 10]);

    expect(
      within(element(id)).getByRole("link", { name: "Open link" }),
    ).toHaveAttribute("href", "https://a.test/");
    expect(
      within(screen.getByRole("toolbar", { name: "Selection" })).queryByRole(
        "button",
        { name: "Link" },
      ),
    ).toBeNull();
  });

  it("опасная ссылка из документа значком не становится", () => {
    const board = createBoardDocument();
    const id = sticky(board);
    objectMap(board.objects, id)?.set("link", "javascript:alert(1)");
    renderScene(board);

    expect(within(element(id)).queryByRole("link")).toBeNull();
    expect(object(board, id).link).toBeNull();
  });

  it("CVS-22: прикрепление ссылки — правка объекта с отметкой автора", () => {
    const board = createBoardDocument();
    const id = sticky(board);
    setObjectLink(
      board.objects,
      id,
      { kind: "url", url: "https://a.test/" },
      "Bob",
    );
    expect(object(board, id).meta.updatedBy).toBe("Bob");
  });
});
