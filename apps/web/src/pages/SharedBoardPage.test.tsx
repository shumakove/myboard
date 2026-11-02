import {
  act,
  fireEvent,
  waitFor,
  render,
  screen,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { board } from "../library/fakeLibraryServer";
import { installFakeSharingServer } from "../sharing/fakeSharingServer";
import { FakeBoardServer, FakeSocket } from "../realtime/fakeSocket";
import { AppRoutes } from "../routes";
import { createObject } from "../scene/sceneObjects";

function openAt(path: string) {
  const location = memoryLocation({ path, record: true });
  render(
    <Router hook={location.hook} searchHook={location.searchHook}>
      <AppRoutes />
    </Router>,
  );
  return location;
}

/** Браузер без учётной записи: сессии пользователя досок нет. */
function guestServer(participants: Record<string, string> = {}) {
  return installFakeSharingServer({
    signedIn: false,
    boards: [board("b-1", "Roadmap")],
    links: { "b-1": "tok-1" },
    participants,
  });
}

describe("/b/{token} — вход по ссылке (SHR-02, SHR-03, SHR-05)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("SHR-03: запрашивает имя, затем пускает на доску без учётной записи", async () => {
    const server = guestServer();
    const location = openAt("/b/tok-1");
    const user = userEvent.setup();

    expect(
      await screen.findByRole("heading", { level: 1, name: "Roadmap" }),
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText("Your name"), "  Kate ");
    await user.click(screen.getByRole("button", { name: "Join board" }));

    expect(await screen.findByText("You joined as Kate.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Your name")).toBeNull();
    // Участник остаётся на странице ссылки и не трогает вход и список досок.
    expect(location.history.at(-1)).toBe("/b/tok-1");
    const paths = server.library.account.calls.map((c) => c.path);
    expect(paths).toEqual(["/api/share/tok-1", "/api/share/tok-1/join"]);
  });

  it("SHR-03: пустое имя не отправляется", async () => {
    const server = guestServer();
    openAt("/b/tok-1");
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Join board" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Enter your name.");
    expect(
      server.library.account.calls.filter((c) => c.method === "POST"),
    ).toEqual([]);
  });

  it("SHR-02: уже введённое на этой доске имя не спрашивается повторно", async () => {
    guestServer({ "tok-1": "Kate" });
    openAt("/b/tok-1");

    expect(await screen.findByText("You joined as Kate.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Your name")).toBeNull();
  });

  it.each(["unknown-token", "tok-old"])(
    "SHR-05: недействующая ссылка %s — отказ без формы имени",
    async (token) => {
      guestServer();
      openAt(`/b/${token}`);

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "This link is not available.",
      );
      expect(
        screen.getByRole("heading", { level: 1, name: "Board unavailable" }),
      ).toBeInTheDocument();
      expect(screen.queryByLabelText("Your name")).toBeNull();
      expect(screen.queryByText("Roadmap")).toBeNull();
    },
  );

  it("SHR-06: ссылку сбросили, пока вводилось имя — тот же отказ", async () => {
    const server = guestServer();
    openAt("/b/tok-1");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Your name"), "Kate");

    server.links["b-1"] = "tok-2";
    await user.click(screen.getByRole("button", { name: "Join board" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This link is not available.",
    );
    expect(screen.queryByText("Roadmap")).toBeNull();
  });

  it("сбой сети показывает повторяемую ошибку", async () => {
    const server = guestServer();
    server.library.account.offline = true;
    openAt("/b/tok-1");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Network error. Try again.",
    );
  });

  it("SHR-04: участник открывает канал документа по токену ссылки", async () => {
    guestServer({ "tok-1": "Kate" });
    openAt("/b/tok-1");

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Connecting to the board…",
    );
    const socket = FakeSocket.last();
    expect(socket.url).toBe(`ws://${window.location.host}/api/ws?token=tok-1`);
    act(() => {
      new FakeBoardServer().accept(socket);
    });
    expect(screen.getByRole("status")).toHaveTextContent("Live:");
  });

  it("SHR-06: после сброса ссылки открытая доска закрывается с отказом", async () => {
    const server = guestServer({ "tok-1": "Kate" });
    openAt("/b/tok-1");
    await screen.findByRole("status");
    const socket = FakeSocket.last();
    act(() => {
      new FakeBoardServer().accept(socket);
    });

    server.links["b-1"] = "tok-2";
    act(() => {
      socket.drop(4403);
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This link is not available.",
    );
    expect(screen.queryByRole("status")).toBeNull();
    expect(FakeSocket.instances).toHaveLength(1);
  });
});

