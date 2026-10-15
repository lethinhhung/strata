import fs from 'node:fs';
import { findRoleFile, findCoreSpec } from './spec-discovery.js';

function promptFor(role, values) {
  const roleFile = findRoleFile(role);
  const definition = roleFile ? fs.readFileSync(roleFile, 'utf8') : '';
  const coreFile = findCoreSpec();
  const planningRoles = new Set(['epic_coordinator', 'stage_coordinator']);
  const core = planningRoles.has(role) && coreFile
    ? fs.readFileSync(coreFile, 'utf8')
    : 'The target repository and user epic are authoritative. Follow your role boundaries and the supplied task contract; do not invent requirements. Explore Agents and Validators are read-only. A stage passes only when its criteria, applicable checks, and validation are satisfied or an authorized blocker is recorded.';
  return `You are Strata's ${role.replace(/_/g, ' ')}. Follow the Strata workflow specification and this role definition.\n\n## Strata workflow\n${core}\n\n## Role definition\n${definition}\n\n${Object.entries(values).map(([key, value]) => `## ${key.replace(/_/g, ' ')}\n${value}`).join('\n\n')}\n`;
}

export { promptFor };
