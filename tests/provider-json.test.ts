import { describe, expect, it } from 'vitest';
import { jsonResponse } from '../src/provider.js';

describe('JSON responses', () => {
  it.each([
    ['{"ok":true}', { ok: true }],
    ['```json\n{"ok":false}\n```', { ok: false }],
    ['prefix {bad} then ' + JSON.stringify({ nested: { text: 'braces } { and "quote"', value: 1 } }) + ' suffix', { nested: { text: 'braces } { and "quote"', value: 1 } }],
    ['[1,2]', [1, 2]],
  ])('parses %s', (text, expected) => expect(jsonResponse(text)).toEqual(expected));
  it.each(['no JSON', '{invalid}', '{"unfinished":'])('rejects %s', (text) => expect(() => jsonResponse(text)).toThrow(/valid JSON/));
});
