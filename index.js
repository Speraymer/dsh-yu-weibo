import { createLogin } from './lib/login.mjs'
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { cleanText, dueWindow, ensureSourceHome, localDay, remainingToday, storeRun, WINDOWS, writeJsonAtomic } from './lib/core.mjs'
import { weiboLoginCommand, checkWeibo, fetchWeibo, fetchWeiboCommands, publishWeibo } from './lib/provider.mjs'
import { claimCommands } from './lib/commands.mjs'
import { runPersonaPlanner } from './lib/headless.mjs'
import { buildOriginalWeiboPrompt, parseOriginalWeibo } from './lib/post.mjs'

export const name = 'weibo-scroll'
export const inject = ['webServer', 'agents']

const DEFAULTS = {
  enabled: true, autoRun: false, runAt: '21:30', limit: 10, keywords: '',
  peakValley: true, noon: true, night: true, perDay: 10, quotaDay: '', readToday: 0, lastWindowKey: '',
  trustedCommands: true, commandSession: '',
  model: 'deepseek-flash', dshBin: '',
  lastRunDay: '', lastRunAt: '', lastResult: '',
}

function homeOf(ctx) {
  try {
    const value = ctx?.get?.('dshHomePath')
    if (typeof value === 'function') return value('weibo-duty')
    if (typeof value === 'string' && value) return join(value, 'weibo-duty')
  } catch { /* 使用默认目录 */ }
  return join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'weibo-duty')
}

function readJson(file, fallback) {
  try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return fallback }
}

function sendJson(res, status, body) {
  if (res.headersSent || res.writableEnded) return
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

function readBody(req, limit = 32 * 1024) {
  return new Promise((resolve, reject) => {
    let text = '', size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) { reject(new Error('请求正文过大')); req.destroy(); return }
      text += chunk
    })
    req.on('end', () => {
      try { resolve(text ? JSON.parse(text) : {}) } catch { reject(new Error('JSON 格式错误')) }
    })
    req.on('error', reject)
  })
}

