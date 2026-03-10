import { createRpcCommandDispatcher, type RpcRequest } from "../../packages/rpc/src/index";
import { expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface Fixture {
  request: RpcRequest;
  expectedStatus: "ok" | "error";
}

function loadFixture(name: string): Fixture {
  return JSON.parse(
    readFileSync(join(import.meta.dir, "fixtures", name), "utf8"),
  ) as Fixture;
}

test("conformance: dispatcher supports fixture command paths", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-bun-effect-rpc-fixtures-"));
  const events: Array<{ id: string; command: string }> = [];
  const dispatcher = createRpcCommandDispatcher({
    rootDir: root,
    onEvent: (event) => {
      events.push({ id: event.id, command: event.command });
    },
  });

  const prompt = await dispatcher.dispatch(loadFixture("prompt.json").request);
  expect(prompt.status).toBe("ok");

  const commandFixtures = readdirSync(join(import.meta.dir, "fixtures"))
    .filter((name) => !name.startsWith("tree_") && !["fork.json", "prompt.json", "switch.json", "switch_error.json", "new_session.json"].includes(name))
    .sort();

  for (const name of commandFixtures) {
    const fixture = loadFixture(name);
    const response = await dispatcher.dispatch(fixture.request);
    expect(response.status).toBe(fixture.expectedStatus);
  }

  const currentEntryId = (prompt.result as { currentEntryId?: string }).currentEntryId;
  expect(typeof currentEntryId).toBe("string");

  const forkRequest = loadFixture("fork.json").request;
  (forkRequest.payload as { entryId: string }).entryId = currentEntryId as string;
  const forkResponse = await dispatcher.dispatch(forkRequest);
  expect(forkResponse.status).toBe("ok");
  const forkEntryId = (forkResponse.result as { entryId?: string }).entryId;
  expect(typeof forkEntryId).toBe("string");

  for (const treeFixtureName of [
    "tree_parent.json",
    "tree_children.json",
    "tree_linearize.json",
    "tree_navigation_error.json",
  ]) {
    const fixture = loadFixture(treeFixtureName);
    if (fixture.request.payload && "entryId" in fixture.request.payload) {
      (fixture.request.payload as { entryId: string }).entryId =
        treeFixtureName === "tree_navigation_error.json" ? "x" : (forkEntryId as string);
    }
    const response = await dispatcher.dispatch(fixture.request);
    expect(response.status).toBe(fixture.expectedStatus);
  }



  const newSessionFixture = loadFixture("new_session.json");
  const newSessionResponse = await dispatcher.dispatch(newSessionFixture.request);
  expect(newSessionResponse.status).toBe(newSessionFixture.expectedStatus);

  for (const switchFixture of ["switch.json", "switch_error.json"]) {
    const fixture = loadFixture(switchFixture);
    const response = await dispatcher.dispatch(fixture.request);
    expect(response.status).toBe(fixture.expectedStatus);
  }

  expect(events.some((event) => event.id === "fx-prompt")).toBeTrue();
});

test("conformance: steer/follow_up preserve queue semantics and correlation id", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-bun-effect-rpc-queue-"));
  const events: Array<{ id: string; command: string }> = [];
  const dispatcher = createRpcCommandDispatcher({
    rootDir: root,
    onEvent: (event) => {
      events.push({ id: event.id, command: event.command });
    },
  });

  const steerFixture = loadFixture("steer.json");
  const followFixture = loadFixture("follow_up.json");

  const steerResponse = await dispatcher.dispatch(steerFixture.request);
  const followResponse = await dispatcher.dispatch(followFixture.request);

  expect(steerResponse.status).toBe("ok");
  expect(followResponse.status).toBe("ok");
  expect((steerResponse.result as { queued?: boolean }).queued).toBeTrue();
  expect((followResponse.result as { queued?: boolean }).queued).toBeTrue();

  await dispatcher.waitForQueue();

  expect(events.some((event) => event.id === "fx-steer")).toBeTrue();
  expect(events.some((event) => event.id === "fx-follow")).toBeTrue();
  expect(events.some((event) => event.command === "follow_up")).toBeTrue();
});
