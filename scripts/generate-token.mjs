import { createHash, randomBytes } from "node:crypto";

const token = `vault_${randomBytes(32).toString("base64url")}`;
const digest = createHash("sha256").update(token, "utf8").digest("hex");

process.stdout.write(`Bearer token (give only to the agent):\n${token}\n\n`);
process.stdout.write(`SHA-256 (store in config/tokens.yaml):\n${digest}\n`);
