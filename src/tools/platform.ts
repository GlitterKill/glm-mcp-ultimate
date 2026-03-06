import { execSync, spawn, spawnSync } from "child_process";
import {
  readdirSync,
  readFileSync,
  statSync,
  existsSync,
  mkdirSync,
  writeFileSync,
  type Dirent,
} from "fs";
import { resolve, dirname, join, sep, normalize, isAbsolute } from "path";

export function isWindows(): boolean {
  return process.platform === "win32";
}

export function normalizePath(path: string): string {
  let normalized = normalize(path);
  if (isWindows()) {
    normalized = normalized.replace(/\//g, "\\");
  } else {
    normalized = normalized.replace(/\\/g, "/");
  }
  return normalized;
}

export function toPosixPath(path: string): string {
  return path.replace(/\\/g, "/");
}

export function resolvePath(basePath: string, relativePath: string): string {
  if (isAbsolute(relativePath)) {
    return normalizePath(relativePath);
  }
  if (/^[a-zA-Z]:/.test(relativePath)) {
    return normalizePath(relativePath);
  }
  return normalizePath(resolve(basePath, relativePath));
}

export interface FindFilesOptions {
  pattern?: string;
  maxDepth?: number;
  maxResults?: number;
  includeDirs?: boolean;
}

export interface FileMatch {
  path: string;
  isDirectory: boolean;
}

export function findFiles(
  rootPath: string,
  options: FindFilesOptions = {}
): FileMatch[] {
  const {
    pattern,
    maxDepth = 5,
    maxResults = 200,
    includeDirs = false,
  } = options;

  const results: FileMatch[] = [];
  const patternRegex = pattern ? globToRegex(pattern) : null;

  function walk(dir: string, depth: number): void {
    if (depth > maxDepth || results.length >= maxResults) return;

    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true }) as Dirent[];
    } catch {
      return;
    }

    for (const entry of entries) {
      if (results.length >= maxResults) break;

      const fullPath = join(dir, entry.name);
      const isDir = entry.isDirectory();

      if (!patternRegex || patternRegex.test(entry.name)) {
        if (includeDirs || !isDir) {
          results.push({
            path: normalizePath(fullPath),
            isDirectory: isDir,
          });
        }
      }

      if (isDir && depth < maxDepth) {
        walk(fullPath, depth + 1);
      }
    }
  }

  if (existsSync(rootPath)) {
    walk(rootPath, 0);
  }

  return results;
}

function globToRegex(pattern: string): RegExp {
  let regex = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${regex}$`, "i");
}

export interface SearchResult {
  file: string;
  line: number;
  column: number;
  content: string;
}

export interface SearchInFilesOptions {
  pattern: string | RegExp;
  filePattern?: string;
  maxResults?: number;
  contextLines?: number;
}

export function searchInFiles(
  rootPath: string,
  options: SearchInFilesOptions
): SearchResult[] {
  const {
    pattern,
    filePattern,
    maxResults = 100,
  } = options;

  const results: SearchResult[] = [];
  const searchRegex =
    typeof pattern === "string" ? new RegExp(pattern, "gm") : new RegExp(pattern.source, pattern.flags + "m");
  const fileRegex = filePattern ? globToRegex(filePattern) : null;

  function searchFile(filePath: string): void {
    let content: string;
    try {
      content = readFileSync(filePath, "utf-8");
    } catch {
      return;
    }

    const lines = content.split("\n");
    let match: RegExpExecArray | null;

    searchRegex.lastIndex = 0;

    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
      const line = lines[lineNum];
      searchRegex.lastIndex = 0;

      while ((match = searchRegex.exec(line)) !== null) {
        if (results.length >= maxResults) return;

        results.push({
          file: normalizePath(filePath),
          line: lineNum + 1,
          column: match.index + 1,
          content: line.trimEnd(),
        });

        if (!searchRegex.global) break;
      }
    }
  }

  function walk(dir: string): void {
    if (results.length >= maxResults) return;

    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true }) as Dirent[];
    } catch {
      return;
    }

    for (const entry of entries) {
      if (results.length >= maxResults) break;

      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        if (!fileRegex || fileRegex.test(entry.name)) {
          searchFile(fullPath);
        }
      }
    }
  }

  if (existsSync(rootPath)) {
    walk(rootPath);
  }

  return results;
}

export interface RunCommandOptions {
  cwd?: string;
  timeout?: number;
  maxBuffer?: number;
  env?: Record<string, string>;
  shell?: boolean;
}

export interface RunCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  success: boolean;
}

export function runCommand(
  command: string,
  args: string[] = [],
  options: RunCommandOptions = {}
): RunCommandResult {
  const {
    cwd = process.cwd(),
    timeout = 60000,
    maxBuffer = 1024 * 1024,
    env = {},
    shell = true,
  } = options;

  const mergedEnv = { ...process.env, ...env };

  try {
    const finalCommand = shell && args.length > 0 
      ? `${command} ${args.map(escapeArg).join(" ")}` 
      : command;
    const finalArgs = shell ? [] : args;

    const result = spawnSync(
      finalCommand,
      finalArgs,
      {
        cwd,
        timeout,
        maxBuffer,
        env: mergedEnv,
        shell,
        encoding: "utf-8",
        windowsHide: true,
      }
    );

    if (result.error) {
      return {
        stdout: result.stdout?.toString() || "",
        stderr: result.stderr?.toString() || result.error.message || "",
        exitCode: (result.error as any).status ?? 1,
        success: false,
      };
    }

    return {
      stdout: result.stdout?.toString() || "",
      stderr: result.stderr?.toString() || "",
      exitCode: result.status ?? 0,
      success: result.status === 0,
    };
  } catch (err: unknown) {
    const execErr = err as {
      stdout?: string;
      stderr?: string;
      status?: number;
      signal?: string;
    };

    return {
      stdout: execErr.stdout?.toString() || "",
      stderr: execErr.stderr?.toString() || "",
      exitCode: execErr.status ?? 1,
      success: false,
    };
  }
}

function escapeArg(arg: string): string {
  if (isWindows()) {
    if (/[ "']/.test(arg)) {
      return `"${arg.replace(/"/g, '""')}"`;
    }
    return arg;
  } else {
    if (/[ "']/.test(arg)) {
      return `'${arg.replace(/'/g, "'\\''")}'`;
    }
    return arg;
  }
}

