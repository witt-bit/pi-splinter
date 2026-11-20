import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * One quality-of-life patch.
 *
 * Every module owns exactly one annoyance: its own directory under
 * `src/modules/<id>/`, its own docs page under `docs/modules/<id>.md`, and its
 * own wiring below `install`. Modules never import each other, so a patch can be
 * added, reverted, or dropped without touching the rest of the package.
 */
export interface SplinterModule {
  /** Stable id; matches the directory name and the docs page. */
  id: string;
  /** One-line summary, used by the docs table and startup diagnostics. */
  summary: string;
  /** Register listeners, shortcuts, and patches with the Pi extension API. */
  install(pi: ExtensionAPI): void;
}
