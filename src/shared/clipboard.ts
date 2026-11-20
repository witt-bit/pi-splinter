import { spawn } from "node:child_process";
import { getNativeClipboard } from "@earendil-works/pi-tui";

// ---------------------------------------------------------------------------
// Clipboard (native helper first, platform command as fallback)
// ---------------------------------------------------------------------------

function runCopyProgram(program: string, args: string[], source: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`${program} timed out`));
    }, 3000);

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `${program} exited with code ${code ?? "unknown"}`));
    });
    child.stdin.end(source, "utf8");
  });
}

function platformCopyCommands(): Array<[string, string[]]> {
  switch (process.platform) {
    case "darwin":
      return [["pbcopy", []]];
    case "win32":
      return [["clip", []]];
    default: {
      const commands: Array<[string, string[]]> = [];
      if (process.env.WAYLAND_DISPLAY) commands.push(["wl-copy", []]);
      if (process.env.DISPLAY) {
        commands.push(["xclip", ["-selection", "clipboard"]], ["xsel", ["--clipboard", "--input"]]);
      }
      return commands;
    }
  }
}

export async function writeClipboard(source: string): Promise<void> {
  const clipboard = getNativeClipboard();
  if (clipboard?.setText) {
    try {
      await clipboard.setText(source);
      return;
    } catch {
      // Fall back to the platform clipboard command when the native helper fails.
    }
  }
  let lastError: Error | undefined;
  for (const [program, args] of platformCopyCommands()) {
    try {
      await runCopyProgram(program, args, source);
      return;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }
  throw lastError ?? new Error("Clipboard access is unavailable in this terminal");
}
