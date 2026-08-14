// Emits a tile-grid-correct placeholder for an overlay slot, stamped with its zoom, tile
// range and corner coordinates. Geometrically identical to the real render, so the pyramid,
// the fades and the export can all be built before any CGI exists.
//
//   node scripts/makePlaceholderRenders.mjs --z 13 --center 55.1955,25.1253 --tiles 8x6
//
import { build } from 'esbuild'
import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : process.argv[i + 1]
}

const z = Number(arg('z', 13))
const [lon, lat] = String(arg('center', '55.1955,25.1253')).split(',').map(Number)
const [tilesX, tilesY] = String(arg('tiles', '8x6')).split('x').map(Number)
const outDir = path.resolve(root, arg('out', 'scratch'))
const label = arg('label', `z${z}-${tilesX}x${tilesY}`)

if (![z, lon, lat, tilesX, tilesY].every(Number.isFinite)) {
  console.error('usage: --z 13 --center 55.1955,25.1253 --tiles 8x6 [--out dir] [--label name]')
  process.exit(1)
}

// outside the project root: creating and deleting files Vite watches crashes its watcher
const bundled = path.join(os.tmpdir(), `geo.placeholder.${process.pid}.mjs`)
await build({
  entryPoints: [path.join(root, 'src', 'lib', 'geo.ts')],
  outfile: bundled,
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  logLevel: 'silent',
})
const geo = await import(pathToFileURL(bundled).href)
unlinkSync(bundled)

const grid = geo.gridForImage([lon, lat], z, tilesX * 256, tilesY * 256)
const quad = geo.gridToQuad(grid)
const [width, height] = geo.gridPixelSize(grid)
const mpp = geo.metersPerPixel(quad[0][1], grid.z)

const f = (n) => n.toFixed(7)
const cell = 256
const lines = []

for (let i = 0; i <= grid.w; i++) {
  const x = i * cell
  lines.push(`<line x1="${x}" y1="0" x2="${x}" y2="${height}" stroke="#2b3a55" stroke-width="2"/>`)
}
for (let j = 0; j <= grid.h; j++) {
  const y = j * cell
  lines.push(`<line x1="0" y1="${y}" x2="${width}" y2="${y}" stroke="#2b3a55" stroke-width="2"/>`)
}
for (let j = 0; j < grid.h; j++) {
  for (let i = 0; i < grid.w; i++) {
    lines.push(
      `<text x="${i * cell + 10}" y="${j * cell + 26}" font-family="monospace" font-size="16" fill="#5f6c84">` +
      `${grid.z}/${grid.x + i}/${grid.y + j}</text>`
    )
  }
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<rect width="${width}" height="${height}" fill="#111a2b"/>
${lines.join('\n')}
<rect x="0" y="0" width="${width}" height="${height}" fill="none" stroke="#29a8df" stroke-width="6"/>
<text x="${width / 2}" y="${height / 2 - 18}" text-anchor="middle" font-family="sans-serif" font-size="${Math.max(20, width / 26)}" fill="#e4e9f1">${label}</text>
<text x="${width / 2}" y="${height / 2 + 22}" text-anchor="middle" font-family="monospace" font-size="${Math.max(13, width / 52)}" fill="#9aa6bb">${grid.w}x${grid.h} tiles @ z${grid.z} · ${width}x${height}px · ${mpp.toFixed(2)} m/px</text>
<text x="12" y="${height - 14}" font-family="monospace" font-size="14" fill="#5f6c84">NW ${f(quad[0][0])}, ${f(quad[0][1])}</text>
<text x="${width - 12}" y="${height - 14}" text-anchor="end" font-family="monospace" font-size="14" fill="#5f6c84">SE ${f(quad[2][0])}, ${f(quad[2][1])}</text>
</svg>`

mkdirSync(outDir, { recursive: true })
const file = path.join(outDir, `${label}.svg`)
writeFileSync(file, svg)

console.log(`wrote ${path.relative(root, file)}`)
console.log(`  grid       ${grid.w}x${grid.h} tiles @ z${grid.z}  (x ${grid.x}, y ${grid.y})`)
console.log(`  pixels     ${width} x ${height}`)
console.log(`  resolution ${mpp.toFixed(3)} m/px`)
console.log('  corners    [')
for (const [cLon, cLat] of quad) console.log(`    [${f(cLon)}, ${f(cLat)}],`)
console.log('  ]')
