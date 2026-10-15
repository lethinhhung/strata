import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdirSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function findRoleFile(role: string): string | undefined {
  const candidates = readdirSync(__dirname, { withFileTypes: true }).filter((d) => d.isFile());
  for (const file of candidates) {
    if (file.name.endsWith('.role.ts') || file.name.endsWith('.role.js')) {
      if (file.name.startsWith(role)) {
        return join(__dirname, file.name);
      }
    }
  }
  return undefined;
}

export function findCoreSpec(): string | undefined {
  const candidates = readdirSync(__dirname, { withFileTypes: true }).filter((d) => d.isFile());
  for (const file of candidates) {
    if (file.name.endsWith('.core.spec.ts') || file.name.endsWith('.core.spec.js')) {
      return join(__dirname, file.name);
    }
  }
  return undefined;
}
