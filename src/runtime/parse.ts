import { RunError } from './types.js';

export function parseObject(text: string, role: string) {
  const value = text.trim();
  try {
    const object = JSON.parse(value);
    if (object && typeof object === 'object' && !Array.isArray(object)) return object;
  } catch { /* Try a fenced or embedded JSON object below. */ }
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? value.slice(value.indexOf('{'), value.lastIndexOf('}') + 1);
  try {
    const object = JSON.parse(candidate);
    if (object && typeof object === 'object' && !Array.isArray(object)) return object;
  } catch { /* Report a stable structured-output error. */ }
  const preview = value.replace(/\s+/g, ' ').slice(0, 500);
  throw new RunError(`${role} did not return a JSON object${preview ? ` (response began: ${preview})` : ' (response was empty)'}`);
}