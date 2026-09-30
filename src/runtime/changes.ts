export function changes(before: Map<string, string>, after: Map<string, string>): string[] {
   const paths = new Set([...Array.from(before.keys()), ...Array.from(after.keys())]);
   return Array.from(paths).filter((file) => before.get(file) !== after.get(file)).sort();
}