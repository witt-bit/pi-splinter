import type { SplinterModule } from "../core/module.ts";
import { cards } from "./cards/index.ts";
import { selection } from "./selection/index.ts";

/**
 * Everything pi-splinter installs, in load order.
 *
 * A new annoyance gets one entry here plus its own directory and docs page. When
 * one module has to be reverted, delete its line: the rest keeps working.
 */
export const modules: readonly SplinterModule[] = [cards, selection];
