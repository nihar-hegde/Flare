import type { StackFrame } from "./types.js";

const STACK_FRAME_RE =
  /^\s*at\s+(?:(?<fn>.*?)\s+\()?((?<file>(?:file:\/\/)?[^():]+):(?<line>\d+):(?<col>\d+))\)?$/;

export function errorToException(error: unknown, handled: boolean, mechanism: string) {
  const normalized = normalizeError(error);
  return {
    type: normalized.name,
    message: normalized.message,
    stack: normalized.stack,
    handled,
    mechanism,
  };
}

export function parseStackTrace(error: unknown): StackFrame[] {
  const stack = normalizeError(error).stack;
  if (!stack) return [];

  return stack
    .split("\n")
    .slice(1)
    .map(parseStackLine)
    .filter((frame): frame is StackFrame => frame !== null);
}

export function normalizeError(error: unknown): {
  name: string;
  message: string;
  stack?: string;
} {
  if (error instanceof Error) {
    return {
      name: error.name || "Error",
      message: error.message || String(error),
      stack: error.stack,
    };
  }

  if (typeof error === "string") {
    return { name: "Error", message: error };
  }

  return {
    name: "Error",
    message: safeStringify(error),
  };
}

function parseStackLine(line: string): StackFrame | null {
  const match = STACK_FRAME_RE.exec(line);
  if (!match?.groups) return null;

  const filename = stripFileProtocol(match.groups.file ?? "");
  const frame: StackFrame = {
    filename,
    function: cleanFunctionName(match.groups.fn),
    lineno: Number(match.groups.line),
    colno: Number(match.groups.col),
    inApp: isInApp(filename),
  };

  return frame;
}

function stripFileProtocol(filename: string): string {
  return filename.startsWith("file://") ? filename.slice("file://".length) : filename;
}

function cleanFunctionName(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed !== "async" ? trimmed : undefined;
}

function isInApp(filename: string): boolean {
  return (
    !filename.startsWith("node:") &&
    !filename.includes("/node_modules/") &&
    !filename.includes("(internal/") &&
    !filename.includes("node:internal")
  );
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
