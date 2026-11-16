// node scripts/select-text-qa.cjs (requires the frontend on :3000; no backend requests)
const { chromium, expect } = require('@playwright/test');
const fs = require('node:fs');
const html = `<!doctype html><html><head><meta charset="UTF-8"></head><body><div id="root"></div><script type="module">
import React from '/node_modules/.vite/deps/react.js';
import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
import RefreshRuntime from '/@react-refresh';
import '/src/styles/main.scss';
RefreshRuntime.injectIntoGlobalHook(window);
window.$RefreshReg$ = () => {};
window.$RefreshSig$ = () => type => type;
window.__vite_plugin_react_preamble_installed__ = true;
const {Select} = await import('/src/components/ui/Select/Select.tsx');
const {SearchSelect} = await import('/src/components/ui/SearchSelect/SearchSelect.tsx');
const options=[{value:'pending',label:'Pending'},{value:'long',label:'Photography equipment awaiting shipping and administrator approval'}];
const h=React.createElement;
ReactDOM.createRoot(document.getElementById('root')).render(h('main',{style:{padding:24,display:'grid',gap:24,maxWidth:360}},
...['small','medium','large'].map(selectSize=>h(Select,{key:selectSize,label:selectSize,selectSize,defaultValue:'pending',options,fullWidth:true})),
h('div',{style:{width:180}},h(Select,{label:'Long label',defaultValue:'long',options,fullWidth:true})),
h('div',{style:{width:180}},h(SearchSelect,{label:'Searchable long label',value:'long',options,onValueChange:()=>{},fullWidth:true})),
h(Select,{label:'Empty category',placeholder:'Select category…',options,fullWidth:true}),
h(SearchSelect,{label:'Empty brand',placeholder:'Select brand…',value:undefined,options,onValueChange:()=>{},fullWidth:true})));
</script></body></html>`;

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    fs.mkdirSync('.cache/select-text', { recursive: true });
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      page.on('pageerror', error => console.error(error.message));
      await page.route('http://localhost:3000/__select-qa', route => route.fulfill({ contentType: 'text/html', body: html }));
      await page.goto('http://localhost:3000/__select-qa');
      const controls = page.locator('button[role="combobox"], button[aria-haspopup="listbox"]');
      await expect(controls).toHaveCount(7, { timeout: 30000 });
      await page.evaluate(() => document.fonts.ready);
      for (const control of await controls.all()) {
        const metrics = await control.evaluate(button => {
          const value = button.querySelector('[class*="value"]');
          const style = getComputedStyle(value);
          return { fitsHeight: value.scrollHeight <= value.clientHeight + 1, fitsWidth: value.scrollWidth <= value.clientWidth + 1,
            lineHeight: parseFloat(style.lineHeight), fontSize: parseFloat(style.fontSize), overflow: style.overflow, textOverflow: style.textOverflow };
        });
        expect(metrics.fitsHeight).toBe(true);
        expect(metrics.fitsWidth).toBe(true);
        expect(metrics.lineHeight).toBeGreaterThanOrEqual(metrics.fontSize * 1.5);
        expect(metrics.overflow).not.toBe('hidden');
        expect(metrics.textOverflow).not.toBe('ellipsis');
      }
      await page.screenshot({ path: `.cache/select-text/closed-${width}.png`, fullPage: true });
      const placeholderColor = await page.getByRole('combobox', { name: 'Empty category' }).evaluate(el => getComputedStyle(el).color);
      const selectedColor = await page.getByRole('combobox', { name: 'small' }).evaluate(el => getComputedStyle(el).color);
      const searchablePlaceholderColor = await page.getByText('Select brand…', { exact: true }).evaluate(el => getComputedStyle(el).color);
      expect(placeholderColor).not.toBe(selectedColor);
      expect(searchablePlaceholderColor).toBe(placeholderColor);
      await page.getByRole('combobox', { name: 'Long label', exact: true }).click();
      await expect(page.getByRole('option', { name: /Photography/ })).toBeVisible();
      await page.screenshot({ path: `.cache/select-text/open-${width}.png`, fullPage: true });
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: /Searchable long label/ }).click();
      await expect(page.getByRole('option', { name: /Photography/ })).toBeVisible();
      await page.screenshot({ path: `.cache/select-text/searchable-${width}.png`, fullPage: true });
      console.log(`${width}px: all sizes and both shared selectors preserve full labels`);
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
