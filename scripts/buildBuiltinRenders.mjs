// Re-encodes the bundled render pyramid to WebP, through the same canvas encoder the studio
// importer uses, so built-in and imported imagery cannot drift in quality.
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const OUT_DIR = path.join(ROOT, 'public', 'map', 'regions')
const QUALITY = 0.9

// <region>/<name> -> source image. Add a city by adding a block here and its data file
// under src/data/regions/. Output lands at public/map/regions/<region>/<name>.webp.
const EKO = path.join(ROOT, 'EKO-Modon', 'public', 'renders')
const REGIONS = {
  dubai: {
    'overview': path.join(EKO, 'dubai-overview.png'),
    'palm-jumeirah/l1': path.join(EKO, 'palm-jumeirah.png'),
    'palm-jumeirah/l2': path.join(EKO, 'palm-l2.png'),
    'palm-jumeirah/l3': path.join(EKO, 'palm-l3.png'),
    'marsa-al-arab/l1': path.join(EKO, 'marsa-l1.png'),
    'marsa-al-arab/l2': path.join(EKO, 'marsa-l2.png'),
    'marsa-al-arab/l3': path.join(EKO, 'marsa-l3.png'),
  },
}

const RENDERS = Object.entries(REGIONS).flatMap(([region, entries]) =>
  Object.entries(entries).map(([name, source]) => ({ region, name, source }))
)

fs.mkdirSync(OUT_DIR, { recursive: true })

let browser
for (const channel of [undefined, 'chromium', 'chrome', 'msedge']) {
  try {
    browser = await chromium.launch(channel ? { channel } : {})
    break
  } catch { /* try the next runtime */ }
}
if (!browser) throw new Error('no chromium runtime available')

const page = await browser.newPage()
await page.goto('about:blank')

let totalIn = 0
let totalOut = 0

for (const { region, name, source } of RENDERS) {
  if (!fs.existsSync(source)) throw new Error(`missing source render: ${source}`)

  const png = fs.readFileSync(source)
  const dataUrl = `data:image/png;base64,${png.toString('base64')}`

  const encoded = await page.evaluate(
    async ({ url, quality }) => {
      const bitmap = await createImageBitmap(
        await (await fetch(url)).blob()
      )
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      canvas.getContext('2d').drawImage(bitmap, 0, 0)
      const blob = await new Promise(resolve =>
        canvas.toBlob(resolve, 'image/webp', quality)
      )
      bitmap.close()
      const buffer = new Uint8Array(await blob.arrayBuffer())
      let binary = ''
      for (const byte of buffer) binary += String.fromCharCode(byte)
      return { base64: btoa(binary), width: canvas.width, height: canvas.height }
    },
    { url: dataUrl, quality: QUALITY }
  )

  const webp = Buffer.from(encoded.base64, 'base64')
  const target = path.join(OUT_DIR, region, `${name}.webp`)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, webp)

  totalIn += png.length
  totalOut += webp.length
  const mb = n => (n / 1048576).toFixed(2)
  console.log(
    `${`${region}/${name}`.padEnd(28)} ${encoded.width}x${encoded.height}  ${mb(png.length)}MB -> ${mb(webp.length)}MB`
  )
}

await browser.close()

const mb = n => (n / 1048576).toFixed(2)
console.log(`\ntotal ${mb(totalIn)}MB -> ${mb(totalOut)}MB (${(totalOut / totalIn * 100).toFixed(1)}%)`)
console.log(`written to ${path.relative(ROOT, OUT_DIR)}`)
