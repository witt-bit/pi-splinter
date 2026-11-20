import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";
import type { SplinterModule } from "../../core/module.ts";
import { writeClipboard } from "../../shared/clipboard.ts";
import { installPatch } from "./patch.ts";

const STATUS_KEY = "pi-splinter";
const STATUS_CLEAR_MS = 2000;

/**
 * Code cards: fenced code blocks in assistant messages render as flush-edge
 * panels with a `[COPY]` button and a click-to-toggle raw-text view.
 *
 * Rendered rows live in a layout cache keyed by width and source text, so this
 * module also owns the session-scoped teardown: the patch and that cache are
 * per-session state, and nothing may leak into the next session.
 */
export const cards: SplinterModule = {
  id: "cards",
  summary: "Flush-edge code cards with a copy button and a raw-text toggle",

  install(pi: ExtensionAPI) {
    let restore: (() => void) | undefined;
    let themeContext: ExtensionContext | undefined;
    let latestCode = "";
    let statusTimer: ReturnType<typeof setTimeout> | undefined;

    /** Transient footer feedback; ui.notify("info") would persist in the transcript. */
    const showCopiedStatus = (message: string) => {
      const ctx = themeContext;
      if (!ctx) return;
      try {
        if (statusTimer) clearTimeout(statusTimer);
        ctx.ui.setStatus(STATUS_KEY, message);
        statusTimer = setTimeout(() => {
          statusTimer = undefined;
          try {
            ctx.ui.setStatus(STATUS_KEY, undefined);
          } catch {
            // Stale ctx after reload or session replacement; nothing to clear.
          }
        }, STATUS_CLEAR_MS);
      } catch {
        // Stale ctx; fall back silently.
      }
    };

    const copyCode = async (source: string, ctx: ExtensionContext) => {
      try {
        await writeClipboard(source);
        showCopiedStatus("Code copied");
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "warning");
      }
    };

    pi.registerShortcut(Key.ctrlAlt("c"), {
      description: "Copy the most recently rendered code block",
      handler: async (ctx) => {
        if (!latestCode) {
          ctx.ui.notify("No code block to copy", "warning");
          return;
        }
        await copyCode(latestCode, ctx);
      },
    });

    /** Reset session-scoped state; safe to run when no session is active. */
    const resetSessionState = () => {
      restore?.();
      restore = undefined;
      themeContext = undefined;
      latestCode = "";
      if (statusTimer) {
        clearTimeout(statusTimer);
        statusTimer = undefined;
      }
    };

    pi.on("session_start", (_event, ctx) => {
      resetSessionState();
      if (ctx.mode !== "tui") return;

      themeContext = ctx;
      const record = installPatch(
        () => {
          if (!themeContext) throw new Error("pi-splinter cards has no active TUI theme");
          return themeContext.ui.theme;
        },
        (source) => {
          if (themeContext) void copyCode(source, themeContext);
        },
        (source) => {
          latestCode = source;
        },
      );
      restore = record.restore;

      // Probe the patched renderer with a fixed sample before any real message
      // depends on it. If Pi's internal renderer no longer matches the shape the
      // patch assumes, revert to native rendering and say so instead of failing
      // silently with every code block still looking unstyled.
      const check = record.verify();
      if (!check.ok) {
        resetSessionState();
        try {
          ctx.ui.notify(
            `pi-splinter cards disabled for this session: ${check.reason ?? "unknown reason"}. Native rendering is active.`,
            "warning",
          );
        } catch {
          // Stale ctx; the restore above already took effect.
        }
        return;
      }
      // The self-check routes its sample through the same capture path as real
      // messages and would otherwise leave the sample as the "latest" block.
      latestCode = "";
    });

    pi.on("session_shutdown", () => {
      resetSessionState();
    });
  },
};
