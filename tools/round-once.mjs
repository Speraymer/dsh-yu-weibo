// 手动跑一轮（不经过 DSH UI）：用来验证插件本体能读到东西并落盘
import { Readable } from 'node:stream'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { apply } from '../index.js'

const home = join(homedir(), '.dsh')
let handler
const dispose = []
apply({
  get: (key) => (key === 'dshHomePath' ? (sub) => join(home, sub || '') : undefined),
  webServer: { register: (value) => { handler = value.handler; return () => {} } },
  effect: (run) => { const stop = run(); if (typeof stop === 'function') dispose.push(stop) },
  agents: { get: () => null },
})

const call = async (method, path) => {
  const req = Readable.from([JSON.stringify({})])
  req.method = method; req.url = path
  req.headers = { host: '127.0.0.1:9999', 'content-type': 'application/json', origin: 'dsh-app://app' }
  let body = ''
  const res = { setHeader() {}, end: (value) => { body = value } }
  await handler(req, res)
  return JSON.parse(body)
}

console.log('status:', JSON.stringify(await call('GET', '/api/weibo-duty/status').then((s) => ({
  enabled: s.config.enabled, readMode: s.config.readMode, readOnly: s.config.readOnly, provider: s.provider,
}))))
const started = Date.now()
const result = await call('POST', '/api/weibo-duty/run')
console.log(`run (${Math.round((Date.now() - started) / 1000)}s):`, JSON.stringify(result).slice(0, 400))
for (const stop of dispose.reverse()) stop()
process.exit(0)
