import { describe, it, expect, beforeEach, afterAll } from "vitest";
import {
  isWindows,
  normalizePath,
  toPosixPath,
  resolvePath,
  findFiles,
  searchInFiles,
  runCommand,
  listDirectory,
  readFile,
  writeFile,
  editFile,
  ensureDirectory,
  getFileSize,
} from "../src/tools/platform.js";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "fs";
import { join, sep } from "path";

describe("platform utilities", () => {
  describe("isWindows", () => {
    it("should return boolean based on platform", () => {
      expect(typeof isWindows()).toBe("boolean");
    });
  });

  describe("normalizePath", () => {
    it("should normalize paths with correct separators", () => {
      const result = normalizePath("foo/bar/baz");
      if (isWindows()) {
        expect(result).toBe(`foo${sep}bar${sep}baz`);
      } else {
        expect(result).toBe("foo/bar/baz");
      }
    });

    it("should handle mixed separators", () => {
      const result = normalizePath("foo\\bar/baz");
      if (isWindows()) {
        expect(result).toBe(`foo${sep}bar${sep}baz`);
      } else {
        expect(result).toBe("foo/bar/baz");
      }
    });
  });

  describe("toPosixPath", () => {
    it("should convert backslashes to forward slashes", () => {
      expect(toPosixPath("foo\\bar\\baz")).toBe("foo/bar/baz");
    });

    it("should handle mixed separators", () => {
      expect(toPosixPath("foo\\bar/baz")).toBe("foo/bar/baz");
    });
  });

  describe("resolvePath", () => {
    it("should resolve relative paths", () => {
      const result = resolvePath("/base/path", "relative/path");
      expect(toPosixPath(result)).toContain("relative/path");
    });

    it("should return absolute paths as-is", () => {
      const result = resolvePath("/base/path", "/absolute/path");
      expect(toPosixPath(result)).toBe("/absolute/path");
    });

    it("should handle Windows absolute paths", () => {
      const result = resolvePath("C:\\base", "D:\\other");
      expect(result).toBe(normalizePath("D:\\other"));
    });
  });
});

describe("findFiles", () => {
  const testDir = join(process.cwd(), "test-find-dir");

  beforeEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });
    mkdirSync(join(testDir, "subdir"), { recursive: true });
    writeFileSync(join(testDir, "file1.txt"), "content1");
    writeFileSync(join(testDir, "file2.js"), "content2");
    writeFileSync(join(testDir, "subdir", "file3.txt"), "content3");
  });

  afterAll(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("should find all files without pattern", () => {
    const results = findFiles(testDir);
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results.some((r) => r.path.endsWith("file1.txt"))).toBe(true);
    expect(results.some((r) => r.path.endsWith("file2.js"))).toBe(true);
  });

  it("should filter by pattern", () => {
    const results = findFiles(testDir, { pattern: "*.txt" });
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results.every((r) => r.path.endsWith(".txt"))).toBe(true);
  });

  it("should respect maxDepth", () => {
    const results = findFiles(testDir, { maxDepth: 0 });
    expect(results.every((r) => !r.path.includes("subdir"))).toBe(true);
  });

  it("should respect maxResults", () => {
    const results = findFiles(testDir, { maxResults: 1 });
    expect(results.length).toBe(1);
  });

  it("should include directories when requested", () => {
    const results = findFiles(testDir, { includeDirs: true });
    expect(results.some((r) => r.isDirectory)).toBe(true);
  });

  it("should return empty array for non-existent path", () => {
    const results = findFiles("/non/existent/path");
    expect(results).toEqual([]);
  });
});

