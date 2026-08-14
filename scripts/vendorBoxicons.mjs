import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = path.join(root, 'node_modules', 'boxicons')

const version = JSON.parse(fs.readFileSync(path.join(pkg, 'package.json'), 'utf8')).version
const src = fs.readFileSync(path.join(pkg, 'css', 'boxicons.min.css'), 'utf8')

if (!src.startsWith('@font-face{')) {
  throw new Error('boxicons.min.css no longer starts with @font-face — check the upstream shape')
}

fs.copyFileSync(
  path.join(pkg, 'fonts', 'boxicons.woff2'),
  path.join(root, 'static', 'fonts', 'boxicons.woff2')
)

const head = `/* Vendored from boxicons@${version} so the studio never reaches unpkg.com.
   Only the woff2 is shipped; the package also carries eot/ttf/svg/woff (2.3 MB unused).
   Regenerate with: node scripts/vendorBoxicons.mjs */

@font-face{font-family:boxicons;font-weight:400;font-style:normal;font-display:swap;src:url("../../static/fonts/boxicons.woff2") format("woff2")}
`

const out = path.join(root, 'src', 'styles', 'boxicons.css')
fs.writeFileSync(out, head + src.slice(src.indexOf('}') + 1))
console.log(`vendored boxicons@${version} → ${path.relative(root, out)}`)
