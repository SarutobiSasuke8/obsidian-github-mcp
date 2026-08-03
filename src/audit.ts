import { createHash } from "node:crypto";
import { mkdir, appendFile } from "node:fs/promises";
import path from "node:path";

export interface AuditEvent {
  agentId: string;
  broker: string;
  action: string;
  outcome: "success" | "denied" | "error";
  repoPath?: string;
  branch?: string;
  content?: string;
  detail?: string;
}

export class AuditLogger {
  public constructor(private readonly filePath: string) {}

  public async write(event: AuditEvent): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const record = {
      timestamp: new Date().toISOString(),
      agent_id: event.agentId,
      broker: event.broker,
      action: event.action,
      outcome: event.outcome,
      ...(event.repoPath ? { path: event.repoPath } : {}),
      ...(event.branch ? { branch: event.branch } : {}),
      ...(event.content
        ? {
            content_bytes: Buffer.byteLength(event.content, "utf8"),
            content_sha256: createHash("sha256").update(event.content, "utf8").digest("hex"),
          }
        : {}),
      ...(event.detail ? { detail: event.detail.slice(0, 500) } : {}),
    };
    await appendFile(this.filePath, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
  }
}