describe("searchInFiles", () => {
  const testDir = join(process.cwd(), "test-search-dir");

  beforeEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, "file1.txt"), "hello world\nfoo bar");
    writeFileSync(join(testDir, "file2.js"), "const hello = 'test';\n// foo");
  });

  afterAll(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("should find matches with string pattern", () => {
    const results = searchInFiles(testDir, { pattern: "hello" });
    expect(results.length).toBe(2);
  });

  it("should find matches with regex pattern", () => {
    const results = searchInFiles(testDir, { pattern: /foo/ });
    expect(results.length).toBe(2);
  });

  it("should filter by file pattern", () => {
    const results = searchInFiles(testDir, {
      pattern: "hello",
      filePattern: "*.js",
    });
    expect(results.length).toBe(1);
    expect(results[0].file.endsWith(".js")).toBe(true);
  });

  it("should respect maxResults", () => {
    const results = searchInFiles(testDir, { pattern: "hello", maxResults: 1 });
    expect(results.length).toBe(1);
  });

  it("should include line and column numbers", () => {
    const results = searchInFiles(testDir, { pattern: "hello" });
    expect(results[0].line).toBeGreaterThan(0);
    expect(results[0].column).toBeGreaterThan(0);
  });

  it("should return empty array for non-existent path", () => {
    const results = searchInFiles("/non/existent/path", { pattern: "test" });
    expect(results).toEqual([]);
  });
});

describe("runCommand", () => {
  it("should execute simple command", () => {
    const result = runCommand("echo", ["hello"]);
    expect(result.success).toBe(true);
    expect(result.stdout.trim()).toBe("hello");
  });

  it("should handle failed commands", () => {
    const result = runCommand("node", ["-e", "process.exit(1)"]);
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
  });

    it("should capture stderr", () => {
      const result = runCommand("node", ["-e", "process.stderr.write('error message')"]);
      expect(result.stderr + result.stdout).toContain("error message");
    });

  it("should respect timeout", () => {
    const result = runCommand("node", ["-e", "setTimeout(() => {}, 5000)"], {
      timeout: 100,
    });
    expect(result.success).toBe(false);
  });

  it("should use custom cwd", () => {
    const result = runCommand("node", ["-e", "console.log(process.cwd())"], {
      cwd: process.cwd(),
    });
    expect(result.stdout).toContain(process.cwd());
  });
});

describe("file operations", () => {
  const testDir = join(process.cwd(), "test-file-ops");
  const testFile = join(testDir, "test.txt");

  beforeEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });
    writeFileSync(testFile, "original content\nline 2\nline 3");
  });

  afterAll(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("listDirectory", () => {
    it("should list directory contents", () => {
      const result = listDirectory(testDir);
      expect(result).toContain("test.txt");
    });

    it("should return error for non-existent directory", () => {
      const result = listDirectory("/non/existent/path");
      expect(result).toContain("Error:");
    });
  });

  describe("readFile", () => {
    it("should read file contents", () => {
      const { content, truncated } = readFile(testFile);
      expect(content).toContain("original content");
      expect(truncated).toBe(false);
    });
  });

  describe("writeFile", () => {
    it("should write file contents", () => {
      const newPath = join(testDir, "new.txt");
      writeFile(newPath, "new content");
      expect(existsSync(newPath)).toBe(true);
      const { content } = readFile(newPath);
      expect(content).toBe("new content");
    });

    it("should create directories if needed", () => {
      const nestedPath = join(testDir, "nested", "dir", "file.txt");
      writeFile(nestedPath, "nested content");
      expect(existsSync(nestedPath)).toBe(true);
    });
  });

  describe("editFile", () => {
    it("should replace text in file", () => {
      const result = editFile(testFile, "original content", "modified content");
      expect(result.success).toBe(true);
      const { content } = readFile(testFile);
      expect(content).toContain("modified content");
    });

    it("should fail if text not found", () => {
      const result = editFile(testFile, "non-existent", "replacement");
      expect(result.success).toBe(false);
      expect(result.message).toContain("Could not find");
    });

    it("should fail for non-existent file", () => {
      const result = editFile("/non/existent/file.txt", "old", "new");
      expect(result.success).toBe(false);
      expect(result.message).toContain("not found");
    });
  });

  describe("ensureDirectory", () => {
    it("should create nested directories", () => {
      const nestedDir = join(testDir, "deeply", "nested", "dir");
      ensureDirectory(nestedDir);
      expect(existsSync(nestedDir)).toBe(true);
    });

    it("should not fail if directory exists", () => {
      ensureDirectory(testDir);
      expect(existsSync(testDir)).toBe(true);
    });
  });

  describe("getFileSize", () => {
    it("should return file size", () => {
      const size = getFileSize(testFile);
      expect(size).toBeGreaterThan(0);
    });

    it("should return 0 for non-existent file", () => {
      const size = getFileSize("/non/existent/file.txt");
      expect(size).toBe(0);
    });
  });
});
