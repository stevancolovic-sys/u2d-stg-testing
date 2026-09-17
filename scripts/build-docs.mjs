// Builds a standalone reference page from the same registry the console uses.
// Output is one self-contained file: no modules, no server, double-clickable.

import { writeFileSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { ENDPOINTS } from '../public/js/endpoints.js'
import { SCHEMAS } from '../docs-src/schemas.js'
import { GUIDES, NOTES } from '../docs-src/prose.js'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

import { costLabel } from '../docs-src/cost-label.js'

const data = {
  guides: GUIDES,
  endpoints: ENDPOINTS.map((e) => ({
    id: e.id,
    label: e.label,
    group: e.group,
    method: e.method,
    path: e.path,
    auth: e.auth,
    summary: e.summary,
    cost: costLabel(e),
    notes: NOTES[e.id] || [],
    fields: e.fields
      .filter((f) => !f.uiOnly)
      .map((f) => ({
        name: f.name,
        type: f.type,
        required: f.required,
        hint: f.hint || '',
        choices: f.choices ? f.choices.map((c) => c.label) : null,
      })),
  })),
  schemas: SCHEMAS,
}

const css = readFileSync(join(here, 'docs.css'), 'utf8')
const js = readFileSync(join(here, 'docs.js'), 'utf8')

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Up2Data API reference</title>
<style>
${css}
</style>
</head>
<body>
<div class="shell">
  <nav class="rail">
    <div class="rail-top">
      <div class="brand">Up2Data <span>reference</span></div>
      <input id="q" class="search" type="search" placeholder="Search  /" autocomplete="off" spellcheck="false">
    </div>
    <div id="nav" class="nav"></div>
  </nav>
  <main id="main" class="main" tabindex="-1"></main>
</div>
<script>
window.DOCS = ${JSON.stringify(data)};
${js}
</script>
</body>
</html>
`

const out = join(root, 'up2data-docs.html')
writeFileSync(out, html)
console.log(`built ${out} — ${(html.length / 1024).toFixed(0)} KB, ${data.endpoints.length} endpoints, ${data.schemas.length} schemas, ${data.guides.length} guides`)
