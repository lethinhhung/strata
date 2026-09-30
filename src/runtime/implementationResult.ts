export function implementationCanProceed(status: string, testOnly: boolean, changes: string[]) {
  return testOnly ? status === 'pass' : changes.length > 0;
}
