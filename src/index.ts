#!/usr/bin/env node
import { createMcpExpressApp, requireBearerAuth } from "@modelcontextprotocol/express";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";

import { AuditLogger } from "./audit.js";
import { TokenFileVerifier } from "./auth.js";
import { loadConfig } from "./config.js";
import {
  GitHubAppTokenProvider,
  GitHubRepositoryClient,
  StaticTokenProvider,
} from "./github.js";
import { PolicyStore } from "./policy.js";
import { createVaultMcpServer } from "./server.js";

import type { McpServer } from "@modelcontextprotocol/server";
import type { ErrorRequestHandler } from "express";

const config = loadConfig();
const policyStore = new PolicyStore(config.fleetFile);
await policyStore.getPolicy();

const tokenProvider = config.githubApp
  ? new GitHubAppTokenProvider(
      config.githubApp.appId,
      config.githubApp.installationId,
      config.githubApp.privateKeyFile,
      config.githubRepo,
    )
  : new StaticTokenProvider(config.githubToken!);
const github = new GitHubRepositoryClient(
  config.githubOwner,
  config.githubRepo,
  tokenProvider,
);
const audit = new AuditLogger(config.auditLog);
const services = { config, policyStore, github, audit };
// Stateless Streamable HTTP: the SDK does not reuse a stateless transport across
// requests, so each request gets its own server and transport, closed when the
// response closes. The services above are shared.
const openServers = new Set<McpServer>();

const app = createMcpExpressApp({
  host: config.host,
  jsonLimit: `${config.maxFileBytes + 32_768}b`,
  ...(config.allowedHosts ? { allowedHosts: config.allowedHosts } : {}),
  ...(config.allowedOrigins ? { allowedOrigins: config.allowedOrigins } : {}),
});
app.disable("x-powered-by");
if (config.trustProxyHops > 0) app.set("trust proxy", config.trustProxyHops);
app.use(helmet());

const verifier = new TokenFileVerifier(config.tokenFile);
const mcpRateLimit = rateLimit({
  windowMs: config.rateWindowMs,
  limit: config.rateLimit,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "rate_limit_exceeded" },
});

app.get("/healthz", (_request, response) => {
  response.json({ status: "ok", service: "obsidian-github-mcp" });
});

app.all(
  "/mcp",
  mcpRateLimit,
  requireBearerAuth({ verifier, requiredScopes: ["vault"] }),
  async (request, response) => {
    const mcpServer = createVaultMcpServer(services);
    const transport = new NodeStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    openServers.add(mcpServer);
    response.on("close", () => {
      openServers.delete(mcpServer);
      void mcpServer.close();
    });
    await mcpServer.connect(transport);
    await transport.handleRequest(request, response, request.body);
  },
);

app.use((_request, response) => {
  response.status(404).json({ error: "not_found" });
});

const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  void _next;
  process.stderr.write(`Request failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
  if (!response.headersSent) response.status(500).json({ error: "internal_server_error" });
};
app.use(errorHandler);

const httpServer = app.listen(config.port, config.host, () => {
  process.stdout.write(`Obsidian GitHub MCP listening on http://${config.host}:${config.port}/mcp\n`);
});
httpServer.requestTimeout = 30_000;
httpServer.headersTimeout = 35_000;
httpServer.keepAliveTimeout = 5_000;
httpServer.maxRequestsPerSocket = 1_000;

async function shutdown(): Promise<void> {
  httpServer.close();
  await Promise.allSettled([...openServers].map((server) => server.close()));
  openServers.clear();
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
