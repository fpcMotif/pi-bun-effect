import { expect, test } from "bun:test";
import {
  checkActivationPolicy,
  createPolicyEngine,
  createRuntimeServices,
  discoverPromptTemplates,
  discoverSkills,
  discoverThemes,
  loadFromGit,
  loadFromNpm,
} from "../../packages/extensions/src/index";

test("conformance: runtime services register commands/hooks and expose ui prompt callback", async () => {
  const runtime = createRuntimeServices();
  const calls: string[] = [];

  runtime.registerCommand({
    name: "hello",
    async execute(_context, args) {
      calls.push(`command:${args.join(",")}`);
      return args.join(" ");
    },
  });

  runtime.registerHook({
    event: "session:start",
    async handler(event, context) {
      calls.push(`${event.type}:${context.extensionId}`);
    },
  });

  runtime.setPromptCallback(async (prompt, metadata) => {
    calls.push(`prompt:${prompt}:${String(metadata?.kind ?? "")}`);
    return "approved";
  });

  const context = {
    extensionId: "ext-runtime",
    sessionId: "s1",
    capabilities: new Set<import("@pi-bun-effect/extensions").Capability>(),
  };

  const commandResult = await runtime.executeCommand("hello", context, [
    "world",
  ]);
  await runtime.dispatchEvent(
    { type: "session:start", timestamp: new Date().toISOString() },
    context,
  );
  const promptResult = await runtime.requestPrompt("continue?", {
    kind: "confirm",
  });

  expect(commandResult).toBe("world");
  expect(promptResult).toBe("approved");
  expect(calls).toEqual([
    "command:world",
    "session:start:ext-runtime",
    "prompt:continue?:confirm",
  ]);
});

test("conformance: source loaders parse manifests and enforce trust/policy before activation", async () => {
  const npmSource = loadFromNpm(
    "@scope/ext",
    JSON.stringify({
      name: "@scope/ext",
      version: "1.0.0",
      extension: {
        id: "ext-trusted",
        name: "Trusted Extension",
        version: "1.0.0",
        capabilities: ["tool:read"],
        activationEvents: ["onStart"],
      },
    }),
  );

  const gitSource = loadFromGit(
    "https://example.com/ext.git",
    JSON.stringify({
      id: "ext-blocked",
      name: "Blocked Extension",
      version: "1.0.0",
      capabilities: ["tool:bash"],
      activationEvents: ["onCommand:danger"],
    }),
  );

  const engine = createPolicyEngine([
    {
      extensionId: "ext-trusted",
      capabilities: ["tool:read"],
      allowCommands: [],
      denyCommands: [],
      denyPatterns: [],
    },
    {
      extensionId: "ext-blocked",
      capabilities: ["tool:read"],
      allowCommands: [],
      denyCommands: [],
      denyPatterns: [],
    },
  ]);

  await engine.setTrust("ext-trusted", "trusted", "test");
  await engine.setTrust("ext-blocked", "trusted", "test");

  const allowed = await checkActivationPolicy(npmSource, engine);
  const denied = await checkActivationPolicy(gitSource, engine);

  expect(allowed.allowed).toBe(true);
  expect(denied.allowed).toBe(false);
  expect(denied.reason).toContain("capability denied");
});

test("conformance: discovery validates skills, prompt templates, and themes", () => {
  const skills = discoverSkills([
    JSON.stringify({ id: "skill-a", name: "Skill A", entry: "./index.ts" }),
  ]);
  expect(skills).toHaveLength(1);

  const templates = discoverPromptTemplates([
    JSON.stringify({
      id: "prompt-a",
      template: "hello {{name}}",
      variables: ["name"],
    }),
  ]);
  expect(templates).toHaveLength(1);

  const themes = discoverThemes([
    JSON.stringify({
      id: "dark",
      label: "Dark",
      colors: { background: "#000000", text: "#ffffff" },
    }),
  ]);
  expect(themes).toHaveLength(1);

  expect(() =>
    discoverPromptTemplates([
      JSON.stringify({
        id: "bad-prompt",
        template: "hello world",
        variables: ["name"],
      }),
    ])
  ).toThrow("template is missing parser placeholder");
});
