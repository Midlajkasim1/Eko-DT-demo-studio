/* Outside focus mode the dashboard pane is not the browser window. The toolbar
   tooltip must still sit on its button, and the floor list must not scroll sideways. */
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const css = [
  readFileSync(path.join(root, 'static/dashboard/css/components.css'), 'utf8'),
  readFileSync(path.join(root, 'static/css/overlay.css'), 'utf8'),
].join('\n')
const tipJs = readFileSync(path.join(root, 'static/dashboard/js/shell/tooltip.js'), 'utf8')

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html,body{margin:0;height:100%}
  ${css}
  .studio{display:flex;height:100vh}
  .side{width:280px;flex:none;background:#f4f4f5}
  .viewer{position:relative;flex:1;min-width:0}
</style></head>
<body>
<div class="studio"><div class="side"></div>
<div class="viewer">
  <div class="dashboard-native-container" style="position:absolute;inset:0">
    <div id="vbottom" style="position:absolute;left:50%;bottom:80px;transform:translateX(-50%)">
      <button id="levels" data-tip="Levels (L)" data-tipat="above" style="width:72px;height:44px">Levels</button>
    </div>
    <div class="mzfly mzglass flyLevels" id="fly" style="position:absolute;left:40%;bottom:140px">
      <div class="vpick"><div class="vplist" id="list">
        <button class="mzopt vprow">All</button>
        <button class="mzopt vprow">Roof</button>
        <button class="mzopt vprow">First floor</button>
        <button class="mzopt vprow">Ground floor</button>
        <button class="mzopt vprow">Basement</button>
      </div></div>
    </div>
  </div>
</div></div>
<script>${tipJs}</script>
<script>
  window.DASHBOARD_ROOT = document.querySelector('.dashboard-native-container');
  window.EKO_TIP.init({});
</script>
</body></html>`

const server = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  res.end(html)
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port

const launch = async () => {
  try {
    return await chromium.launch({ args: ['--no-sandbox'] })
  } catch {
    const executablePath = process.env.CHROME_PATH
    if (!executablePath) throw new Error('playwright chromium is not installed')
    return chromium.launch({ executablePath, args: ['--no-sandbox'] })
  }
}

const fails = []
const browser = await launch()
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  await page.goto('http://127.0.0.1:' + port)
  await page.locator('#levels').hover()
  await page.waitForTimeout(250)
  const geom = await page.evaluate(() => {
    const b = document.getElementById('levels').getBoundingClientRect()
    const t = document.getElementById('ekotip').getBoundingClientRect()
    const list = document.getElementById('list')
    const fly = document.getElementById('fly')
    return {
      hidden: document.getElementById('ekotip').hidden,
      text: document.getElementById('ekotip').textContent,
      btn: { x: b.x, y: b.y, w: b.width, h: b.height },
      tip: { x: t.x, y: t.y, w: t.width, h: t.height, bottom: t.bottom },
      listScrollX: list.scrollWidth - list.clientWidth,
      flyW: fly.getBoundingClientRect().width,
    }
  })
  const tipCx = geom.tip.x + geom.tip.w / 2
  const btnCx = geom.btn.x + geom.btn.w / 2
  if (geom.hidden) fails.push('tooltip stayed hidden')
  if (geom.text !== 'Levels (L)') fails.push('tooltip text ' + JSON.stringify(geom.text))
  if (geom.tip.bottom > geom.btn.y + 2) fails.push('tooltip is not above the button')
  if (Math.abs(tipCx - btnCx) > 24) fails.push('tooltip is not on the button')
  if (geom.listScrollX > 1) fails.push('floor list scrolls horizontally')
  if (geom.flyW < 160) fails.push('floor panel is too narrow')
  if (fails.length) {
    console.error('tooltip-place failed', geom)
    for (const line of fails) console.error('  ' + line)
  } else {
    console.log('tooltip-place: tip sits on the button, floor list does not scroll sideways')
  }
} finally {
  await browser.close()
  server.close()
}
process.exit(fails.length ? 1 : 0)
