import { expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSkillsDiscovery } from "../../packages/extensions/src/skills";

test("skills discovery scans directories for SKILL.md markers", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-bun-effect-skills-"));
  const skillDir = join(root, "my-skill");
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    join(skillDir, "SKILL.md"),
    `---\nname: my-skill\ndescription: A test skill\n---\n\n# My Skill\n`,
  );

  const discovery = createSkillsDiscovery();
  const results = await discovery.scan([root]);

  expect(results.length).toBe(1);
  expect(results[0]?.name).toBe("my-skill");
  expect(results[0]?.description).toBe("A test skill");
  expect(results[0]?.type).toBe("skill");
  expect(discovery.list().length).toBe(1);
  expect(discovery.get("my-skill")).toBeDefined();

  rmSync(root, { recursive: true, force: true });
});

test("skills discovery handles empty and missing directories", async () => {
  const consoleSpy = spyOn(console, "error").mockImplementation(() => {});
  const discovery = createSkillsDiscovery();
  const results = await discovery.scan(["/tmp/nonexistent-dir-pi-bun-test"]);
  expect(results.length).toBe(0);
  expect(discovery.list().length).toBe(0);
  consoleSpy.mockRestore();
});

test("skills discovery detects prompt and theme types", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-bun-effect-skills-multi-"));
  const promptDir = join(root, "my-prompt");
  const themeDir = join(root, "my-theme");
  mkdirSync(promptDir, { recursive: true });
  mkdirSync(themeDir, { recursive: true });
  writeFileSync(
    join(promptDir, "PROMPT.md"),
    `---\nname: coding-prompt\ndescription: Code review prompt\n---\n`,
  );
  writeFileSync(
    join(themeDir, "THEME.md"),
    `---\nname: dark-mode\ndescription: Dark theme\n---\n`,
  );

  const discovery = createSkillsDiscovery();
  const results = await discovery.scan([root]);

  expect(results.length).toBe(2);
  const types = results.map((r) => r.type).sort();
  expect(types).toEqual(["prompt", "theme"]);

  rmSync(root, { recursive: true, force: true });
});
