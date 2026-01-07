/**
 * Cross-platform clipboard utilities.
 *
 * Uses native commands for reliability with clipboardy as fallback.
 * Following OpenCode's proven pattern for clipboard operations.
 */

import { $ } from "bun";
import { platform } from "os";
import clipboard from "clipboardy";

/**
 * Simple lazy initialization helper.
 * Evaluates the factory function once on first access.
 */
function lazy<T>(factory: () => T): () => T {
  let value: T | undefined;
  let initialized = false;
  return () => {
    if (!initialized) {
      value = factory();
      initialized = true;
    }
    return value as T;
  };
}

/**
 * Detect and return the best available copy method for the current platform.
 * Uses native commands where available, with clipboardy as fallback.
 */
const getCopyMethod = lazy(() => {
  const os = platform();

  // macOS: Use osascript (AppleScript)
  if (os === "darwin" && Bun.which("osascript")) {
    return async (text: string) => {
      // Escape backslashes and quotes for AppleScript string
      const escaped = text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      await $`osascript -e 'set the clipboard to "${escaped}"'`
        .nothrow()
        .quiet();
    };
  }

  // Linux: Try Wayland first, then X11 tools
  if (os === "linux") {
    // Wayland: wl-copy
    if (process.env["WAYLAND_DISPLAY"] && Bun.which("wl-copy")) {
      return async (text: string) => {
        const proc = Bun.spawn(["wl-copy"], {
          stdin: "pipe",
          stdout: "ignore",
          stderr: "ignore",
        });
        proc.stdin.write(text);
        proc.stdin.end();
        await proc.exited.catch(() => {});
      };
    }

    // X11: xclip
    if (Bun.which("xclip")) {
      return async (text: string) => {
        const proc = Bun.spawn(["xclip", "-selection", "clipboard"], {
          stdin: "pipe",
          stdout: "ignore",
          stderr: "ignore",
        });
        proc.stdin.write(text);
        proc.stdin.end();
        await proc.exited.catch(() => {});
      };
    }

    // X11: xsel (fallback)
    if (Bun.which("xsel")) {
      return async (text: string) => {
        const proc = Bun.spawn(["xsel", "--clipboard", "--input"], {
          stdin: "pipe",
          stdout: "ignore",
          stderr: "ignore",
        });
        proc.stdin.write(text);
        proc.stdin.end();
        await proc.exited.catch(() => {});
      };
    }
  }

  // Windows: PowerShell Set-Clipboard
  if (os === "win32") {
    return async (text: string) => {
      // Escape double quotes for PowerShell
      const escaped = text.replace(/"/g, '""');
      await $`powershell -command "Set-Clipboard -Value \"${escaped}\""`
        .nothrow()
        .quiet();
    };
  }

  // Fallback: Use clipboardy library
  return async (text: string) => {
    await clipboard.write(text).catch(() => {});
  };
});

/**
 * Clipboard namespace for copy/read operations.
 */
export namespace Clipboard {
  /**
   * Copy text to the system clipboard.
   *
   * @param text - The text to copy
   */
  export async function copy(text: string): Promise<void> {
    await getCopyMethod()(text);
  }

  /**
   * Read text from the system clipboard.
   *
   * @returns The clipboard text, or undefined if read fails
   */
  export async function read(): Promise<string | undefined> {
    return clipboard.read().catch(() => undefined);
  }
}
