import { resolve, normalize, isAbsolute } from "path";
import { SandboxError } from "../errors/index.js";
import {
  isWindows,
  normalizePath,
  toPosixPath,
} from "../tools/platform.js";

export interface SandboxConfig {
  enabled: boolean;
  allowedPaths: string[];
  blockedCommands: string[];
  blockedPatterns: string[];
  maxCommandLength: number;
  allowNetwork: boolean;
}

export const DEFAULT_SANDBOX_CONFIG: SandboxConfig = {
  enabled: true,
  allowedPaths: [],
  blockedCommands: [
    "rm -rf /",
    "rm -rf /*",
    "mkfs",
    "dd if=/dev/zero",
    ":(){ :|:& };:",
    "chmod -R 777 /",
    "chown -R",
    "sudo rm",
    "sudo chmod",
    "sudo chown",
  ],
  blockedPatterns: [
    ":\\(\\)\\s*\\{\\s*:\\|:&\\s*\\}\\s*;:",
    "curl\\s+.*\\|\\s*(ba)?sh",
    "wget\\s+.*\\|\\s*(ba)?sh",
    "rm\\s+-[^ ]*r[^ ]*f[^ ]*\\s+/(?!Users|home|Users)[^ ]*",
    "rm\\s+-[^ ]*f[^ ]*r[^ ]*\\s+/(?!Users|home|Users)[^ ]*",
    "mkfs\\s+.*",
    "dd\\s+if=/dev/zero",
    "dd\\s+if=/dev/null",
    ">\\s*/dev/sd[a-z]",
    ">\\s*/dev/hd[a-z]",
    "chmod\\s+-R\\s+777\\s+/",
    "\\bshutdown\\b",
    "\\breboot\\b",
    "\\bhalt\\b",
    "\\bpoweroff\\b",
    "\\binit\\s+[06]\\b",
    "\\bsystemctl\\s+(reboot|poweroff|halt)",
    "\\biptables\\s+(-F|--flush)",
    "\\bip6tables\\s+(-F|--flush)",
    "\\bsetenforce\\s+0",
    "\\bfsck\\s+-.*",
  ],
  maxCommandLength: 10000,
  allowNetwork: false,
};

const DANGEROUS_COMMANDS = [
  "format",
  "del /s /q",
  "rmdir /s /q",
  "rd /s /q",
  "erase",
  "cipher /w",
];

const DANGEROUS_WINDOWS_PATTERNS = [
  /format\s+[a-z]:/i,
  /del\s+\/s\s+\/q/i,
  /rmdir\s+\/s\s+\/q/i,
  /rd\s+\/s\s+\/q/i,
  /cipher\s+\/w/i,
  /shutdown/i,
  /reboot/i,
  /bcdedit/i,
  /bootcfg/i,
];

export class SandboxGuard {
  private config: SandboxConfig;
  private resolvedAllowedPaths: Set<string>;

  constructor(config: Partial<SandboxConfig> = {}) {
    this.config = { ...DEFAULT_SANDBOX_CONFIG, ...config };
    this.resolvedAllowedPaths = new Set(
      this.config.allowedPaths.map((p) => normalizePath(resolve(p)))
    );
  }

  validatePath(path: string, workingDir: string): string {
    if (!this.config.enabled) {
      return normalizePath(isAbsolute(path) ? path : resolve(workingDir, path));
    }

    let resolvedPath: string;
    if (isAbsolute(path)) {
      resolvedPath = normalizePath(path);
    } else if (/^[a-zA-Z]:/.test(path)) {
      resolvedPath = normalizePath(path);
    } else {
      resolvedPath = normalizePath(resolve(workingDir, path));
    }

    const posixPath = toPosixPath(resolvedPath);
    const posixWorkingDir = toPosixPath(workingDir);

    if (posixPath.includes("..")) {
      const normalized = normalizePath(resolve(workingDir, path));
      const normalizedPosix = toPosixPath(normalized);
      if (normalizedPosix.startsWith(posixWorkingDir) || this.isPathAllowed(normalized)) {
        return normalized;
      }
    }

    if (!posixPath.startsWith(posixWorkingDir) && !this.isPathAllowed(resolvedPath)) {
      throw new SandboxError(
        "SANDBOX_PATH_BLOCKED",
        `Path escape detected: ${path} resolves outside allowed paths`
      );
    }

    return resolvedPath;
  }

