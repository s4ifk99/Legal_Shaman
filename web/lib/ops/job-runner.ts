import { spawn } from "node:child_process";
import path from "node:path";

export type JobStepResult = {
  name: string;
  ok: boolean;
  exitCode: number;
  detail?: string;
};

export async function runShellCommand(
  command: string,
  args: string[],
  env?: Record<string, string>,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const webRoot = process.cwd();
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: webRoot,
      env: { ...process.env, ...env },
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => {
      stdout += String(d);
    });
    child.stderr?.on("data", (d) => {
      stderr += String(d);
    });
    child.on("close", (code) => {
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });
  });
}

/** Run an npm script from web/ package.json. */
export async function runNpmScript(
  script: string,
  extraArgs: string[] = [],
  env?: Record<string, string>,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  const args = extraArgs.length > 0 ? ["run", script, "--", ...extraArgs] : ["run", script];
  return runShellCommand(npmCmd, args, env);
}

export async function runJobStep(
  name: string,
  fn: () => Promise<{ ok: boolean; detail?: string }>,
): Promise<JobStepResult> {
  try {
    const result = await fn();
    return {
      name,
      ok: result.ok,
      exitCode: result.ok ? 0 : 1,
      detail: result.detail,
    };
  } catch (e) {
    return {
      name,
      ok: false,
      exitCode: 1,
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function runNpmStep(
  name: string,
  script: string,
  extraArgs: string[] = [],
  env?: Record<string, string>,
): Promise<JobStepResult> {
  const { exitCode, stdout, stderr } = await runNpmScript(script, extraArgs, env);
  const tail = (stderr || stdout).trim().split("\n").slice(-3).join(" ");
  return {
    name,
    ok: exitCode === 0,
    exitCode,
    detail: exitCode === 0 ? undefined : tail || `exit ${exitCode}`,
  };
}

export function summarizeSteps(steps: JobStepResult[]): {
  ok: boolean;
  errors: string[];
} {
  const errors = steps.filter((s) => !s.ok).map((s) => `${s.name}: ${s.detail ?? "failed"}`);
  return { ok: errors.length === 0, errors };
}

export function logJobEvent(event: string, payload: Record<string, unknown>): void {
  console.info(JSON.stringify({ event, ...payload, cwd: path.basename(process.cwd()) }));
}
