import { describe, expect, it } from "vitest";
import { InMemoryKanbanProvider } from "./memory-provider.js";

function makeProvider(): InMemoryKanbanProvider {
  const provider = new InMemoryKanbanProvider();
  return provider;
}

function init(provider: InMemoryKanbanProvider) {
  return provider.initialize({ githubToken: null });
}

describe("InMemoryKanbanProvider", () => {
  it("seeds a single board with the classic three columns", async () => {
    const provider = makeProvider();
    await init(provider);
    const boards = await provider.listBoards({});
    expect(boards).toHaveLength(1);
    expect(boards[0].title).toBe("Local Demo Board");

    const board = await provider.getBoard(boards[0].boardId);
    expect(board.columns.map((c) => c.name)).toEqual(["To Do", "In Progress", "Done"]);
    expect(board.columns[0].cards.length).toBeGreaterThan(0);
  });

  it("moves a card between columns and updates its clear-text status", async () => {
    const provider = makeProvider();
    await init(provider);
    const boardId = (await provider.listBoards({}))[0].boardId;
    const board = await provider.getBoard(boardId);
    const card = board.columns[0].cards[0];

    await provider.moveCard(boardId, card.id, "done");

    const after = await provider.getBoard(boardId);
    const doneColumn = after.columns.find((c) => c.id === "done");
    expect(doneColumn?.cards.map((c) => c.id)).toContain(card.id);
    const moved = doneColumn?.cards.find((c) => c.id === card.id);
    expect(moved?.status).toBe("Done");
  });

  it("creates a card into a named column", async () => {
    const provider = makeProvider();
    await init(provider);
    const boardId = (await provider.listBoards({}))[0].boardId;
    const before = (await provider.getBoard(boardId)).columns[1].cards.length;

    const created = await provider.createCard(boardId, "in-progress", {
      title: "New work",
      body: "details",
    });
    expect(created.title).toBe("New work");
    expect(created.status).toBe("in-progress");

    const after = (await provider.getBoard(boardId)).columns[1].cards.length;
    expect(after).toBe(before + 1);
  });

  it("rejects an unknown board", async () => {
    const provider = makeProvider();
    await init(provider);
    await expect(provider.getBoard("does-not-exist")).rejects.toThrow(/Unknown board/);
  });

  it("rejects moving into an unknown column", async () => {
    const provider = makeProvider();
    await init(provider);
    const boardId = (await provider.listBoards({}))[0].boardId;
    const card = (await provider.getBoard(boardId)).columns[0].cards[0];
    await expect(provider.moveCard(boardId, card.id, "no-such-column")).rejects.toThrow(
      /Unknown column/,
    );
  });

  it("links an external task and refuses to link it twice", async () => {
    const provider = makeProvider();
    await init(provider);
    const boardId = (await provider.listBoards({}))[0].boardId;
    const linked = await provider.linkExternalTask(
      boardId,
      { owner: "acme", repo: "widgets", externalId: "77" },
      null,
    );
    expect(linked.rawProviderId).toBe("77");
    expect(linked.url).toContain("github.com/acme/widgets/issues/77");

    await expect(provider.linkExternalTask(boardId, { externalId: "77" }, null)).rejects.toThrow(
      /already linked/,
    );
  });
});
