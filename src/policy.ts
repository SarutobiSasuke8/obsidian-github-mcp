import { readFile } from "node:fs/promises";

import YAML from "yaml";
import { z } from "zod";

import type {
  AgentGrant,
  AgentIdentity,
  BrokerGrant,
  FleetPolicy,
  SurfaceRule,
} from "./types.js";

const stringArray = z.array(z.string()).default([]);
const rawAgentSchema = z.object({
  id: z.string().min(1),
  name: z.string().default(""),
  role: z.string().default(""),
  disclosure_ceiling: z.string().default("public-safe"),
  entry_reads: stringArray,
  read: stringArray,
  write: stringArray,
  deny: stringArray,
});
const rawBrokerSchema = z.object({
  broker: z.string().min(1),
  branch: z.string().min(1),
  allow: z.array(z.string()).min(1),
});
const rawSurfaceRuleSchema = z.object({
  path: z.string().min(1),
  required_frontmatter: z.record(z.string(), z.string()).default({}),
});
const rawPolicySchema = z.object({
  policy_version: z.number().int().positive(),
  authority: z.string().default("operator-only"),
  agents: z.array(rawAgentSchema),
  git_brokers: z.array(rawBrokerSchema),
  never_versioned: z.array(z.string()).default([]),
  surface_rules: z.array(rawSurfaceRuleSchema).default([]),
});

export function parseFleetPolicy(yaml: string): FleetPolicy {
  const parsed = rawPolicySchema.parse(YAML.parse(yaml));
  const agents = new Map<string, AgentGrant>();
  for (const raw of parsed.agents) {
    if (agents.has(raw.id)) throw new Error(`Duplicate policy identity '${raw.id}'.`);
    agents.set(raw.id, {
      id: raw.id,
      name: raw.name,
      role: raw.role,
      disclosureCeiling: raw.disclosure_ceiling,
      entryReads: raw.entry_reads,
      read: raw.read,
      write: raw.write,
      deny: raw.deny,
    });
  }

  const brokers = new Map<string, BrokerGrant>();
  for (const raw of parsed.git_brokers) {
    if (brokers.has(raw.broker)) throw new Error(`Duplicate Git broker '${raw.broker}'.`);
    if (raw.branch === "main" || raw.branch === "master") {
      throw new Error("A Git broker may not target the default branch.");
    }
    brokers.set(raw.broker, { name: raw.broker, branch: raw.branch, allow: raw.allow });
  }

  const surfaceRules: SurfaceRule[] = parsed.surface_rules.map((rule) => ({
    path: rule.path,
    requiredFrontmatter: rule.required_frontmatter,
  }));
  return {
    version: parsed.policy_version,
    authority: parsed.authority,
    agents,
    brokers,
    neverVersioned: parsed.never_versioned,
    surfaceRules,
  };
}

export async function loadFleetPolicy(filePath: string): Promise<FleetPolicy> {
  return parseFleetPolicy(await readFile(filePath, "utf8"));
}

export class PolicyStore {
  public constructor(private readonly policyFile: string) {}

  public async getPolicy(): Promise<FleetPolicy> {
    return loadFleetPolicy(this.policyFile);
  }

  public async resolveIdentity(agentId: string, brokerName: string): Promise<AgentIdentity> {
    const policy = await this.getPolicy();
    const agent = policy.agents.get(agentId);
    if (!agent) throw new Error(`Identity '${agentId}' is not provisioned in the policy.`);
    const broker = policy.brokers.get(brokerName);
    if (!broker) throw new Error(`Broker '${brokerName}' is not provisioned in the policy.`);
    return { agent, broker };
  }

  public async resolveAccess(
    agentId: string,
    brokerName: string,
  ): Promise<{ policy: FleetPolicy; identity: AgentIdentity }> {
    const policy = await this.getPolicy();
    const agent = policy.agents.get(agentId);
    if (!agent) throw new Error(`Identity '${agentId}' is not provisioned in the policy.`);
    const broker = policy.brokers.get(brokerName);
    if (!broker) throw new Error(`Broker '${brokerName}' is not provisioned in the policy.`);
    return { policy, identity: { agent, broker } };
  }
}
