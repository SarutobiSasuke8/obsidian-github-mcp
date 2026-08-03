import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { appendContent, validateContent, validateReplacement } from "./content-policy.js";
import {
  assertListable,
  assertReadable,
  assertWritable,
  canListDirectory,
  canRead,
  normalizeRepoPath,
} from "./path-policy.js";

import type { AuthInfo, CallToolResult } from "@modelcontextprotocol/server";
import type { AuditLogger } from "./audit.js";
import type { AppConfig } from "./config.js";
import type { GitHubRepositoryClient } from "./github.js";
import type { PolicyStore } from "./policy.js";
import type { AgentIdentity, FleetPolicy } from "./types.js";

interface Services {
  config: AppConfig;
  policyStore: PolicyStore;
  github: GitHubRepositoryClient;
  audit: AuditLogger;
}

interface ToolContext {
  http?: { authInfo?: AuthInfo };
}

interface Access {
  auth: AuthInfo;
  policy: FleetPolicy;
  identity: AgentIdentity;
}

function jsonResult(value: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    structuredContent: value as Record<string, unknown>,
  };
}

function errorResult(error: unknown): CallToolResult {
  const message = error instanceof Error ? error.message : "Unknown error";
  return { isError: true, content: [{ type: "text", text: message }] };
}

async function resolveAccess(context: ToolContext, services: Services): Promise<Access> {
  const auth = context.http?.authInfo;
  if (!auth) throw new Error("Authenticated MCP context is missing.");
  const broker = auth.extra?.broker;
  if (typeof broker !== "string") throw new Error("The token has no broker binding.");
  const { policy, identity } = await services.policyStore.resolveAccess(auth.clientId, broker);
  return { auth, policy, identity };
}

function commitMessage(agentId: string, action: string, repoPath: string, requested?: string): string {
  const safe = requested?.replace(/[\r\n\u0000-\u001f]/gu, " ").trim().slice(0, 120);
  return `[${agentId}] ${safe || `${action} ${repoPath}`}`;
}

