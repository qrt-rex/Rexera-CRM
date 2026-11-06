// The old-CRM import bundled for the live server (server/dist/legacy-import.mjs), used by the Old CRM sync
// (server/legacySync.mjs). Run by scripts/build.mjs after the app is built; packages stay as imports.
const { build } = await import('vite')
try {
  await build({
    configFile: false, logLevel: 'warn',
    define: { 'import.meta.env.VITE_DATA_BACKEND': JSON.stringify('server'), 'import.meta.env.DEV': 'false', 'import.meta.env.PROD': 'true' },
    build: {
      ssr: 'src/lib/legacySyncEntry.ts', outDir: 'server/dist', emptyOutDir: false, minify: false, sourcemap: false,
      rollupOptions: { output: { entryFileNames: 'legacy-import.mjs', format: 'es' } },
    },
  })
  console.log('[build] server/dist/legacy-import.mjs ready')
} catch (e) {
  console.error(e)
  process.exit(1)
}
