export const policyFixture = `
policy_version: 1
authority: operator-only
agents:
  - id: alpha-writer
    name: Alpha Writer
    role: private workspace writer
    disclosure_ceiling: internal
    entry_reads: [README.md]
    read: [Knowledge/**, Workspace/**]
    write: [Workspace/Alpha/**, Workspace/Shared/**, Workspace/Research/**]
    deny: [Workspace/Beta/**, Private/**, README.md]
  - id: research-writer
    name: Research Writer
    role: research
    disclosure_ceiling: public-safe
    entry_reads: [README.md]
    read: [Workspace/Research/**]
    write: [Workspace/Research/**]
    deny: [Private/**, README.md]
git_brokers:
  - broker: alpha
    branch: agent/alpha
    allow: [Workspace/Alpha/**, Workspace/Shared/**]
  - broker: research
    branch: agent/research
    allow: [Workspace/Research/**]
never_versioned:
  - Private/**
  - .obsidian/**
  - credentials, tokens, keys, authentication material
surface_rules:
  - path: Workspace/Shared/**
    required_frontmatter:
      disclosure: public-safe
`;
