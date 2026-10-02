export function isTestPath(filePath: string) {
  const normalized = filePath.replace(/\\/g, '/');
  const parts = normalized.split('/');
  const file = parts.at(-1) ?? '';
  return /\.(test|spec)\.[^.]+$/i.test(file) || parts.some((part) =>
    ['test', 'tests', '__tests__', '__mocks__'].includes(part));
}
