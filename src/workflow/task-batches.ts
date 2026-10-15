export function taskBatches(tasks: any[]): number[][] {
  const ids = new Map(tasks.map((task, index) => [String(task.id ?? index + 1), index]));
  const dependencies: Array<Array<number | undefined>> = tasks.map((task: any) => (Array.isArray(task.depends_on) ? task.depends_on : []).map((id: unknown) => ids.get(String(id))));
  if (dependencies.some((items: Array<number | undefined>) => items.some((index: number | undefined) => index === undefined))) {
    return tasks.map((_, index) => [index]);
  }
  const pending = new Set(tasks.map((_, index) => index));
  const complete = new Set<number>();
  const batches: number[][] = [];
  while (pending.size) {
    const ready = [...pending].filter((index: number) => dependencies[index].every((dependency: number | undefined) => dependency !== undefined && complete.has(dependency)));
    if (!ready.length) return tasks.map((_, index) => [index]);
    const batch: number[] = [];
    const claimedFiles = new Set<string>();
    for (const index of ready) {
      const files = Array.isArray(tasks[index].files) ? tasks[index].files.map(String) : [];
      if (!files.length || files.some((file: string) => claimedFiles.has(file))) continue;
      batch.push(index);
      files.forEach((file: string) => claimedFiles.add(file));
    }
    if (!batch.length) batch.push(ready[0]);
    batches.push(batch);
    batch.forEach((index) => { pending.delete(index); complete.add(index); });
  }
  return batches;
}