  private isPathAllowed(path: string): boolean {
    if (this.resolvedAllowedPaths.size === 0) {
      return false;
    }

    const normalized = toPosixPath(normalizePath(path));
    for (const allowed of this.resolvedAllowedPaths) {
      const allowedNormalized = toPosixPath(allowed);
      if (normalized.startsWith(allowedNormalized)) {
        return true;
      }
    }
    return false;
  }

  validateCommand(command: string): void {
    if (!this.config.enabled) {
      return;
    }

    if (command.length > this.config.maxCommandLength) {
      throw new SandboxError(
        "SANDBOX_COMMAND_BLOCKED",
        `Command exceeds maximum length of ${this.config.maxCommandLength} characters`
      );
    }

    const normalizedCommand = command.toLowerCase().trim();

    for (const blocked of this.config.blockedCommands) {
      if (normalizedCommand.includes(blocked.toLowerCase())) {
        throw new SandboxError(
          "SANDBOX_COMMAND_BLOCKED",
          `Blocked command detected: contains "${blocked}"`
        );
      }
    }

    for (const pattern of this.config.blockedPatterns) {
      try {
        const regex = new RegExp(pattern, "i");
        if (regex.test(command)) {
          throw new SandboxError(
            "SANDBOX_COMMAND_BLOCKED",
            `Blocked command pattern detected`
          );
        }
      } catch {
        continue;
      }
    }

    if (isWindows()) {
      for (const pattern of DANGEROUS_WINDOWS_PATTERNS) {
        if (pattern.test(command)) {
          throw new SandboxError(
            "SANDBOX_COMMAND_BLOCKED",
            `Blocked dangerous Windows command pattern`
          );
        }
      }

      for (const dangerous of DANGEROUS_COMMANDS) {
        if (normalizedCommand.includes(dangerous.toLowerCase())) {
          throw new SandboxError(
            "SANDBOX_COMMAND_BLOCKED",
            `Blocked dangerous command: ${dangerous}`
          );
        }
      }
    }

    this.checkForForkBomb(command);
    this.checkForPipeToShell(command);
  }

  private checkForForkBomb(command: string): void {
    const forkBombPatterns = [
      /:\(\)\s*\{[^}]*:\|:&[^}]*\}\s*;:/,
      /\.\s*\(\)\s*\{[^}]*\.\s*\|.*&[^}]*\}/,
      /:\(\)\{[^}]*\|:&[^}]*\};:/,
    ];

    for (const pattern of forkBombPatterns) {
      if (pattern.test(command.replace(/\s+/g, " "))) {
        throw new SandboxError(
          "SANDBOX_COMMAND_BLOCKED",
          "Fork bomb pattern detected"
        );
      }
    }
  }

  private checkForPipeToShell(command: string): void {
    const pipeToShellPatterns = [
      /curl\s+[^|]+\|\s*(bash|sh|zsh|fish)/i,
      /wget\s+[^|]+\|\s*(bash|sh|zsh|fish)/i,
      /curl\s+[^|]+\|\s*(ba)?sh/i,
      /wget\s+[^|]+\|\s*(ba)?sh/i,
      /\|\s*(ba)?sh\s*$/i,
      /\|\s*(ba)?sh\s*<\s*\(/i,
    ];

    for (const pattern of pipeToShellPatterns) {
      if (pattern.test(command)) {
        throw new SandboxError(
          "SANDBOX_COMMAND_BLOCKED",
          "Pipe to shell from network command detected"
        );
      }
    }
  }

  addAllowedPath(path: string): void {
    const normalized = normalizePath(resolve(path));
    this.resolvedAllowedPaths.add(normalized);
    if (!this.config.allowedPaths.includes(path)) {
      this.config.allowedPaths.push(path);
    }
  }

  removeAllowedPath(path: string): void {
    const normalized = normalizePath(resolve(path));
    this.resolvedAllowedPaths.delete(normalized);
    this.config.allowedPaths = this.config.allowedPaths.filter(
      (p) => normalizePath(resolve(p)) !== normalized
    );
  }

  addBlockedCommand(command: string): void {
    if (!this.config.blockedCommands.includes(command)) {
      this.config.blockedCommands.push(command);
    }
  }

  addBlockedPattern(pattern: string): void {
    if (!this.config.blockedPatterns.includes(pattern)) {
      this.config.blockedPatterns.push(pattern);
    }
  }

  getConfig(): Readonly<SandboxConfig> {
    return { ...this.config };
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
  }

  isPathAllowedExplicitly(path: string): boolean {
    return this.isPathAllowed(path);
  }
}

export function createSandboxGuard(config?: Partial<SandboxConfig>): SandboxGuard {
  return new SandboxGuard(config);
}
