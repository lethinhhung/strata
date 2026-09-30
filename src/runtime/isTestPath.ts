import path from 'node:path';

export function isTestPath(file: string) {
  const value = file.toLowerCase();
  const name = path.posix.basename(value);
  return value.startsWith('test/') || value.includes('/test/') || value.includes('/tests/') ||
    value.includes('/__tests__/') || name.startsWith('test_') || name.endsWith('_test.py') ||
    /\.(test|spec)\.[^.]+$/.test(name) || name === 'test' || name === 'tests';
}
