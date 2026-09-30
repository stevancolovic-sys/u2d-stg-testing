// A collapsible view of a response body.
//
// Everything here comes off the network, so keys and values go in through
// textContent and never through innerHTML.
//
// Children are built the first time a node is opened rather than up front: a
// search or a batch can come back with thousands of nodes, and rendering all
// of them to show the first screen made a large response feel like a hang.

const el = (tag, className, text) => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

const isBranch = (v) => v !== null && typeof v === 'object'

const entriesOf = (value) =>
  Array.isArray(value) ? value.map((v, i) => [String(i), v]) : Object.entries(value)

// What a closed node says about itself, so collapsing does not hide the shape.
function summarise(value) {
  if (Array.isArray(value)) {
    return value.length === 1 ? '1 item' : `${value.length} items`
  }
  const n = Object.keys(value).length
  return n === 1 ? '1 key' : `${n} keys`
}

function renderLeaf(value) {
  if (typeof value === 'string') return el('span', 'jv-val jv-str', `"${value}"`)
  if (value === null) return el('span', 'jv-val jv-null', 'null')
  if (typeof value === 'number') return el('span', 'jv-val jv-num', String(value))
  if (typeof value === 'boolean') return el('span', 'jv-val jv-bool', String(value))
  return el('span', 'jv-val', String(value))
}

function renderNode(key, value, depth, openTo) {
  const row = el('div', 'jv-node')

  if (!isBranch(value)) {
    const line = el('div', 'jv-line')
    line.append(el('span', 'jv-spacer'))
    if (key !== null) {
      line.append(el('span', 'jv-key', key))
      line.append(el('span', 'jv-punc', ':'))
    }
    line.append(renderLeaf(value))
    row.append(line)
    return row
  }

  const open = Array.isArray(value) ? '[' : '{'
  const close = Array.isArray(value) ? ']' : '}'
  const empty = entriesOf(value).length === 0

  const line = el('div', 'jv-line')
  const toggle = el('button', 'jv-toggle')
  toggle.type = 'button'
  line.append(toggle)
  if (key !== null) {
    line.append(el('span', 'jv-key', key))
    line.append(el('span', 'jv-punc', ':'))
  }
  line.append(el('span', 'jv-punc', open))
  const summary = el('span', 'jv-summary', empty ? '' : summarise(value))
  line.append(summary)
  const tail = el('span', 'jv-punc', close)
  line.append(tail)
  row.append(line)

  if (empty) {
    toggle.disabled = true
    toggle.textContent = ''
    return row
  }

  const children = el('div', 'jv-children')
  const closing = el('div', 'jv-closing')
  closing.append(el('span', 'jv-spacer'))
  closing.append(el('span', 'jv-punc', close))
  row.append(children, closing)

  let built = false
  const build = () => {
    if (built) return
    built = true
    const frag = document.createDocumentFragment()
    for (const [k, v] of entriesOf(value)) {
      frag.append(renderNode(Array.isArray(value) ? null : k, v, depth + 1, openTo))
    }
    children.append(frag)
  }

  const setOpen = (isOpen) => {
    row.classList.toggle('open', isOpen)
    toggle.textContent = isOpen ? '▾' : '▸'
    toggle.setAttribute('aria-expanded', String(isOpen))
    summary.hidden = isOpen
    tail.hidden = isOpen
    if (isOpen) build()
  }

  toggle.addEventListener('click', () => setOpen(!row.classList.contains('open')))
  setOpen(depth < openTo)

  // Expand-all needs to reach nodes that were never opened, so it asks here.
  row.openAll = () => {
    setOpen(true)
    for (const child of children.children) child.openAll && child.openAll()
  }
  row.closeAll = () => {
    for (const child of children.children) child.closeAll && child.closeAll()
    setOpen(false)
  }

  return row
}

export function renderJsonTree(value, { openTo = 2 } = {}) {
  const root = el('div', 'jv')
  root.append(renderNode(null, value, 0, openTo))
  root.openAll = () => root.firstChild.openAll && root.firstChild.openAll()
  root.closeAll = () => root.firstChild.closeAll && root.firstChild.closeAll()
  return root
}