describe("/b/{token}?object={id} — ссылка на объект (SHR-07)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("SHR-07: после загрузки документа вид переходит к объекту и выделяет его", async () => {
    guestServer({ "tok-1": "Kate" });
    const boardServer = new FakeBoardServer();
    const id = createObject(
      boardServer.doc.getMap("objects"),
      "sticky",
      { x: 2000, y: -600 },
      "Linked",
    );
    openAt(`/b/tok-1?object=${id}`);
    await screen.findByText("You joined as Kate.");
    // Канал открывается в эффекте страницы — ждём сокет, а не только текст.
    const socket = await waitFor(() => FakeSocket.last());
    act(() => {
      boardServer.accept(socket);
    });

    const linked = document.querySelector(`[data-object-id="${id}"]`);
    expect(linked).toHaveAttribute("aria-selected", "true");
    // CVS-05 запоминает вид: центр — в середине стикера 200×200.
    expect(
      JSON.parse(localStorage.getItem("myboard.camera.b-1") ?? "null"),
    ).toEqual({
      x: 2100,
      y: -500,
      zoom: 1,
    });
  });

  it("SHR-07: пока документ не получен, вид не трогается", async () => {
    guestServer({ "tok-1": "Kate" });
    openAt("/b/tok-1?object=abc");
    await screen.findByText("You joined as Kate.");

    expect(
      screen.queryByText("The linked object is not on this board."),
    ).toBeNull();
  });

  it("SHR-07: ссылка на объект с отозванным токеном — тот же отказ", async () => {
    guestServer({ "tok-old": "Kate" });
    openAt("/b/tok-old?object=abc");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This link is not available.",
    );
    expect(screen.queryByText("Roadmap")).toBeNull();
    expect(
      FakeSocket.instances.filter((s) => s.url.includes("tok-old")),
    ).toEqual([]);
  });
});

describe("/b/{token}/embed — встроенная доска (EMB-04)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("EMB-04: имя на сессию, затем рабочий холст без заголовка страницы", async () => {
    const server = guestServer();
    const location = openAt("/b/tok-1/embed");
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText("Your name"), "Kate");
    await user.click(screen.getByRole("button", { name: "Join board" }));

    expect(await screen.findByTestId("board-canvas")).toBeInTheDocument();
    expect(screen.queryByText(/You joined as/)).toBeNull();
    expect(screen.getByRole("toolbar", { name: "Tools" })).toBeInTheDocument();
    expect(location.history.at(-1)).toBe("/b/tok-1/embed");
    expect(FakeSocket.last().url).toContain("token=tok-1");
    expect(server.participants["tok-1"]).toBe("Kate");
  });

  it("EMB-04: правка из фрейма уходит в общий документ", async () => {
    guestServer({ "tok-1": "Kate" });
    const boardServer = new FakeBoardServer();
    openAt("/b/tok-1/embed");
    const socket = await waitFor(() => FakeSocket.last());
    act(() => {
      boardServer.accept(socket);
    });
    const user = userEvent.setup();

    await user.keyboard("n");
    fireEvent.pointerDown(screen.getByTestId("board-canvas"), {
      pointerId: 1,
      button: 0,
      clientX: 10,
      clientY: 10,
    });
    fireEvent.pointerUp(screen.getByTestId("board-canvas"), {
      pointerId: 1,
      button: 0,
      clientX: 10,
      clientY: 10,
    });

    await waitFor(() => {
      expect(boardServer.doc.getMap("objects").size).toBe(1);
    });
  });

  it("SHR-05: отозванная ссылка отказывает и во фрейме", async () => {
    guestServer();
    openAt("/b/tok-old/embed");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This link is not available.",
    );
  });

  it("EMB-04: браузер отбросил cookie — объяснение и адрес доски, а не снова форма", async () => {
    const server = guestServer();
    const real = vi.mocked(fetch).getMockImplementation();
    expect(real).toBeDefined();
    // Сервер принял имя, но cookie браузер не сохранил: следующий запрос — без сессии.
    vi.mocked(fetch).mockImplementation(async (...args) => {
      const response = await (real as typeof fetch)(...args);
      Reflect.deleteProperty(server.participants, "tok-1");
      return response;
    });
    openAt("/b/tok-1/embed");
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText("Your name"), "Kate");
    await user.click(screen.getByRole("button", { name: "Join board" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This browser does not keep your session in an embedded board.",
    );
    expect(
      screen.getByRole("link", { name: "Open the board in a new tab" }),
    ).toHaveAttribute("href", `${window.location.origin}/b/tok-1`);
    expect(screen.queryByLabelText("Your name")).toBeNull();
  });
});
