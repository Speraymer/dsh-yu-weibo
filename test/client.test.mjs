import test from 'node:test'
import assert from 'node:assert/strict'

test('registers a parallel settings section', async () => {
  let bundle, section
  globalThis.window = { __ModuleLoader__: { load(value) { bundle = value } } }
  globalThis.document = { head: { appendChild() {} }, createElement: () => ({ remove() {} }) }
  await import(`../client.js?test=${Date.now()}`)
  const plugin = bundle.factory(() => ({ createElement() {}, useState() {}, useCallback() {}, useEffect() {} }))
  const slots = { inject(_name, run) { run() }, register(meta) { section = meta } }
  plugin.apply({ get: () => slots, effect(run) { run() } })
  assert.deepEqual({ id: bundle.id, section: section.id, order: section.order, label: section.label }, {
    id: 'dsh-yu-weibo', section: 'weibo-scroll', order: 32, label: '刷微博',
  })
})

// 只读面板：没有登录按钮，也没有任何写操作入口；算法那件事要写在明面上
test('read-only panel has no login or write controls and explains the timeline', async () => {
  let bundle, render
  const requests = []
  const config = { enabled: true, peakValley: false, noon: true, night: true, perDay: 10, readToday: 0, keywords: '', readMode: 'web', readOnly: true }
  const data = {
    config, windows: { noon: { label: '中午', start: '12:00', end: '14:00' }, night: { label: '夜间', start: '18:00', end: '09:00' } },
    provider: { ok: true, guest: true, mode: 'web', engine: 'm.weibo.cn 访客', note: '访客热门流' },
    running: false, posting: false, lastResult: '', personaSource: 'C:\\x\\source.json',
  }
  const React = {
    createElement(type, props, ...children) {
      if (typeof type === 'function') return type(props || {})
      return { type, props: props || {}, children: children.flat(Infinity).filter((x) => x != null && x !== false) }
    },
    useState(initial) { return [Array.isArray(data.config) ? [] : initial === null ? data : initial, () => {}] },
    useCallback: (fn) => fn, useEffect: () => {},
  }
  const oldFetch = globalThis.fetch
  globalThis.fetch = async (url, options) => { requests.push({ url, options }); return { ok: true, json: async () => ({ ok: true }) } }
  try {
    globalThis.window = { __ModuleLoader__: { load(value) { bundle = value } } }
    await import('../client.js?readonly-ui=' + Date.now())
    const plugin = bundle.factory(() => React)
    const slots = { inject(_name, fn) { fn() }, register(_meta, fn) { render = fn } }
    plugin.apply({ get: () => slots, effect: (fn) => fn() })
    const flatten = (node) => (node && typeof node === 'object' ? [node, ...(node.children || []).flatMap(flatten)] : [])
    const nodes = flatten(render())
    const buttons = nodes.filter((n) => n.type === 'button').map((n) => n.children.join(''))
    assert.ok(buttons.includes('现在刷一轮'))
    assert.equal(buttons.some((label) => /登录/.test(label)), false, '只读模式不该有登录按钮')
    assert.equal(nodes.filter((n) => n.type === 'input' && n.props.type === 'checkbox').length, 4, '只剩启用/谷时/中午/夜间四个开关')
    const text = nodes.filter((n) => n.props && n.props['data-social-note'] !== undefined).map((n) => n.children.join('')).join('\n')
    assert.match(text, /只读/)
    assert.match(text, /statistics_from=hotweibo/)
  } finally { globalThis.fetch = oldFetch }
})
