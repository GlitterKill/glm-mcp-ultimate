import { execSync } from "child_process";
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";

function resolvePath(workingDir: string, filePath: string): string {
  if (filePath.startsWith("/") || /^[a-zA-Z]:/.test(filePath)) {
    return filePath;
  }
  return resolve(workingDir, filePath);
}

export function executeToolCall(
  toolName: string,
  args: Record<string, unknown>,
  workingDir: string
): string {
  switch (toolName) {
    case "read_file": {
      const fullPath = resolvePath(workingDir, args.path as string);
      if (!existsSync(fullPath)) {
        return `Error: File not found: ${fullPath}`;
      }
      const content = readFileSync(fullPath, "utf-8");
      if (content.length > 50000) {
        return content.substring(0, 50000) + "\n... [truncated, file too large]";
      }
      return content;
    }

    case "write_file": {
      const fullPath = resolvePath(workingDir, args.path as string);
      const dir = dirname(fullPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(fullPath, args.content as string, "utf-8");
      return `File written successfully: ${fullPath}`;
    }

    case "edit_file": {
      const fullPath = resolvePath(workingDir, args.path as string);
      if (!existsSync(fullPath)) {
        return `Error: File not found: ${fullPath}`;
      }
      const fileContent = readFileSync(fullPath, "utf-8");
      const oldText = args.old_text as string;
      const newText = args.new_text as string;
      const occurrence = args.occurrence as number | undefined;
      const contextBefore = args.context_before as string | undefined;
      const contextAfter = args.context_after as string | undefined;

      let targetText = oldText;
      if (contextBefore) targetText = contextBefore + targetText;
      if (contextAfter) targetText = targetText + contextAfter;

      const parts = fileContent.split(targetText);
      if (parts.length === 1) {
        return `Error: Could not find the specified text in ${fullPath}. Make sure old_text and context match exactly (including whitespace).`;
      }

      if (parts.length > 2 && occurrence === undefined) {
        return `Error: Multiple occurrences found (${parts.length - 1}). Please provide 'occurrence' or more 'context' to disambiguate.`;
      }

      const index = occurrence !== undefined ? occurrence : 1;
      if (index < 1 || index >= parts.length) {
        return `Error: Invalid occurrence index ${index}. Total occurrences: ${parts.length - 1}.`;
      }

      // Reconstruct content by replacing only the specified occurrence
      let updatedContent = "";
      for (let i = 0; i < parts.length; i++) {
        updatedContent += parts[i];
        if (i < parts.length - 1) {
          if (i + 1 === index) {
            // Replace this occurrence
            const replacement = (contextBefore || "") + newText + (contextAfter || "");
            updatedContent += replacement;
          } else {
            // Keep original
            updatedContent += targetText;
          }
        }
      }

      writeFileSync(fullPath, updatedContent, "utf-8");
      return `File edited successfully: ${fullPath}`;
    }

    case "run_command": {
      const command = args.command as string;
      const timeout = (args.timeout as number) || 60000;
      try {
        const output = execSync(command, {
          cwd: workingDir,
          encoding: "utf-8",
          timeout: timeout,
          maxBuffer: 1024 * 1024,
          stdio: ["pipe", "pipe", "pipe"],
        });
        const result = output.trim();
        if (result.length > 20000) {
          return result.substring(0, 20000) + "\n... [truncated]";
        }
        return result || "(no output)";
      } catch (err: unknown) {
        const execErr = err as { stderr?: string; stdout?: string; status?: number; code?: string };
        if (execErr.code === "ETIMEDOUT") {
          return `Command failed: Timed out after ${timeout}ms`;
        }
        const stderr = execErr.stderr || "";
        const stdout = execErr.stdout || "";
        return `Command failed (exit code ${execErr.status}):\nstdout: ${stdout}\nstderr: ${stderr}`;
      }
    }

    case "list_files": {
      const fullPath = resolvePath(workingDir, args.path as string);
      if (!existsSync(fullPath)) {
        return `Error: Directory not found: ${fullPath}`;
      }

      const pattern = args.pattern as string | undefined;

      if (pattern) {
        try {
          const output = execSync(
            `find "${fullPath}" -name "${pattern}" -maxdepth 5 2>/dev/null | head -200`,
            { encoding: "utf-8", cwd: workingDir, timeout: 10000 }
          );
          return output.trim() || "(no matches)";
        } catch {
          return listDirectory(fullPath);
        }
      }

      return listDirectory(fullPath);
    }

    case "search_files": {
      const query = args.query as string;
      const searchPath = args.path
        ? resolvePath(workingDir, args.path as string)
        : workingDir;
      const filePattern = args.file_pattern as string | undefined;

      const includeFlag = filePattern ? `--include="${filePattern}"` : "";
      try {
        const output = execSync(
          `grep -rn ${includeFlag} "${query}" "${searchPath}" 2>/dev/null | head -100`,
          { encoding: "utf-8", cwd: workingDir, timeout: 15000 }
        );
        return output.trim() || "(no matches)";
      } catch {
        return "(no matches)";
      }
    }

    case "task_complete": {
      return `TASK_COMPLETE: ${args.summary as string}`;
    }

    default:
      return `Error: Unknown tool: ${toolName}`;
  }
}

function listDirectory(dirPath: string): string {
  const entries = readdirSync(dirPath, { withFileTypes: true });
  const lines: string[] = [];
  for (const entry of entries.slice(0, 200)) {
    const prefix = entry.isDirectory() ? "[DIR]  " : "       ";
    lines.push(`${prefix}${entry.name}`);
  }
  return lines.join("\n") || "(empty directory)";
}
