/**
 * Local development entrypoint for the vibe-pm server plugin.
 *
 * OpenCode V2 resolves a local plugin directory by looking for literal
 * `server` / `index` / `tui` files at its root — it does not fall back to the
 * package `main` / `exports` fields the way V1 did. This directory exists so the
 * working copy can be loaded without installing, and it simply re-exports the
 * built entrypoint.
 *
 * Run `bun run build` before expecting changes to take effect.
 */

export { default } from '../../../dist/index.js';