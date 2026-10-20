/**
 * Local development entrypoint for the vibe-pm TUI plugin.
 *
 * See ./index.ts for why this directory exists. The built TUI bundle is
 * re-exported unchanged so the sidebar renders identically to an installed build.
 */

export { default } from '../../../dist/tui/index.js';