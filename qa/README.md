# Website checks (from the Nov 3 audit)

Run from the repo root with the site served locally:

```
npx wrangler pages dev . --port 8098 &
find . -name "*.html" -not -path "./scripts/*" -not -path "./.git/*" | sort > qa/pages.txt
NODE_PATH=$(npm root -g) node qa/crawl.js      # every page × 5 screen sizes: errors, overflow, images, disclaimer, links → qa/crawl.json
NODE_PATH=$(npm root -g) node qa/ui.js         # buttons, forms, tabs, currency, presets, portfolio, redirects
python3 qa/run_calc.py && python3 qa/validate.py   # 21 calculator scenarios, checked against an independent model (expect 0 fails)
```

Re-run after any change to the calculator maths. `qa/*.json` and `qa/pages.txt` are outputs; don't commit them.
