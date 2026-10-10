import { spawn } from 'node:child_process';
import type { AgentConfig } from './config.js';

export async function invoke(agent: AgentConfig, prompt: string, cwd: string, readOnly = false): Promise<string> {
  const args = agent.provider === 'codex'
    ? ['exec', '--json', '--cd', cwd, '--sandbox', readOnly ? 'read-only' : 'workspace-write', '--config', 'approval_policy="never"', ...(agent.model ? ['--model', agent.model] : []), ...agent.extra_args, prompt]
    : ['run', '--format', 'json', '--dir', cwd, ...(agent.model ? ['--model', agent.model] : []), ...agent.extra_args, prompt];
  const role = prompt.match(/^You are Strata's ([^.]+)\./m)?.[1] ?? `${agent.provider} agent`;
  const started = Date.now();
  console.error(`[strata] ${role} started (${agent.provider}${agent.model ? ` / ${agent.model}` : ''})`);
  const heartbeat = setInterval(() => {
    console.error(`[strata] waiting for ${role} (${Math.floor((Date.now() - started) / 1000)}s)`);
  }, 30_000);
  let result;
  try {
    result = await run(agent.command, args, cwd, agent.timeout_seconds * 1000);
  } finally {
    clearInterval(heartbeat);
  }
  if (result.timedOut) throw new Error(`${agent.provider} timed out after ${agent.timeout_seconds}s`);
  if (result.code !== 0) throw new Error(`${agent.provider} exited ${result.code}: ${(result.stderr || result.stdout).slice(-3000)}`);
  const text = agent.provider === 'codex' ? codexText(result.stdout) : openCodeText(result.stdout);
  if (!text.trim()) throw new Error(`${agent.provider} returned no agent response`);
  console.error(`[strata] ${role} completed in ${Math.floor((Date.now() - started) / 1000)}s`);
  return text;
}

export function jsonResponse(text: string): any {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(trimmed); } catch { /* try embedded object */ }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(trimmed.slice(start, end + 1)); } catch { /* report useful context below */ }
  }
  throw new Error(`Agent response did not contain valid JSON: ${text.slice(0, 1000)}`);
}

function codexText(output: string): string {
  const messages: string[] = [];
  for (const line of output.split('\n')) {
    try {
      const event = JSON.parse(line);
      if (event.type === 'item.completed' && event.item?.type === 'agent_message' && typeof event.item.text === 'string') messages.push(event.item.text);
      if (event.type === 'turn.completed' && typeof event.text === 'string') messages.push(event.text);
    } catch { /* Codex can include non-JSON diagnostic lines. */ }
  }
  return messages.at(-1) ?? output;
}

function openCodeText(output: string): string {
  const messages: string[] = [];
  for (const line of output.split('\n')) {
    try {
      const item = JSON.parse(line);
      if (typeof item.text === 'string' && (item.type === 'text' || item.part?.type === 'text')) messages.push(item.text);
      else if (typeof item.part?.text === 'string') messages.push(item.part.text);
    } catch { /* tolerate provider log lines */ }
  }
  return messages.join('\n') || output;
}

export function run(command: string, args: string[], cwd: string, timeout: number): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); setTimeout(() => child.kill('SIGKILL'), 2000).unref(); }, timeout);
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', (error) => { if (!settled) { settled = true; clearTimeout(timer); reject(error); } });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8'), timedOut });
    });
  });
}
