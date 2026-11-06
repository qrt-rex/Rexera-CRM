/**
 * The old-CRM import, bundled for the live server (scripts/build.mjs → server/dist/legacy-import.mjs) so the Old CRM
 * sync (server/legacySync.mjs) maps the old data exactly as IT → Import from old CRM does in the browser.
 */
export { buildImport } from './legacyImport'
export type { DumpTables, ImportOptions, ImportReport } from './legacyImport'
