/* Runs the checks in this folder. `npm test` runs all of them.
   `npm run test:unit` skips the browser check. `npm run test:browser` runs only that one. */
import { spawn } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = path.dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const browserOnly = args.includes('--browser')
const unitOnly = args.includes('--unit')
const names = (await readdir(dir)).filter(f => f.endsWith('.mjs') && f !== 'run.mjs').sort()
const files = names.filter(f => {
  const browser = f.includes('tooltip')
  if (browserOnly) return browser
  if (unitOnly) return !browser
  return true
})

let failed = 0
for (const file of files) {
  const code = await new Promise(resolve => {
    const child = spawn(process.execPath, ['--experimental-strip-types', path.join(dir, file)], { stdio: 'inherit' })
    child.on('exit', resolve)
  })
  if (code !== 0) failed++
}
if (!files.length) {
  console.error('no tests found in tests/')
  process.exit(1)
}
process.exit(failed ? 1 : 0)
