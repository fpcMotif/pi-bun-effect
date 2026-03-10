import {
  type AuditCorrelationIds,
  type AuditLogger,
  NoopAuditLogger,
  nowIso,
  redactMetadata,
} from "@pi-bun-effect/core";

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

export interface PolicyCheckContext {
  correlationIds?: AuditCorrelationIds;
  metadata?: Record<string, unknown>;
}

export interface PolicyEngine {
  evaluateCapability(extensionId: string, capability: Capability): boolean;
  check(
    extensionId: string,
    capability: Capability,
    command: string,
    context?: PolicyCheckContext,
  ): Promise<CommandMediationResult>;
  getTrust(extensionId: string): Promise<TrustRecord>;
  setTrust(
    extensionId: string,
    decision: TrustDecision,
    actor: string,
    note?: string,
  ): Promise<void>;
}

const defaultPolicy: ExtensionPolicy = {
  extensionId: "default",
  capabilities: [
    "session:read",
    "session:write",
    "tool:read",
    "tool:write",
    "tool:edit",
  ],
  allowCommands: [],
  denyCommands: ["reboot", "shutdown"],
  denyPatterns: ["rm -rf", "mkfs", "dd if=", "curl .*\\|", "/bin/sh -c", "nc -l"],
};

function compilePatterns(patterns: string[]): RegExp[] {
  return patterns.map((pattern) => new RegExp(pattern, "i"));
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

  constructor(
    initialPolicies: ExtensionPolicy[] = [],
    private readonly auditLogger: AuditLogger = new NoopAuditLogger(),
  ) {
    this.denyPatternRegs = compilePatterns(defaultPolicy.denyPatterns);
    for (const policy of initialPolicies) {
      this.policies.set(policy.extensionId, policy);
      this.trust.set(policy.extensionId, {
        extensionId: policy.extensionId,
        decision: "acknowledged",
        changedBy: "init",
        changedAt: nowIso(),
      });
    }
  }

  evaluateCapability(extensionId: string, capability: Capability): boolean {
    const policy = this.policies.get(extensionId) ?? defaultPolicy;
    const trust = this.trust.get(extensionId);
    if (
      trust
      && (trust.decision === "killed" || trust.decision === "quarantined")
    ) {
      return false;
    }
    return policy.capabilities.includes(capability);
  }

  private emitAuditEvent(
    extensionId: string,
    capability: Capability,
    command: string,
    result: CommandMediationResult,
    context?: PolicyCheckContext,
  ): void {
    this.auditLogger.emit({
      type: "policy.command.check",
      at: nowIso(),
      extensionId,
      capability,
      command,
      outcome: result.allowed ? "allow" : "deny",
      reason: result.reason,
      correlationIds: context?.correlationIds ?? {},
      metadata: redactMetadata(context?.metadata ?? {}),
    });
  }

  async check(
    extensionId: string,
    capability: Capability,
    command: string,
    context?: PolicyCheckContext,
  ): Promise<CommandMediationResult> {
    const policy = this.policies.get(extensionId) ?? defaultPolicy;
    const lowered = command.trim();

    const matchedPattern = this.denyPatternRegs.find((pattern) =>
      pattern.test(lowered)
    );
    if (matchedPattern) {
      const result = {
        allowed: false,
        reason: `Blocked by default safety pattern: ${matchedPattern.source}`,
        suggestedFix:
          "Pass an explicit allow policy and safer command variant.",
      };
      this.emitAuditEvent(extensionId, capability, command, result, context);
      return result;
    }

    if (!this.evaluateCapability(extensionId, capability)) {
      const result = {
        allowed: false,
        reason: `Capability denied: ${capability}`,
        suggestedFix:
          "Grant capability in extension manifest and trust profile.",
      };
      this.emitAuditEvent(extensionId, capability, command, result, context);
      return result;
    }

    const commandName = lowered.split(" ")[0] ?? "";
    if (policy.denyCommands.includes(commandName)) {
      const result = {
        allowed: false,
        reason: "Command denied by denylist",
        suggestedFix: "Use allowlist policy to explicitly allow this command.",
      };
      this.emitAuditEvent(extensionId, capability, command, result, context);
      return result;
    }

    if (policy.denyCommands.includes(lowered)) {
      const result = {
        allowed: false,
        reason: "Command denied by denylist",
        suggestedFix: "Use allowlist policy to explicitly allow this command.",
      };
      this.emitAuditEvent(extensionId, capability, command, result, context);
      return result;
    }

    if (
      policy.allowCommands.length > 0
      && !policy.allowCommands.some((value) => lowered === value)
    ) {
      const result = {
        allowed: false,
        reason: "Command not in allowlist",
        suggestedFix: `Allowed commands are: ${
          policy.allowCommands.join(", ")
        }`,
      };
      this.emitAuditEvent(extensionId, capability, command, result, context);
      return result;
    }

    const result = {
      allowed: true,
    };
    this.emitAuditEvent(extensionId, capability, command, result, context);
    return result;
  }

  async getTrust(extensionId: string): Promise<TrustRecord> {
    return (
      this.trust.get(extensionId) ?? {
        extensionId,
        decision: "pending",
        changedBy: "system",
        changedAt: nowIso(),
        note: "created by default",
      }
    );
  }

  async setTrust(
    extensionId: string,
    decision: TrustDecision,
    actor: string,
    note?: string,
  ): Promise<void> {
    this.trust.set(extensionId, {
      extensionId,
      decision,
      changedBy: actor,
      changedAt: nowIso(),
      note,
    });
  }
}

export function createPolicyEngine(
  initialPolicies: ExtensionPolicy[] = [],
  auditLogger?: AuditLogger,
): PolicyEngine {
  return new DefaultPolicyEngine(initialPolicies, auditLogger);
}
