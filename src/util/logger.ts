import { LOG_LEVELS, type LogLevel } from "../config/types.js";

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

export interface LoggerOptions {
  level?: LogLevel;
  name?: string;
  output?: (entry: LogEntry) => void;
}

export class Logger {
  private readonly level: LogLevel;
  private readonly name: string;
  private readonly output: (entry: LogEntry) => void;

  constructor(options: LoggerOptions = {}) {
    this.level = options.level ?? "info";
    this.name = options.name ?? "glm-mcp-ultimate";
    this.output = options.output ?? defaultOutput;
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.log("debug", message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.log("info", message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.log("warn", message, context);
  }

  error(message: string, error?: Error | unknown, context?: Record<string, unknown>): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: "error",
      message,
      context: { ...context, logger: this.name },
    };

    if (error instanceof Error) {
      entry.error = {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };
    } else if (error !== undefined) {
      entry.context = { ...entry.context, error };
    }

    this.output(entry);
  }

  child(name: string): Logger {
    return new Logger({
      level: this.level,
      name: `${this.name}:${name}`,
      output: this.output,
    });
  }

  setLevel(level: LogLevel): void {
    (this as { level: LogLevel }).level = level;
  }

  getLevel(): LogLevel {
    return this.level;
  }

  private log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    if (!shouldLog(this.level, level)) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context: { ...context, logger: this.name },
    };

    this.output(entry);
  }
}

function shouldLog(currentLevel: LogLevel, messageLevel: LogLevel): boolean {
  return LOG_LEVELS[messageLevel] >= LOG_LEVELS[currentLevel];
}

function defaultOutput(entry: LogEntry): void {
  const json = JSON.stringify(entry);
  if (entry.level === "error") {
    process.stderr.write(json + "\n");
  } else {
    process.stdout.write(json + "\n");
  }
}

let defaultLogger: Logger | null = null;

export function getLogger(options?: LoggerOptions): Logger {
  if (!defaultLogger) {
    defaultLogger = new Logger(options);
  }
  return defaultLogger;
}

export function resetLogger(): void {
  defaultLogger = null;
}
