function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("invalid JSON payload");
  }
}

function requireString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`invalid ${key}: expected non-empty string`);
  }
  return value;
}

function requireRecord(input: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = input[key];
  if (!isRecord(value)) {
    throw new Error(`invalid ${key}: expected object`);
  }
  return value;
}

export interface SkillDefinition {
  id: string;
  name: string;
  entry: string;
  description?: string;
}

export interface PromptTemplateDefinition {
  id: string;
  template: string;
  variables: string[];
}

export interface ThemeDefinition {
  id: string;
  label: string;
  colors: Record<string, string>;
}

export function validateSkillDefinition(input: unknown): SkillDefinition {
  if (!isRecord(input)) {
    throw new Error("invalid skill definition: expected object");
  }

  const id = requireString(input, "id");
  const name = requireString(input, "name");
  const entry = requireString(input, "entry");
  const description = input.description;

  if (description !== undefined && typeof description !== "string") {
    throw new Error("invalid description: expected string");
  }

  return {
    id,
    name,
    entry,
    description,
  };
}

export function validatePromptTemplate(input: unknown): PromptTemplateDefinition {
  if (!isRecord(input)) {
    throw new Error("invalid prompt template: expected object");
  }

  const id = requireString(input, "id");
  const template = requireString(input, "template");
  const variablesValue = input.variables;

  if (
    !Array.isArray(variablesValue)
    || variablesValue.some((item) => typeof item !== "string" || item.trim() === "")
  ) {
    throw new Error("invalid variables: expected non-empty string array");
  }

  for (const variable of variablesValue) {
    if (!template.includes(`{{${variable}}}`)) {
      throw new Error(`template is missing parser placeholder for variable: ${variable}`);
    }
  }

  return {
    id,
    template,
    variables: [...variablesValue],
  };
}

export function validateThemeDefinition(input: unknown): ThemeDefinition {
  if (!isRecord(input)) {
    throw new Error("invalid theme definition: expected object");
  }

  const id = requireString(input, "id");
  const label = requireString(input, "label");
  const colors = requireRecord(input, "colors");

  for (const [name, value] of Object.entries(colors)) {
    if (name.trim() === "") {
      throw new Error("invalid color key: expected non-empty key");
    }
    if (typeof value !== "string" || !/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)) {
      throw new Error(`invalid color value for ${name}: expected hex color string`);
    }
  }

  return {
    id,
    label,
    colors: Object.fromEntries(Object.entries(colors).map(([k, v]) => [k, String(v)])),
  };
}

export function discoverSkills(payloads: string[]): SkillDefinition[] {
  return payloads.map((payload) => validateSkillDefinition(parseJson(payload)));
}

export function discoverPromptTemplates(payloads: string[]): PromptTemplateDefinition[] {
  return payloads.map((payload) => validatePromptTemplate(parseJson(payload)));
}

export function discoverThemes(payloads: string[]): ThemeDefinition[] {
  return payloads.map((payload) => validateThemeDefinition(parseJson(payload)));
}