export function runCommandAsync(
  command: string,
  args: string[] = [],
  options: RunCommandOptions = {}
): Promise<RunCommandResult> {
  return new Promise((resolve) => {
    const {
      cwd = process.cwd(),
      timeout = 60000,
      env = {},
      shell = true,
    } = options;

    const mergedEnv = { ...process.env, ...env };

    const proc = spawn(command, args, {
      cwd,
      env: mergedEnv,
      shell,
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    if (timeout > 0) {
      timeoutId = setTimeout(() => {
        proc.kill();
        stderr += "\nCommand timed out";
      }, timeout);
    }

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (timeoutId) clearTimeout(timeoutId);
      resolve({
        stdout,
        stderr,
        exitCode: code ?? 1,
        success: code === 0,
      });
    });

    proc.on("error", (err) => {
      if (timeoutId) clearTimeout(timeoutId);
      resolve({
        stdout,
        stderr: err.message,
        exitCode: 1,
        success: false,
      });
    });
  });
}

export function listDirectory(dirPath: string): string {
  if (!existsSync(dirPath)) {
    return `Error: Directory not found: ${dirPath}`;
  }

  const entries = readdirSync(dirPath, { withFileTypes: true });
  const lines: string[] = [];

  for (const entry of entries.slice(0, 200)) {
    const prefix = entry.isDirectory() ? "[DIR]  " : "       ";
    lines.push(`${prefix}${entry.name}`);
  }

  return lines.join("\n") || "(empty directory)";
}

export function ensureDirectory(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}

export function getFileSize(filePath: string): number {
  try {
    const stats = statSync(filePath);
    return stats.size;
  } catch {
    return 0;
  }
}

export function readFile(
  filePath: string,
  maxSize: number = 50000
): { content: string; truncated: boolean } {
  const size = getFileSize(filePath);
  if (size > maxSize * 2) {
    const content = readFileSync(filePath, "utf-8");
    return {
      content: content.substring(0, maxSize) + "\n... [truncated, file too large]",
      truncated: true,
    };
  }
  return {
    content: readFileSync(filePath, "utf-8"),
    truncated: false,
  };
}

export function writeFile(
  filePath: string,
  content: string
): void {
  const dir = dirname(filePath);
  ensureDirectory(dir);
  writeFileSync(filePath, content, "utf-8");
}

export function editFile(
  filePath: string,
  oldText: string,
  newText: string
): { success: boolean; message: string } {
  if (!existsSync(filePath)) {
    return { success: false, message: `File not found: ${filePath}` };
  }

  const content = readFileSync(filePath, "utf-8");

  if (!content.includes(oldText)) {
    return {
      success: false,
      message: `Could not find the specified text in ${filePath}. Make sure old_text matches exactly (including whitespace).`,
    };
  }

  const updated = content.replace(oldText, newText);
  writeFileSync(filePath, updated, "utf-8");

  return { success: true, message: `File edited successfully: ${filePath}` };
}
