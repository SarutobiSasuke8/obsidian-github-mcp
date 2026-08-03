export interface AgentGrant {
  id: string;
  name: string;
  role: string;
  disclosureCeiling: string;
  entryReads: string[];
  read: string[];
  write: string[];
  deny: string[];
}

export interface BrokerGrant {
  name: string;
  branch: string;
  allow: string[];
}

export interface FleetPolicy {
  version: number;
  authority: string;
  agents: Map<string, AgentGrant>;
  brokers: Map<string, BrokerGrant>;
  neverVersioned: string[];
  surfaceRules: SurfaceRule[];
}

export interface SurfaceRule {
  path: string;
  requiredFrontmatter: Record<string, string>;
}

export interface AuthBinding {
  agentId: string;
  broker: string;
  enabled: boolean;
  tokenSha256: string;
  expiresAt: number;
}

export interface AgentIdentity {
  agent: AgentGrant;
  broker: BrokerGrant;
}

export interface RepositoryFile {
  path: string;
  sha: string;
  content: string;
  htmlUrl?: string;
}

export interface RepositoryEntry {
  path: string;
  name: string;
  type: "file" | "dir" | "symlink" | "submodule";
  sha: string;
  size: number;
  htmlUrl?: string;
}

export interface WriteResult {
  path: string;
  branch: string;
  commitSha: string;
  commitUrl?: string;
  contentSha: string;
}
