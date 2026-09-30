export function implementationCanProceed(status: string, testOnly: boolean, changes: string[], allowNoChanges = false) {
  return testOnly ? status === 'pass' : allowNoChanges || changes.length > 0;
}
