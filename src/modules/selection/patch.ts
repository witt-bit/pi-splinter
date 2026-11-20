import { TuiAltScreen } from "@earendil-works/pi-tui";

// ---------------------------------------------------------------------------
// Constants and types
// ---------------------------------------------------------------------------

const PATCH = Symbol.for("pi-splinter.selection.tui-patch");

/**
 * Pi copies the active selection from two places: the copy-on-select release
 * path, and the explicit copy keybinding that only falls back to the selection
 * when copy-on-select is off. Both are patched, so "copied" always means the
 * selection has been consumed.
 */
const COPY_METHODS = ["copySelectionToClipboard", "copyActiveSelectionToClipboard"] as const;

type CopyMethodName = (typeof COPY_METHODS)[number];

type VerifyResult = { ok: boolean; reason?: string };

type PatchRecord = {
  restore: () => void;
  verify: () => VerifyResult;
};

/**
 * The slice of Pi's fullscreen renderer this patch drives. All three methods are
 * public in `tui-alt-screen.d.ts` and are re-checked at startup because a Pi
 * upgrade may rename or drop them.
 */
type SelectionRenderer = {
  clearTextSelection(): void;
  requestRender(force?: boolean): void;
};

type CopyMethod = (this: SelectionRenderer) => Promise<boolean>;

type PatchedPrototype = Record<PropertyKey, unknown>;

/**
 * `PATCH` comes from `Symbol.for`, so it is not a unique symbol and cannot be a
 * computed key in a type literal. Read and write it through one narrow view
 * instead of scattering casts.
 */
const patchSlot = (prototype: PatchedPrototype): Record<symbol, PatchRecord | undefined> =>
  prototype as unknown as Record<symbol, PatchRecord | undefined>;

// ---------------------------------------------------------------------------
// Patch
// ---------------------------------------------------------------------------

/**
 * Release the selection once its copy has landed.
 *
 * Pi keeps `selectionAnchor`/`selectionFocus` after a copy-on-select release, so
 * the highlight stays on screen until the next click. Visually that reads as a
 * stuck cursor: the highlight covers the rows the caret used to sit in, and the
 * user has to click somewhere to get rid of it. Dropping the selection right
 * after a *successful* copy leaves the transcript as it looked before the drag;
 * a failed copy keeps it, so the text is still there to retry.
 *
 * The extra render is deliberate: the clear happens in a microtask after the
 * clipboard write resolves, which is *after* Pi queued the frame for the release,
 * so without it the old highlight would stay painted until something else
 * repainted the screen.
 */
export function installPatch(): PatchRecord {
  // A Pi release that drops the renderer class must degrade, not throw inside the
  // session_start fan-out, where it would take the other modules down with it.
  if (typeof TuiAltScreen !== "function") {
    return {
      restore() {},
      verify: () => ({ ok: false, reason: "TuiAltScreen is missing from @earendil-works/pi-tui" }),
    };
  }

  const prototype = TuiAltScreen.prototype as unknown as PatchedPrototype;
  patchSlot(prototype)[PATCH]?.restore();

  const originals = new Map<CopyMethodName, CopyMethod | undefined>();
  const patched = new Map<CopyMethodName, CopyMethod>();
  for (const name of COPY_METHODS) {
    const original = prototype[name] as CopyMethod | undefined;
    originals.set(name, original);
    if (typeof original !== "function") continue;
    const wrapped: CopyMethod = async function (this: SelectionRenderer) {
      const copied = await original.call(this);
      if (copied) {
        this.clearTextSelection();
        this.requestRender();
      }
      return copied;
    };
    patched.set(name, wrapped);
    prototype[name] = wrapped;
  }

  /**
   * Confirm Pi's renderer still has the shape the patch assumes. Returns a
   * failure instead of throwing so the module can back out and say why, rather
   * than leaving a half-installed patch that silently does nothing.
   */
  const verify = (): VerifyResult => {
    if (patched.size === 0) return { ok: false, reason: "no selection copy method on Pi's renderer" };
    for (const name of ["clearTextSelection", "requestRender"] as const) {
      if (typeof prototype[name] !== "function") return { ok: false, reason: `${name} is missing from Pi's renderer` };
    }
    for (const [name, wrapped] of patched) {
      if (prototype[name] !== wrapped) return { ok: false, reason: `${name} did not keep the patch` };
    }
    return { ok: true };
  };

  const record: PatchRecord = {
    verify,
    restore() {
      for (const [name, wrapped] of patched) {
        if (prototype[name] !== wrapped) continue;
        const original = originals.get(name);
        if (original) prototype[name] = original;
        else delete prototype[name];
      }
      if (patchSlot(prototype)[PATCH] === record) delete patchSlot(prototype)[PATCH];
    },
  };
  patchSlot(prototype)[PATCH] = record;
  return record;
}
