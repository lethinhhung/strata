import { readFileSync } from 'node:fs';
import { findRoleFile, findCoreSpec } from './spec-discovery.js';

export function promptFor(role: string, values: Record<string, string>): string {
  const roleFile = findRoleFile(role);
  const definition = roleFile ? readFileSync(roleFile, 'utf8') : '';
  const coreFile = findCoreSpec();
  const planningRoles = new Set(['epic_coordinator', 'stage_coordinator']);
  const core = planningRoles.has(role) && coreFile
    ? readFileSync(coreFile, 'utf8')
    : 'The target repository and user epic are authoritative. Follow your role boundaries and the supplied task contract; do not invent requirements. Explore Agents and Validators are read-only. A stage passes only when its criteria, applicable checks, and validation are satisfied or an authorized blocker is recorded.';
  return `You are Strata's ${role.replaceAll('_', ' ')}. Follow the Strata workflow specification and this role definition.\n\n## Strata workflow\n${core}\n\n## Role definition\n${definition}\n\n${Object.entries(values).map(([key, value]) => `## ${key.replaceAll('_', ' ')}\n${value}`).join('\n\n')}`;
}