async function runTool(
  services: Services,
  context: ToolContext,
  action: string,
  repoPath: string | undefined,
  operation: (access: Access) => Promise<CallToolResult>,
): Promise<CallToolResult> {
  let access: Access | undefined;
  try {
    access = await resolveAccess(context, services);
    const result = await operation(access);
    await services.audit.write({
      agentId: access.identity.agent.id,
      broker: access.identity.broker.name,
      action,
      outcome: "success",
      ...(repoPath ? { repoPath } : {}),
      branch: access.identity.broker.branch,
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (access) {
      await services.audit.write({
        agentId: access.identity.agent.id,
        broker: access.identity.broker.name,
        action,
        outcome: /may not|forbidden|rejected|cannot|must/iu.test(message) ? "denied" : "error",
        ...(repoPath ? { repoPath } : {}),
        branch: access.identity.broker.branch,
        detail: message,
      });
    }
    return errorResult(error);
  }
}

export function createVaultMcpServer(services: Services): McpServer {
  const server = new McpServer({ name: "obsidian-github-mcp", version: "0.1.0" });

  server.registerTool(
    "vault_whoami",
    {
      title: "Show vault identity",
      description: "Show the authenticated agent, broker branch, and effective declared scopes.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async (context) =>
      runTool(services, context, "whoami", undefined, async ({ policy, identity }) =>
        jsonResult({
          agent_id: identity.agent.id,
          name: identity.agent.name,
          role: identity.agent.role,
          disclosure_ceiling: identity.agent.disclosureCeiling,
          fleet_manifest_version: policy.version,
          broker: identity.broker.name,
          proposal_branch: identity.broker.branch,
          read: [...identity.agent.entryReads, ...identity.agent.read],
          agent_write: identity.agent.write,
          broker_allow: identity.broker.allow,
          deny: identity.agent.deny,
        }),
      ),
  );

  server.registerTool(
    "vault_list_allowed_paths",
    {
      title: "List vault path permissions",
      description: "Explain the authenticated agent's FLEET and broker path scopes.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async (context) =>
      runTool(services, context, "list_allowed_paths", undefined, async ({ identity }) =>
        jsonResult({
          read: [...identity.agent.entryReads, ...identity.agent.read],
          write_requires_both: {
            agent_write: identity.agent.write,
            broker_allow: identity.broker.allow,
          },
          deny: identity.agent.deny,
          proposal_branch: identity.broker.branch,
        }),
      ),
  );

  server.registerTool(
    "vault_list_files",
    {
      title: "List vault files",
      description: "List an authorized directory on the agent's proposal branch.",
      inputSchema: z.object({ path: z.string().min(1) }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ path: requestedPath }, context) => {
      let repoPath: string;
      try {
        repoPath = normalizeRepoPath(requestedPath);
      } catch (error) {
        return errorResult(error);
      }
      return runTool(services, context, "list_files", repoPath, async ({ policy, identity }) => {
        assertListable(policy, identity, repoPath);
        const entries = await services.github.listDirectory(repoPath, identity.broker.branch);
        return jsonResult(
          entries.filter((entry) =>
            entry.type === "dir"
              ? canListDirectory(policy, identity, entry.path)
              : canRead(policy, identity, entry.path),
          ),
        );
      });
    },
  );

  server.registerTool(
    "vault_read_file",
    {
      title: "Read a vault file",
      description: "Read an authorized UTF-8 file from the agent's proposal branch.",
      inputSchema: z.object({ path: z.string().min(1) }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ path: requestedPath }, context) => {
      let repoPath: string;
      try {
        repoPath = normalizeRepoPath(requestedPath);
      } catch (error) {
        return errorResult(error);
      }
      return runTool(services, context, "read_file", repoPath, async ({ policy, identity }) => {
        assertReadable(policy, identity, repoPath);
        const file = await services.github.getFile(repoPath, identity.broker.branch);
        return jsonResult(file);
      });
    },
  );

  const writeInput = z.object({
    path: z.string().min(1),
    content: z.string(),
    commit_message: z.string().max(120).optional(),
  });

  server.registerTool(
    "vault_create_file",
    {
      title: "Create a vault proposal file",
      description: "Create a new file on the authenticated agent's fixed proposal branch.",
      inputSchema: writeInput,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ path: requestedPath, content, commit_message: requestedMessage }, context) => {
      let repoPath: string;
      try {
        repoPath = normalizeRepoPath(requestedPath);
      } catch (error) {
        return errorResult(error);
      }
      return runTool(services, context, "create_file", repoPath, async ({ policy, identity }) => {
        assertWritable(policy, identity, repoPath);
        const validation = validateContent(repoPath, content, services.config, policy.surfaceRules);
        const result = await services.github.putFile(
          repoPath,
          identity.broker.branch,
          content,
          commitMessage(identity.agent.id, "create", repoPath, requestedMessage),
        );
        await services.audit.write({
          agentId: identity.agent.id,
          broker: identity.broker.name,
          action: "create_file_content",
          outcome: "success",
          repoPath,
          branch: identity.broker.branch,
          content,
        });
        return jsonResult({ ...result, review_required: validation.reviewRequired });
      });
    },
  );

  server.registerTool(
    "vault_update_file",
    {
      title: "Update a vault proposal file",
      description: "Replace an existing file on the authenticated agent's fixed proposal branch.",
      inputSchema: writeInput,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    async ({ path: requestedPath, content, commit_message: requestedMessage }, context) => {
      let repoPath: string;
      try {
        repoPath = normalizeRepoPath(requestedPath);
      } catch (error) {
        return errorResult(error);
      }
      return runTool(services, context, "update_file", repoPath, async ({ policy, identity }) => {
        assertWritable(policy, identity, repoPath);
        const existing = await services.github.getFile(repoPath, identity.broker.branch);
        validateReplacement(existing.content, content);
        const validation = validateContent(repoPath, content, services.config, policy.surfaceRules);
        const result = await services.github.putFile(
          repoPath,
          identity.broker.branch,
          content,
          commitMessage(identity.agent.id, "update", repoPath, requestedMessage),
          existing.sha,
        );
        await services.audit.write({
          agentId: identity.agent.id,
          broker: identity.broker.name,
          action: "update_file_content",
          outcome: "success",
          repoPath,
          branch: identity.broker.branch,
          content,
        });
        return jsonResult({ ...result, review_required: validation.reviewRequired });
      });
    },
  );

  server.registerTool(
    "vault_append_file",
    {
      title: "Append to a vault proposal file",
      description: "Append text while preserving all existing bytes, including for append-only notes.",
      inputSchema: z.object({
        path: z.string().min(1),
        content: z.string().min(1),
        commit_message: z.string().max(120).optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ path: requestedPath, content: suffix, commit_message: requestedMessage }, context) => {
      let repoPath: string;
      try {
        repoPath = normalizeRepoPath(requestedPath);
      } catch (error) {
        return errorResult(error);
      }
      return runTool(services, context, "append_file", repoPath, async ({ policy, identity }) => {
        assertWritable(policy, identity, repoPath);
        const existing = await services.github.getFile(repoPath, identity.broker.branch);
        const content = appendContent(existing.content, suffix);
        validateReplacement(existing.content, content);
        const validation = validateContent(repoPath, content, services.config, policy.surfaceRules);
        const result = await services.github.putFile(
          repoPath,
          identity.broker.branch,
          content,
          commitMessage(identity.agent.id, "append", repoPath, requestedMessage),
          existing.sha,
        );
        await services.audit.write({
          agentId: identity.agent.id,
          broker: identity.broker.name,
          action: "append_file_content",
          outcome: "success",
          repoPath,
          branch: identity.broker.branch,
          content,
        });
        return jsonResult({ ...result, review_required: validation.reviewRequired });
      });
    },
  );

  return server;
}
