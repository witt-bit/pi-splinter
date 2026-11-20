import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { modules } from "../src/modules/index.ts";

/**
 * Pi extension entry point.
 *
 * The entry stays thin on purpose: it only fans out to the modules in
 * `src/modules/index.ts`, so each patch can be read, tested, and removed on its
 * own. Nothing here knows what a patch does.
 */
export default function (pi: ExtensionAPI) {
  for (const splinterModule of modules) {
    splinterModule.install(pi);
  }
}
