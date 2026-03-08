export type Capability =
  | "tool:read"
  | "tool:write"
  | "tool:edit"
  | "tool:bash"
  | "tool:grep"
  | "tool:find"
  | "tool:ls"
  | "exec:spawn"
  | "http:outbound"
  | "session:read"
  | "session:write"
  | "ui:prompt"
  | "events:schedule";

export type TrustDecision =
  | "pending"
  | "acknowledged"
  | "trusted"
  | "quarantined"
  | "killed";

export interface ExtensionPolicy {
  extensionId: string;
  capabilities: Capability[];
  allowCommands: string[];
  denyCommands: string[];
  denyPatterns: string[];
}

export interface TrustRecord {
  extensionId: string;
  decision: TrustDecision;
  changedBy: string;
  changedAt: string;
  note?: string;
}

export interface CommandMediationResult {
  allowed: boolean;
  reason?: string;
  suggestedFix?: string;
}

export interface PolicyEngine {
  evaluateCapability(extensionId: string, capability: Capability): boolean;
  check(
    extensionId: string,
    capability: Capability,
    command: string,
  ): Promise<CommandMediationResult>;
  getTrust(extensionId: string): Promise<TrustRecord>;
  setTrust(
    extensionId: string,
    decision: TrustDecision,
    actor: string,
    note?: string,
  ): Promise<void>;
}

function nowIso(): string {
  return new Date().toISOString();
}

const defaultPolicy: ExtensionPolicy = {
  extensionId: "default",
  capabilities: [],
  allowCommands: [],
  denyCommands: ["reboot", "shutdown"],
  denyPatterns: [
    "rm -rf",
    "mkfs",
    "dd if=",
    "curl .*\\|",
    "/bin/sh -c",
    "nc -l",
  ],
};

const ACKNOWLEDGED_CAPABILITIES = new Set<Capability>([
  "tool:read",
  "tool:grep",
  "tool:find",
  "tool:ls",
  "session:read",
  "ui:prompt",
]);

export function allowsCapabilityForTrust(
  decision: TrustDecision,
  capability: Capability,
): boolean {
  if (decision === "trusted") {
    return true;
  }

  if (decision !== "acknowledged") {
    return false;
  }

  return ACKNOWLEDGED_CAPABILITIES.has(capability);
}

function compilePatterns(patterns: string[]): RegExp[] {
  return patterns.map((pattern) => new RegExp(pattern, "i"));
}

function createTrustRecord(
  extensionId: string,
  decision: TrustDecision,
  actor: string,
  note?: string,
): TrustRecord {
  return {
    extensionId,
    decision,
    changedBy: actor,
    changedAt: nowIso(),
    note,
  };
}

export function createDefaultPolicy(): ExtensionPolicy {
  return {
    ...defaultPolicy,
    extensionId: `ext-${Date.now()}`,
  };
}

export class DefaultPolicyEngine implements PolicyEngine {
  private readonly policies = new Map<string, ExtensionPolicy>();
  private readonly trust = new Map<string, TrustRecord>();
  private readonly denyPatternRegs: RegExp[];
  private readonly extensionDenyPatternRegs = new Map<string, RegExp[]>();

  constructor(initialPolicies: ExtensionPolicy[] = []) {
    this.denyPatternRegs = compilePatterns(defaultPolicy.denyPatterns);
    for (const policy of initialPolicies) {
      this.policies.set(policy.extensionId, policy);
      this.extensionDenyPatternRegs.set(
        policy.extensionId,
        compilePatterns(policy.denyPatterns),
      );
      this.trust.set(
        policy.extensionId,
        createTrustRecord(policy.extensionId, "acknowledged", "init"),
      );
    }
  }

  evaluateCapability(extensionId: string, capability: Capability): boolean {
    const policy = this.policies.get(extensionId);
    if (!policy) {
      return false;
    }

    const decision = this.trust.get(extensionId)?.decision ?? "pending";
    return (
      policy.capabilities.includes(capability)
      && allowsCapabilityForTrust(decision, capability)
    );
  }

  async check(
    extensionId: string,
    capability: Capability,
    command: string,
  ): Promise<CommandMediationResult> {
    const policy = this.policies.get(extensionId);
    const normalizedCommand = command.trim().toLowerCase();
    const denyCommands = policy?.denyCommands ?? [];
    const allowCommands = policy?.allowCommands ?? [];

    const matchedDefaultPattern = this.denyPatternRegs.find((pattern) =>
      pattern.test(normalizedCommand)
    );
    if (matchedDefaultPattern) {
      return {
        allowed: false,
        reason:
          `Blocked by default safety pattern: ${matchedDefaultPattern.source}`,
        suggestedFix:
          "Pass an explicit allow policy and safer command variant.",
      };
    }

    const matchedExtensionPattern = (
      this.extensionDenyPatternRegs.get(extensionId) ?? []
    ).find((pattern) => pattern.test(normalizedCommand));
    if (matchedExtensionPattern) {
      return {
        allowed: false,
        reason:
          `Blocked by extension safety pattern: ${matchedExtensionPattern.source}`,
        suggestedFix: "Use a safer command variant.",
      };
    }

    if (!this.evaluateCapability(extensionId, capability)) {
      return {
        allowed: false,
        reason: `Capability denied: ${capability}`,
        suggestedFix:
          "Grant capability in extension manifest and trust profile.",
      };
    }

    const commandName = normalizedCommand.split(" ")[0] ?? "";
    if (
      denyCommands.includes(commandName)
      || denyCommands.includes(normalizedCommand)
    ) {
      return {
        allowed: false,
        reason: "Command denied by denylist",
        suggestedFix: "Use allowlist policy to explicitly allow this command.",
      };
    }

    if (
      allowCommands.length > 0
      && !allowCommands.some((value) =>
        normalizedCommand === value.toLowerCase()
      )
    ) {
      return {
        allowed: false,
        reason: "Command not in allowlist",
        suggestedFix: `Allowed commands are: ${allowCommands.join(", ")}`,
      };
    }

    return {
      allowed: true,
    };
  }

  async getTrust(extensionId: string): Promise<TrustRecord> {
    return (
      this.trust.get(extensionId)
        ?? createTrustRecord(
          extensionId,
          "pending",
          "system",
          "created by default",
        )
    );
  }

  async setTrust(
    extensionId: string,
    decision: TrustDecision,
    actor: string,
    note?: string,
  ): Promise<void> {
    this.trust.set(
      extensionId,
      createTrustRecord(extensionId, decision, actor, note),
    );
  }
}

export function createPolicyEngine(
  initialPolicies: ExtensionPolicy[] = [],
): PolicyEngine {
  return new DefaultPolicyEngine(initialPolicies);
}