export function apply(ctx) {
  const root = homeOf(ctx)
  const configFile = join(root, 'config.json')
  const logFile = join(root, 'duty.log')
  const commandLedger = join(root, 'trusted-commands.json')
  const postLedger = join(root, 'posts.json')
  let config = { ...DEFAULTS, ...readJson(configFile, {}) }
  const login = createLogin({
    command: () => weiboLoginCommand(),
    verify: async () => (await checkWeibo()).loggedIn,
  })
  ctx.effect(() => () => login.cancel(), 'weibo-duty login cleanup')
  let running = false
  let posting = false
  let commandChecking = false, lastCommandCheck = 0

  const log = (message) => {
    try { appendFileSync(logFile, `${new Date().toISOString()} ${cleanText(message, 500)}\n`, 'utf8') } catch { /* 日志失败不阻塞 */ }
  }
  const save = (patch = {}) => {
    config = { ...config, ...patch }
    writeJsonAtomic(configFile, config)
    ensureSourceHome(root, { id: 'weibo', name: '微博', enabled: config.enabled })
  }
  ensureSourceHome(root, { id: 'weibo', name: '微博', enabled: config.enabled })
  if (!existsSync(configFile)) save()

  const publicConfig = () => ({
    enabled: config.enabled, autoRun: config.autoRun, runAt: config.runAt,
    limit: config.limit, keywords: config.keywords,
    peakValley: config.peakValley, noon: config.noon, night: config.night, perDay: config.perDay,
    readToday: config.quotaDay === localDay() ? Number(config.readToday) || 0 : 0,
    trustedCommands: config.trustedCommands, commandSession: config.commandSession,
  })

  const findAgent = (id) => {
    const value = String(id || '').trim()
    for (const candidate of value.startsWith('session-') ? [value, value.slice(8)] : [value, `session-${value}`]) {
      try { const agent = ctx.agents.get(candidate); if (agent) return agent } catch { /* 未打开 */ }
    }
  }

  const dispatchCommands = async () => {
    if (commandChecking) return 0
    if (!config.trustedCommands || !String(config.commandSession || '').trim()) return 0
    const agent = findAgent(config.commandSession)
    if (!agent) { log('trusted-command target=offline'); return 0 }
    commandChecking = true
    try {
      const { ownerId, items } = await fetchWeiboCommands()
      const commands = claimCommands(commandLedger, items, ownerId)
      for (const command of commands) {
        await agent.followup({ id: randomUUID(), role: 'user', content: [{ type: 'text', text: command.text }], source: { kind: 'weibo' } })
      }
      if (commands.length) log(`trusted-command delivered=${commands.length}`)
      return commands.length
    } catch (error) {
      log(`trusted-command error=${cleanText(error?.message || error, 200)}`)
      return 0
    } finally { commandChecking = false }
  }

  const personaStyle = () => {
    const file = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'AGENTS.md')
    try {
      const text = readFileSync(file, 'utf8'), learned = /<!-- AUTO:BEGIN -->([\s\S]*?)<!-- AUTO:END -->/.exec(text)
      return (learned ? learned[1] : '').trim().slice(0, 12000)
    } catch { return '' }
  }

  const postOriginalWeibo = async () => {
    if (posting) return { ok: false, error: '上一条还在生成或发布' }
    let history = readJson(postLedger, { attempts: [] })
    const today = localDay()
    if ((history.attempts || []).some((item) => item.day === today)) return { ok: false, error: '今天已经尝试发布过一条微博' }
    posting = true
    try {
      const output = await runPersonaPlanner(root, config, buildOriginalWeiboPrompt(personaStyle()))
      const text = parseOriginalWeibo(output)
      history = { attempts: [...(history.attempts || []), { day: today, at: new Date().toISOString(), status: 'started' }].slice(-400) }
      writeJsonAtomic(postLedger, history)
      const result = await publishWeibo(text)
      log('original-post ok')
      return { ok: true, summary: '大肥鱼已经自己想好主题并提交了一条微博', result }
    } catch (error) {
      const message = cleanText(error?.message || error, 500)
      log(`original-post error=${message}`)
      return { ok: false, error: `${message}。结果不明确时请先到微博核对；不会自动重试。` }
    } finally { posting = false }
  }

  const run = async (reason = 'manual', windowKey = '') => {
    if (running) return { ok: false, busy: true, error: '上一轮还在运行' }
    if (!config.enabled) return { ok: false, error: '刷微博已停用' }
    const remaining = reason === 'manual' ? Math.max(1, Math.min(Number(config.limit) || 10, 30)) : remainingToday(config)
    if (remaining <= 0) return { ok: true, skipped: true, read: 0, added: 0, error: '今天的自动浏览额度已用完' }
    running = true
    try {
      const items = await fetchWeibo({ ...config, limit: Math.min(Number(config.limit) || 10, remaining) })
      const commandCount = await dispatchCommands()
      const result = storeRun(root, '微博', items)
      const now = new Date()
      const day = localDay(now), used = config.quotaDay === day ? Number(config.readToday) || 0 : 0
      save({ ...(reason === 'manual' ? {} : { quotaDay: day, readToday: used + result.read }), ...(windowKey ? { lastWindowKey: windowKey } : {}), lastRunDay: day, lastRunAt: now.toISOString(), lastResult: `${reason}：新增 ${result.added}/${result.read}，可信指令 ${commandCount}` })
      log(`run reason=${reason} read=${result.read} added=${result.added}`)
      return { ok: true, ...result }
    } catch (error) {
      const message = cleanText(error?.message || error, 500)
      save({ lastResult: `${reason}失败：${message}`, ...(windowKey ? { lastWindowKey: windowKey } : {}) })
      log(`run error=${message}`)
      return { ok: false, error: message }
    } finally { running = false }
  }

  const status = async () => ({
    ok: true, home: root, running, posting, config: publicConfig(), windows: WINDOWS, lastRunAt: config.lastRunAt,
    lastResult: config.lastResult, provider: await checkWeibo(), personaSource: join(root, 'source.json'),
  })

  const handle = async (req, res, url) => {
    const path = url.pathname
    if (path === '/api/weibo-duty/login') {
      if (req.method === 'GET') return sendJson(res, 200, { ok: true, login: login.snapshot() })
      if (req.method === 'POST') {
        if (!/^application\/json(?:;|$)/i.test(req.headers?.['content-type'] || '')) return sendJson(res, 415, { ok: false, error: '请从设置页开始登录' })
        if (req.headers?.origin && req.headers.origin !== 'dsh-app://app') {
          let origin
          try { origin = new URL(req.headers.origin) } catch { return sendJson(res, 403, { ok: false, error: '请求来源无效' }) }
          if (origin.host !== req.headers.host || !['http:', 'https:'].includes(origin.protocol)) return sendJson(res, 403, { ok: false, error: '请求来源不匹配' })
        }
        const body = await readBody(req)
        if (body.cancel === true) login.cancel()
        else login.start()
        return sendJson(res, 200, { ok: true, login: login.snapshot() })
      }
      return sendJson(res, 405, { ok: false, error: '登录接口仅支持 GET / POST' })
    }
    if (req.method === 'GET' && path === '/api/weibo-duty/status') return sendJson(res, 200, await status())
    if (req.method === 'GET' && path === '/api/weibo-duty/config') return sendJson(res, 200, { ok: true, config: publicConfig() })
    if (req.method === 'POST' && path === '/api/weibo-duty/config') {
      const body = await readBody(req)
      const patch = {}
      if ('enabled' in body) patch.enabled = body.enabled === true
      if ('peakValley' in body) patch.peakValley = body.peakValley === true
      if ('noon' in body) patch.noon = body.noon === true
      if ('night' in body) patch.night = body.night === true
      if ('perDay' in body) patch.perDay = Math.max(0, Math.min(80, Number(body.perDay) || 0))
      if ('limit' in body) patch.limit = Math.max(1, Math.min(30, Number(body.limit) || 10))
      if ('keywords' in body) patch.keywords = cleanText(body.keywords, 200)
      if ('trustedCommands' in body) patch.trustedCommands = body.trustedCommands === true
      if ('commandSession' in body) patch.commandSession = cleanText(body.commandSession, 120)
      save(patch)
      return sendJson(res, 200, { ok: true, config: publicConfig() })
    }
    if (req.method === 'POST' && path === '/api/weibo-duty/run') return sendJson(res, 200, await run('manual'))
    if (req.method === 'POST' && path === '/api/weibo-duty/post') {
      const result = await postOriginalWeibo()
      return sendJson(res, result.ok ? 200 : 409, result)
    }
    if (req.method === 'GET' && path === '/api/weibo-duty/report') {
      const file = join(root, 'out', `${localDay()}.md`)
      return sendJson(res, 200, { ok: true, file, text: existsSync(file) ? readFileSync(file, 'utf8').slice(-100000) : '' })
    }
    return sendJson(res, 404, { ok: false, error: `unknown ${req.method} ${path}` })
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix', path: '/api/weibo-duty',
    handler: async (req, res) => {
      try { await handle(req, res, new URL(req.url, 'http://127.0.0.1')) }
      catch (error) { sendJson(res, 500, { ok: false, error: cleanText(error?.message || error, 300) }) }
    },
  }), 'weibo-duty api')

  const timer = setInterval(() => {
    const windowKey = dueWindow(config)
    if (windowKey && !running) void run('scheduled', windowKey)
    if (Date.now() - lastCommandCheck >= 5 * 60_000) { lastCommandCheck = Date.now(); void dispatchCommands() }
  }, 60_000)
  if (timer.unref) timer.unref()
  ctx.effect(() => () => clearInterval(timer), 'weibo-duty timer')
  log(`mounted home=${root}`)
}
