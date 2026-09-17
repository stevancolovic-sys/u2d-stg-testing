(function () {
  var D = window.DOCS
  var $ = function (s) { return document.querySelector(s) }
  var CONSOLE_KEY = 'up2data.docs.consoleBase'

  function el(tag, cls, text) {
    var n = document.createElement(tag)
    if (cls) n.className = cls
    if (text !== undefined) n.textContent = text
    return n
  }

  function consoleBase() {
    try { return localStorage.getItem(CONSOLE_KEY) || 'http://localhost:8787' }
    catch (e) { return 'http://localhost:8787' }
  }

  // ---- index for search -------------------------------------------------

  var ITEMS = []
  D.guides.forEach(function (g) {
    ITEMS.push({
      kind: 'guide', id: g.id, name: g.name, group: 'Guides',
      haystack: (g.name + ' ' + g.body.map(function (b) { return b.p || b.warn || '' }).join(' ')).toLowerCase(),
      data: g,
    })
  })
  D.endpoints.forEach(function (e) {
    ITEMS.push({
      kind: 'endpoint', id: e.id, name: e.label, group: e.group, method: e.method,
      haystack: (e.label + ' ' + e.path + ' ' + e.summary + ' ' + e.fields.map(function (f) { return f.name }).join(' ')).toLowerCase(),
      data: e,
    })
  })
  D.schemas.forEach(function (s) {
    ITEMS.push({
      kind: 'schema', id: s.id, name: s.name, group: 'Response shapes',
      haystack: (s.name + ' ' + s.blurb + ' ' + JSON.stringify(s.shape)).toLowerCase(),
      data: s,
    })
  })

  // ---- nav --------------------------------------------------------------

  function renderNav(filter) {
    var nav = $('#nav')
    nav.textContent = ''
    var q = (filter || '').trim().toLowerCase()
    var shown = q ? ITEMS.filter(function (i) { return i.haystack.indexOf(q) > -1 }) : ITEMS

    if (!shown.length) {
      nav.append(el('p', 'nav-empty', 'Nothing matches “' + filter + '”.'))
      return
    }

    var group = null
    shown.forEach(function (item) {
      if (item.group !== group) {
        group = item.group
        nav.append(el('div', 'nav-group', group))
      }
      var btn = el('button', 'nav-item' + (item.kind === 'endpoint' ? '' : ' prose'))
      btn.dataset.id = item.kind + ':' + item.id
      btn.append(el('span', null, item.name))
      if (item.method) btn.append(el('span', 'verb ' + item.method.toLowerCase(), item.method))
      btn.addEventListener('click', function () { location.hash = '#/' + item.kind + '/' + item.id })
      nav.append(btn)
    })
    markActive()
  }

  function markActive() {
    var current = route()
    ;[].forEach.call(document.querySelectorAll('.nav-item'), function (b) {
      b.classList.toggle('on', b.dataset.id === current.kind + ':' + current.id)
    })
  }

  // ---- schema tree ------------------------------------------------------

  function typeOf(value) {
    if (Array.isArray(value)) return 'array'
    if (value && typeof value === 'object') return 'object'
    return 'leaf'
  }

  function splitNote(text) {
    var parts = String(text).split(' — ')
    return { type: parts[0], note: parts.slice(1).join(' — ') }
  }

  function renderNode(name, value, depth) {
    var li = el('li')
    var kind = typeOf(value)

    if (kind === 'leaf') {
      var bits = splitNote(value)
      var row = el('div', 'twig')
      row.append(el('span', 'fname', name))
      row.append(el('span', 'ftype', bits.type))
      if (bits.note) row.append(el('span', 'fnote', bits.note))
      li.append(row)
      return li
    }

    var isArray = kind === 'array'
    var inner = isArray ? value[0] : value
    var details = el('details')
    if (depth < 1) details.open = true

    var summary = el('summary')
    summary.append(el('span', 'fname', name))
    summary.append(el('span', 'ftype', isArray ? 'array of ' + (typeOf(inner) === 'leaf' ? splitNote(inner).type : 'object') : 'object'))
    details.append(summary)

    if (typeOf(inner) === 'leaf') {
      var note = splitNote(inner).note
      if (note) {
        var ul0 = el('ul')
        var only = el('li')
        only.append(el('span', 'fnote', note))
        ul0.append(only)
        details.append(ul0)
      }
    } else {
      var ul = el('ul')
      Object.keys(inner).forEach(function (key) { ul.append(renderNode(key, inner[key], depth + 1)) })
      details.append(ul)
    }

    li.append(details)
    return li
  }

  function renderSchema(schema) {
    var main = $('#main')
    main.append(el('h1', null, schema.name))
    main.append(el('p', 'lede', schema.blurb))

    var actions = el('div', 'tree-actions')
    var expand = el('button', 'btn', 'Expand all')
    var collapse = el('button', 'btn', 'Collapse all')
    actions.append(expand, collapse)
    main.append(actions)

    var tree = el('div', 'tree')
    var ul = el('ul')
    Object.keys(schema.shape).forEach(function (key) { ul.append(renderNode(key, schema.shape[key], 0)) })
    tree.append(ul)
    main.append(tree)

    expand.addEventListener('click', function () {
      [].forEach.call(tree.querySelectorAll('details'), function (d) { d.open = true })
    })
    collapse.addEventListener('click', function () {
      [].forEach.call(tree.querySelectorAll('details'), function (d) { d.open = false })
    })
  }

  // ---- endpoint ---------------------------------------------------------

  function curlFor(e) {
    var base = 'https://api.staging.uptodata.io/api'
    var lines = ['curl -X ' + e.method + " '" + base + e.path + "'"]
    if (e.method !== 'GET') lines.push("  -H 'Content-Type: application/json'")
    if (e.auth) lines.push("  -H 'Authorization: YOUR_ACCESS_TOKEN'")
    if (e.method !== 'GET') {
      var body = {}
      e.fields.forEach(function (f) {
        if (!f.required) return
        body[f.name] = f.type === 'lines' || f.type === 'tags' ? ['…'] :
          f.type === 'links' ? [{ url: '…', limit: 100 }] :
          f.type === 'number' ? 2 : '…'
      })
      lines.push("  -d '" + JSON.stringify(body, null, 2) + "'")
    }
    return lines.join(' \\\n')
  }

  function renderEndpoint(e) {
    var main = $('#main')
    main.append(el('h1', 'mono', e.label))

    var meta = el('div', 'meta')
    meta.append(el('span', 'pill path', e.method + ' ' + e.path))
    meta.append(el('span', 'pill ' + (e.auth ? 'auth' : 'open'), e.auth ? 'token required' : 'public'))
    main.append(meta)

    main.append(el('p', 'lede', e.summary))

    var cost = el('div', 'cost')
    cost.append(el('b', null, 'Cost. '))
    cost.append(document.createTextNode(e.cost))
    main.append(cost)

    if (e.fields.length) {
      main.append(el('h2', null, e.method === 'GET' ? 'Query parameters' : 'Request body'))
      var table = el('table', 'fields')
      var head = el('tr')
      ;['Field', 'Type', '', 'Notes'].forEach(function (h) { head.append(el('th', null, h)) })
      table.append(head)

      e.fields.forEach(function (f) {
        var tr = el('tr')
        tr.append(el('td', 'name', f.name))
        tr.append(el('td', 'type', f.choices ? f.choices.join(' · ') : f.type))
        var flag = el('td')
        flag.append(el('span', f.required ? 'req' : 'opt', f.required ? 'required' : 'optional'))
        tr.append(flag)
        tr.append(el('td', 'hint', f.hint))
        table.append(tr)
      })
      main.append(table)
    }

    if (e.notes.length) {
      main.append(el('h2', null, 'Worth knowing'))
      e.notes.forEach(function (n) {
        main.append(el('div', 'note ' + (n.warn ? 'warn' : 'info'), n.warn || n.info))
      })
    }

    main.append(el('h2', null, 'Example'))
    main.append(el('div', 'code-label', 'Required fields only'))
    main.append(el('pre', null, curlFor(e)))

    var row = el('div', 'console-row')
    var open = el('button', 'btn primary', 'Open in console')
    var input = el('input')
    input.type = 'text'
    input.value = consoleBase()
    input.title = 'Where the console is running'
    input.addEventListener('change', function () {
      try { localStorage.setItem(CONSOLE_KEY, input.value.replace(/\/+$/, '')) } catch (err) {}
    })
    open.addEventListener('click', function () {
      window.open(consoleBase() + '/?endpoint=' + encodeURIComponent(e.id), '_blank')
    })
    row.append(open, input, el('span', 'why', 'opens this endpoint with its form ready'))
    main.append(row)
  }

  // ---- guide ------------------------------------------------------------

  function renderGuide(g) {
    var main = $('#main')
    main.append(el('h1', null, g.name))
    g.body.forEach(function (b) {
      if (b.p) main.append(el('p', b === g.body[0] ? 'lede' : null, b.p))
      else if (b.warn) main.append(el('div', 'note warn', b.warn))
      else if (b.code) {
        main.append(el('div', 'code-label', b.code.label))
        main.append(el('pre', null, b.code.text))
      }
    })
  }

  // ---- routing ----------------------------------------------------------

  function route() {
    var m = (location.hash || '').match(/^#\/(guide|endpoint|schema)\/([\w\-]+)$/)
    if (m) return { kind: m[1], id: m[2] }
    return { kind: 'guide', id: D.guides[0].id }
  }

  function render() {
    var r = route()
    var main = $('#main')
    main.textContent = ''

    var item = ITEMS.filter(function (i) { return i.kind === r.kind && i.id === r.id })[0]
    if (!item) {
      main.append(el('h1', null, 'Not found'))
      main.append(el('p', null, 'Nothing here answers to that address.'))
      return
    }

    if (item.kind === 'guide') renderGuide(item.data)
    else if (item.kind === 'endpoint') renderEndpoint(item.data)
    else renderSchema(item.data)

    main.scrollIntoView({ block: 'start' })
    markActive()
    document.title = item.name + ' — Up2Data reference'
  }

  window.addEventListener('hashchange', render)

  $('#q').addEventListener('input', function (ev) { renderNav(ev.target.value) })

  document.addEventListener('keydown', function (ev) {
    if (ev.key === '/' && document.activeElement !== $('#q')) {
      ev.preventDefault()
      $('#q').focus()
      $('#q').select()
    }
    if (ev.key === 'Escape' && document.activeElement === $('#q')) {
      $('#q').value = ''
      renderNav('')
      $('#q').blur()
    }
  })

  renderNav('')
  render()
})()
