import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { SplinterModule } from "../../core/module.ts";
import { installPatch } from "./patch.ts";

/**
 * Selection release: drop the mouse selection once its copy has landed.
 *
 * Applies to the whole fullscreen TUI, not only to code cards, because the
 * lingering highlight is Pi's behaviour and not something a single component can
 * fix. Patching the renderer prototype keeps it independent of the transcript, so
 * it needs no theme and no session state of its own.
 */
export const selection: SplinterModule = {
  id: "selection",
  summary: "Release the mouse selection once its copy has landed",

  install(pi: ExtensionAPI) {
    let restore: (() => void) | undefined;

    const resetSessionState = () => {
      restore?.();
      restore = undefined;
    };

    pi.on("session_start", (_event, ctx) => {
      resetSessionState();
      if (ctx.mode !== "tui") return;

      const record = installPatch();
      restore = record.restore;

      // If Pi renamed or dropped the methods this patch drives, undo it and say
      // so instead of pretending the behaviour is active.
      const check = record.verify();
      if (!check.ok) {
        resetSessionState();
        try {
          ctx.ui.notify(
            `pi-splinter selection disabled for this session: ${check.reason ?? "unknown reason"}. Pi keeps its own selection handling.`,
            "warning",
          );
        } catch {
          // Stale ctx; the restore above already took effect.
        }
      }
    });

    pi.on("session_shutdown", () => {
      resetSessionState();
    });
  },
};
