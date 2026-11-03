// Renders the newsletter PDF (EN + AR) into /assets/. Run: NODE_PATH=$(npm root -g) node scripts/money-check/render.js
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const b = await chromium.launch();
  for (const [src, out] of [['en.html', 'the-5-minute-money-check.pdf'], ['ar.html', 'the-5-minute-money-check-ar.pdf']]) {
    const p = await b.newPage();
    await p.goto('file://' + path.join(__dirname, src));
    await p.evaluate(() => document.fonts.ready);
    await p.pdf({ path: path.join(__dirname, '..', '..', 'assets', out), format: 'A4', printBackground: true, preferCSSPageSize: true });
    console.log('wrote assets/' + out);
  }
  await b.close();
})();
