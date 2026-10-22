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
    id: 'dsh-weibo-scroll', section: 'weibo-scroll', order: 32, label: '刷微博',
  })
})
