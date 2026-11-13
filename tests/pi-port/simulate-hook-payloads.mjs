#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..', '..');
const ECC_ROOT = path.join(ROOT, 'ecc');
const RUNNER = path.join(ECC_ROOT, 'scripts', 'hooks', 'run-with-flags.js');

function runCase(name, { hookId, script, profiles, payload, env = {}, cwd = ROOT, expect }) {
  const result = spawnSync(process.execPath, [RUNNER, hookId, script, profiles], {
    cwd,
    env: {
      ...process.env,
      CLAUDE_PLUGIN_ROOT: ECC_ROOT,
      ECC_PLUGIN_ROOT: ECC_ROOT,
      CLAUDE_PROJECT_DIR: cwd,
      ECC_HOOK_PROFILE: env.ECC_HOOK_PROFILE || process.env.ECC_HOOK_PROFILE || 'standard',
      ECC_DISABLED_HOOKS: env.ECC_DISABLED_HOOKS || '',
      ...env,
    },
    input: JSON.stringify(payload),
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 1024 * 1024,
  });

  const okExit = expect.exitCodes ? expect.exitCodes.includes(result.status) : result.status === expect.exitCode;
  const stdout = result.stdout || '';
  const stderr = result.stderr || '';
  const checks = [okExit];
  if (expect.stdoutIncludes) checks.push(expect.stdoutIncludes.every(s => stdout.includes(s)));
  if (expect.stdoutExcludes) checks.push(expect.stdoutExcludes.every(s => !stdout.includes(s)));
  if (expect.stderrIncludes) checks.push(expect.stderrIncludes.every(s => stderr.toLowerCase().includes(s.toLowerCase())));
  if (expect.stdoutJsonHasAdditionalContext !== undefined) {
    let has = false;
    try {
      const parsed = JSON.parse(stdout);
      has = Boolean(parsed?.hookSpecificOutput?.additionalContext);
    } catch {
      has = false;
    }
    checks.push(has === expect.stdoutJsonHasAdditionalContext);
  }
  const pass = checks.every(Boolean);

  return {
    name,
    pass,
    status: result.status,
    signal: result.signal,
    stdout: stdout.slice(0, 400),
    stderr: stderr.slice(0, 400),
    error: result.error ? result.error.message : null,
  };
}

function main() {
  if (!fs.existsSync(RUNNER)) {
    console.error(`Missing runner: ${RUNNER}`);
    process.exit(1);
  }

  const cases = [];

  cases.push(runCase('PreToolUse safe bash command is allowed', {
    hookId: 'pre:bash:dispatcher',
    script: 'scripts/hooks/pre-bash-dispatcher.js',
    profiles: 'minimal,standard,strict',
    payload: {
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'echo hello' },
      session_id: 'test-session',
      cwd: ROOT,
    },
    expect: { exitCode: 0 },
  }));

  cases.push(runCase('PreToolUse dangerous git commit --no-verify is blocked', {
    hookId: 'pre:bash:dispatcher',
    script: 'scripts/hooks/pre-bash-dispatcher.js',
    profiles: 'minimal,standard,strict',
    payload: {
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'git commit -m "test" --no-verify' },
      session_id: 'test-session',
      cwd: ROOT,
    },
    expect: { exitCode: 2, stderrIncludes: ['BLOCKED'] },
  }));

  cases.push(runCase('SessionStart receives translated payload and exits cleanly', {
    hookId: 'session:start',
    script: 'scripts/hooks/session-start.js',
    profiles: 'minimal,standard,strict',
    payload: {
      hook_event_name: 'SessionStart',
      source: 'startup',
      reason: 'startup',
      session_id: 'test-session-start',
      cwd: ROOT,
    },
    expect: { exitCodes: [0] },
  }));

  cases.push(runCase('SessionEnd marker (session context save/cleanup) receives payload and passes through', {
    hookId: 'session:end:marker',
    script: 'scripts/hooks/session-end-marker.js',
    profiles: 'minimal,standard,strict',
    payload: {
      hook_event_name: 'SessionEnd',
      reason: 'quit',
      session_id: 'test-session-end',
      cwd: ROOT,
    },
    expect: { exitCode: 0 },
  }));

  cases.push(runCase('PreCompact receives translated payload and exits cleanly', {
    hookId: 'pre:compact',
    script: 'scripts/hooks/pre-compact.js',
    profiles: 'standard,strict',
    payload: {
      hook_event_name: 'PreCompact',
      reason: 'manual',
      session_id: 'test-session-compact',
      cwd: ROOT,
      transcript_path: '',
    },
    env: { ECC_HOOK_PROFILE: 'standard' },
    expect: { exitCodes: [0] },
  }));

  cases.push(runCase('PostToolUse quality-gate accepts Edit payload shape (best-effort)', {
    hookId: 'post:quality-gate',
    script: 'scripts/hooks/quality-gate.js',
    profiles: 'standard,strict',
    payload: {
      hook_event_name: 'PostToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: 'nonexistent-file-for-hook-test.ts' },
      tool_output: { content: [], isError: false },
      session_id: 'test-session-post',
      cwd: ROOT,
    },
    env: { ECC_HOOK_PROFILE: 'standard' },
    expect: { exitCodes: [0] },
  }));

  let failed = 0;
  for (const c of cases) {
    const status = c.pass ? 'PASS' : 'FAIL';
    if (!c.pass) failed++;
    console.log(`${status} - ${c.name}`);
    console.log(`  exit=${c.status} signal=${c.signal || ''} error=${c.error || ''}`);
    if (!c.pass) {
      if (c.stdout) console.log(`  stdout: ${JSON.stringify(c.stdout)}`);
      if (c.stderr) console.log(`  stderr: ${JSON.stringify(c.stderr)}`);
    }
  }

  console.log(`\n${cases.length - failed}/${cases.length} checks passed`);
  process.exit(failed ? 1 : 0);
}

main();
