export function canEditProjectPath(filePath: string, repo: string, record: any, runFile: string) {
  const normalized = filePath.replace(/\\/g, '/');
  if (normalized.startsWith('/') || normalized === '..' || normalized.startsWith('../')) return false;
  const normalizedRepo = repo.replace(/\\/g, '/').replace(/\/$/, '');
  const relative = (target: string | undefined) => {
    if (!target) return '';
    const value = target.replace(/\\/g, '/');
    return value.startsWith(`${normalizedRepo}/`) ? value.slice(normalizedRepo.length + 1) : value;
  };
  const protectedPaths = [record.epic_path || record.epic_absolute_path, runFile].map(relative);
  return !['memory/', 'docs/temps/', '.strata/'].some((prefix) => normalized.startsWith(prefix)) &&
    !protectedPaths.includes(normalized);
}
