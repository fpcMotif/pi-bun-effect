import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  Capability,
  ExtensionPolicy,
  PolicyEngine,
  TrustDecision,
} from "./policy";

export type ExtensionSourceType = "npm" | "git" | "path";

export interface ExtensionManifest {
  id: string;
  name: string;
  version: string;
  capabilities: Capability[];
  activationEvents: string[];
}

export interface ExtensionSource {
  type: ExtensionSourceType;
  reference: string;
  manifest: ExtensionManifest;
}

export interface ActivationCheckResult {
  allowed: boolean;
  reason?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    return [];
  }
  return value;
}

export function parseExtensionManifest(input: unknown): ExtensionManifest {
  if (!isRecord(input)) {
    throw new Error("invalid manifest: expected object");
  }

  const id = input.id;
  const name = input.name;
  const version = input.version;
  const capabilities = input.capabilities;
  const activationEvents = input.activationEvents;

  if (typeof id !== "string" || id.trim() === "") {
    throw new Error("invalid manifest: id is required");
  }
  if (typeof name !== "string" || name.trim() === "") {
    throw new Error("invalid manifest: name is required");
  }
  if (typeof version !== "string" || version.trim() === "") {
    throw new Error("invalid manifest: version is required");
  }

  const parsedCapabilities = asStringArray(capabilities) as Capability[];
  if (parsedCapabilities.length === 0) {
    throw new Error(
      "invalid manifest: capabilities must be a non-empty string array",
    );
  }

  return {
    id,
    name,
    version,
    capabilities: parsedCapabilities,
    activationEvents: asStringArray(activationEvents),
  };
}

export function parseManifestFromPackageJson(
  packageJsonText: string,
): ExtensionManifest {
  const parsed = JSON.parse(packageJsonText) as Record<string, unknown>;
  const extension = parsed.extension;
  if (!isRecord(extension)) {
    throw new Error("package manifest missing `extension` field");
  }
  return parseExtensionManifest(extension);
}

export async function loadFromPath(path: string): Promise<ExtensionSource> {
  const manifestPath = join(path, "extension.json");
  const packagePath = join(path, "package.json");

  try {
    const content = await readFile(manifestPath, "utf8");
    return {
      type: "path",
      reference: path,
      manifest: parseExtensionManifest(JSON.parse(content)),
    };
  } catch (err: any) {
    if (err.code !== "ENOENT") {
      throw err;
    }
  }

  let packageContent: string;
  try {
    packageContent = await readFile(packagePath, "utf8");
  } catch (err: any) {
    if (err.code === "ENOENT") {
      throw new Error(`no manifest found at ${path}`);
    }
    throw err;
  }

  return {
    type: "path",
    reference: path,
    manifest: parseManifestFromPackageJson(packageContent),
  };
}

export function loadFromNpm(
  packageName: string,
  packageJsonText: string,
): ExtensionSource {
  return {
    type: "npm",
    reference: packageName,
    manifest: parseManifestFromPackageJson(packageJsonText),
  };
}

export function loadFromGit(
  url: string,
  manifestText: string,
): ExtensionSource {
  return {
    type: "git",
    reference: url,
    manifest: parseExtensionManifest(JSON.parse(manifestText)),
  };
}

function isTrustAllowed(decision: TrustDecision): boolean {
  return decision === "trusted" || decision === "acknowledged";
}

export async function checkActivationPolicy(
  source: ExtensionSource,
  engine: PolicyEngine,
  policy?: ExtensionPolicy,
): Promise<ActivationCheckResult> {
  if (policy && policy.extensionId !== source.manifest.id) {
    return {
      allowed: false,
      reason: "policy extension id does not match manifest id",
    };
  }

  const trust = await engine.getTrust(source.manifest.id);
  if (!isTrustAllowed(trust.decision)) {
    return {
      allowed: false,
      reason: `extension trust is not sufficient: ${trust.decision}`,
    };
  }

  for (const capability of source.manifest.capabilities) {
    if (!engine.evaluateCapability(source.manifest.id, capability)) {
      return {
        allowed: false,
        reason: `capability denied by policy engine: ${capability}`,
      };
    }
  }

  return { allowed: true };
}
