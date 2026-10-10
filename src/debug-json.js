import fs from 'node:fs';

// Create an object similar to what's in the legacy record
const original = {
  type: 'agent',
  subtype: 'implement',
  stage_id: 'one',
  timestamp: '2026-01-01T00:00:02.000Z',
  duration_ms: 10
};

console.log('Original object:', JSON.stringify(original, null, 2));
console.log('Original completion_tokens:', original.completion_tokens);

// Save it to a file
const tmpFile = '/tmp/test.json';
const body = `# Strata test\n\n\`\`\`json\n${JSON.stringify(original, null, 2)}\n\`\`\`\n`;
fs.writeFileSync(tmpFile, body, { encoding: 'utf8' });

// Load it back
const contents = fs.readFileSync(tmpFile, 'utf8');
const fenced = contents.match(/```json\s*([\s\S]*?)```/i);
const parsed = JSON.parse(fenced?.[1] ?? contents);

console.log('Parsed object:', JSON.stringify(parsed, null, 2));
console.log('Parsed completion_tokens:', parsed.completion_tokens);
console.log('Type of completion_tokens:', typeof parsed.completion_tokens);