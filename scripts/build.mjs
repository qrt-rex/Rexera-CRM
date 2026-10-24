// npm run build: type-check, then bundle. Render's free plan gives the build 512 MB, so there (RENDER=true):
//  * the type-check is skipped — it needs ~670 MB (run `npm run typecheck` before pushing instead);
//  * the bundler runs in this process with one worker thread (~440 MB instead of ~510 MB), and the peak is logged.
import { spawnSync } from 'node:child_process'

const onRender = !!process.env.RENDER
if (onRender) {
  console.log('[build] Render: skipping the type-check (run `npm run typecheck` locally before pushing)')
  // read by the bundler's native thread pool when it starts, so set before vite loads
  process.env.RAYON_NUM_THREADS ??= '1'
} else {
  const r = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '-b'], { stdio: 'inherit' })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

let peak = 0
const sample = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss) }, 50)
const { build } = await import('vite')
try {
  await build()
} catch (e) {
  console.error(e)
  process.exit(1)
} finally {
  clearInterval(sample)
}
if (onRender) console.log(`[build] peak memory ${Math.round(Math.max(peak, process.memoryUsage().rss) / 1048576)} MB`)
