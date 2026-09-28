import { spawnSync } from 'node:child_process';

export function runChecks(repo: string, commands: string[][], kind: string) {
  return commands.map((command) => {
    const result = spawnSync(command[0], command.slice(1), { cwd: repo, encoding: 'utf8', shell: false, timeout: 10 * 60 * 1000, maxBuffer: 4 * 1024 * 1024 });
    if (result.error) return { kind, command, passed: false, error: result.error.message, exit_code: result.status };
    return { kind, command, exit_code: result.status, signal: result.signal,
      stdout: (result.stdout ?? '').slice(-12_000), stderr: (result.stderr ?? '').slice(-12_000), passed: result.status === 0 };
  });
}
