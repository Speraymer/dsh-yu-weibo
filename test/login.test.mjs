import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, writeFileSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLogin } from '../lib/login.mjs'

function fixture(options = {}) {
  const children = []
  const login = createLogin({
    command: () => ({ file: 'mock-cli', args: ['login'] }), verify: async () => true,
    launch: (file, args, settings) => {
      assert.equal(file, 'mock-cli'); assert.equal(settings.shell, false)
      assert.equal(settings.windowsHide, true)
      const child = new EventEmitter()
      child.stdout = new EventEmitter(); child.stderr = new EventEmitter()
      child.killed = false; child.kill = () => { child.killed = true }
      children.push(child); return child
    }, ...options,
  })
  return { login, children }
}
const tick = () => new Promise((resolve) => setImmediate(resolve))

test('one login at a time; verify success, clear transient authorization data', async () => {
  const { login, children } = fixture()
  login.start(); login.start(); assert.equal(children.length, 1)
  assert.equal(login.snapshot().status, 'running')
  children[0].stdout.emit('data', Buffer.from('private_token=DO_NOT_EXPOSE'))
  assert.ok(!JSON.stringify(login.snapshot()).includes('DO_NOT_EXPOSE'))
  children[0].emit('close', 0); await tick()
  assert.equal(login.snapshot().status, 'success')
  assert.equal(login.snapshot().url, undefined); assert.equal(login.snapshot().qr, undefined)
})
test('cancel and retry ignore previous process completion', async () => {
  const { login, children } = fixture()
  login.start(); login.cancel(); assert.equal(children[0].killed, true)
  assert.equal(login.snapshot().status, 'cancelled')
  login.start(); children[0].emit('close', 0); await tick()
  assert.equal(login.snapshot().status, 'running')
  children[1].emit('close', 1); await tick(); assert.equal(login.snapshot().status, 'error')
})
test('spawn failures and failed account checks are not success', async () => {
  const broken = fixture({ launch() { throw Error('secret path') } }).login
  broken.start(); assert.equal(broken.snapshot().status, 'error')
  assert.ok(!JSON.stringify(broken.snapshot()).includes('secret path'))
  const { login, children } = fixture({ verify: async () => false })
  login.start(); children[0].emit('close', 0); await tick()
  assert.equal(login.snapshot().status, 'error')
})
test('timeout stops the child and cannot become success later', async () => {
  const { login, children } = fixture({ timeoutMs: 10 })
  login.start(); await new Promise((resolve) => setTimeout(resolve, 25))
  assert.equal(login.snapshot().status, 'expired'); assert.equal(children[0].killed, true)
  children[0].emit('close', 0); await tick(); assert.equal(login.snapshot().status, 'expired')
})
test('device output is parsed across chunks and rejects foreign links', () => {
  const { login, children } = fixture()
  login.start()
  children[0].stdout.emit('data', Buffer.from('https://evil.example/cli/device\n'))
  assert.equal(login.snapshot().url, undefined)
  children[0].stdout.emit('data', Buffer.from('https://open.weibo.com/cli/device?user_code=TEST-1234\nEnter this co'))
  children[0].stdout.emit('data', Buffer.from('de: TEST-1234\nWaiting for authorization'))
  assert.equal(login.snapshot().code, 'TEST-1234')
  assert.equal(login.snapshot().url, 'https://open.weibo.com/cli/device?user_code=TEST-1234')
  login.cancel(); assert.equal(login.snapshot().code, undefined)
})
