import fs from 'node:fs';
import path from 'node:path';

export function save(record: any, file: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  const body = `# Strata run ${record.run_id}\n\n\`\`\`json\n${JSON.stringify(record, null, 2)}\n\`\`\`\n`;
  fs.writeFileSync(temporary, body, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, file);
}
