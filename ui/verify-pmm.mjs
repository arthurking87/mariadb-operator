import puppeteer from 'puppeteer-core'

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--user-data-dir=/tmp/claude-1000/-home-kasm-user-Downloads-mariadb-operator/771b901a-635a-4cd1-b3f8-f9a826328990/scratchpad/chrome-profile-pmm'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1400, height: 1400 })
page.on('console', msg => { if (msg.type() === 'error') console.log('CONSOLE ERROR:', msg.text()) })
page.on('pageerror', err => console.log('PAGE ERROR:', err.message))

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0' })
await new Promise(r => setTimeout(r, 500))

const clickButtonByText = async (text) => {
  const btns = await page.$$('button')
  for (const b of btns) {
    const t = await page.evaluate(el => el.textContent, b)
    if (t.includes(text)) { await b.click(); return true }
  }
  return false
}

await clickButtonByText('New Instance')
await new Promise(r => setTimeout(r, 500))

const firstInput = await page.$('input')
await firstInput.type('pmm-test-instance')
await clickButtonByText('Continue')
await new Promise(r => setTimeout(r, 400))
await clickButtonByText('Continue') // Topology defaults fine
await new Promise(r => setTimeout(r, 400))
await clickButtonByText('Continue') // Storage defaults fine
await new Promise(r => setTimeout(r, 400))

// Now on Security step. Fill root password + confirm, repl password + confirm.
const fillByLabel = async (labelText, value) => {
  const labels = await page.$$('label')
  for (const l of labels) {
    const t = await page.evaluate(e => e.textContent, l)
    if (t.trim() === labelText) {
      const input = await page.evaluateHandle(el => el.parentElement.parentElement.querySelector('input'), l)
      const el = input.asElement()
      if (el) { await el.click({ clickCount: 3 }); await el.type(value); return true }
    }
  }
  console.log('NOT FOUND label:', labelText)
  return false
}

await fillByLabel('Root Password', 'RootPass123!')
await fillByLabel('Confirm Root Password', 'RootPass123!')
await fillByLabel('Replication Password', 'ReplPass123!')
await fillByLabel('Confirm Replication Password', 'ReplPass123!')

// Enable PMM toggle - find the toggle in the PMM card by locating text then its sibling toggle button
const bodyTextBefore = await page.evaluate(() => document.body.innerText)
console.log('Has PMM section:', bodyTextBefore.includes('Percona PMM Monitoring'))

const clickToggleNear = async (text) => {
  const divs = await page.$$('div')
  for (const d of divs) {
    const t = await page.evaluate(e => e.textContent, d)
    if (t && t.trim() === text) {
      const toggleBtn = await page.evaluateHandle(el => {
        let p = el.closest('.flex.items-center.justify-between')
        return p ? p.querySelector('button') : null
      }, d)
      const el = toggleBtn.asElement()
      if (el) { await el.click(); return true }
    }
  }
  return false
}
await clickToggleNear('Percona PMM Monitoring')
await new Promise(r => setTimeout(r, 300))

await fillByLabel('PMM Server address', 'pmm-server.monitoring.svc.cluster.local:443')
await fillByLabel('PMM Server username', 'admin')
await fillByLabel('PMM Server password', 'PmmServerPass123!')
await fillByLabel('Confirm PMM Server password', 'PmmServerPass123!')
await fillByLabel('Database username', 'pmm')
await fillByLabel('Database password', 'PmmDbPass123!')
await fillByLabel('Confirm database password', 'PmmDbPass123!')

await page.screenshot({ path: '/tmp/claude-1000/-home-kasm-user-Downloads-mariadb-operator/771b901a-635a-4cd1-b3f8-f9a826328990/scratchpad/pmm-security-step.png', fullPage: true })

await clickButtonByText('Continue') // to Backup
await new Promise(r => setTimeout(r, 400))
await clickButtonByText('Continue') // to Review
await new Promise(r => setTimeout(r, 400))

const yamlText = await page.evaluate(() => document.querySelector('pre')?.innerText || 'NOT FOUND')
console.log('--- YAML PREVIEW ---')
console.log(yamlText)
console.log('--- END YAML ---')

await page.screenshot({ path: '/tmp/claude-1000/-home-kasm-user-Downloads-mariadb-operator/771b901a-635a-4cd1-b3f8-f9a826328990/scratchpad/pmm-review-step.png', fullPage: true })

await browser.close()
console.log('DONE')
