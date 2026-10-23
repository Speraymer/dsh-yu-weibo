/**
 * web.mjs —— 只读采样：走网页版 m.weibo.cn 的公开接口（访客身份）
 *
 * 为什么不用官方 weibo-cli：
 *   · 开放平台服务要开通/要认证，写操作还动不动被限；
 *   · 网页版这几个口子对访客开放，只读够用，而且零费用。
 *
 * 怎么发请求：裸 CDP 驱动本机 Edge（无 Playwright 依赖），在页面里 `fetch`，
 * 同源 + 真浏览器指纹，比 Node 直连（会被回 432 / 丢去 Visitor System）稳。
 * 读取时窗口挪到屏幕外，不用 headless —— headless 的 UA 微博一眼认出来。
 *
 * ⚠️ 这是 READ-ONLY：本文件只有 GET，没有点赞/评论/转发/发博。
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { homedir } from 'node:os'

export const EDGE = [
  process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA,
].filter(Boolean).map((p) => join(p, 'Microsoft', 'Edge', 'Application', 'msedge.exe')).find(existsSync)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function profileDir(root) {
  const dir = join(root || join(homedir(), '.dsh', 'weibo-duty'), 'edge-profile')
  mkdirSync(dir, { recursive: true })
  return dir
}

async function waitPort(profile, timeoutMs = 20_000, afterMs = 0) {
  const file = join(profile, 'DevToolsActivePort')
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (existsSync(file)) {
      let fresh = true
      try { fresh = statSync(file).mtimeMs >= afterMs - 1500 } catch { fresh = false }
      if (fresh) {
        const [port, path] = readFileSync(file, 'utf8').trim().split(/\r?\n/)
        if (/^\d+$/.test(port || '') && /^\/devtools\/browser\/[\w-]+$/.test(path || '')) return { port: +port, path }
      }
    }
    await sleep(120)
  }
  throw new Error('Edge 没有开出调试端口')
}

function connect(wsUrl) {
  const socket = new WebSocket(wsUrl)
  let seq = 0
  const pending = new Map()
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('连接浏览器超时')), 10_000)
    socket.addEventListener('open', () => { clearTimeout(timer); resolve() }, { once: true })
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('连接浏览器失败')) }, { once: true })
  })
  socket.addEventListener('message', ({ data }) => {
    let msg; try { msg = JSON.parse(data) } catch { return }
    const req = pending.get(msg.id)
    if (!req) return
    pending.delete(msg.id); clearTimeout(req.timer)
    if (msg.error) req.reject(new Error(msg.error.message || 'CDP 错误'))
    else req.resolve(msg.result)
  })
  const call = async (method, params = {}, sessionId) => {
    await ready
    const id = ++seq
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP 超时：${method}`)) }, 40_000)
      pending.set(id, { resolve, reject, timer })
      try { socket.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params })) }
      catch (e) { pending.delete(id); clearTimeout(timer); reject(e) }
    })
  }
  return { call, close: () => { try { socket.close() } catch {} } }
}

async function launchEdge(profile) {
  if (!EDGE) throw new Error('找不到 Edge，只读采样需要一个本机 Edge')
  const portFile = join(profile, 'DevToolsActivePort')
  const args = [
    `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1',
    '--no-first-run', '--no-default-browser-check', '--disable-features=Translate,MediaRouter',
    '--window-position=-32000,-32000', '--window-size=1200,860', '--mute-audio',
    'https://m.weibo.cn/',
  ]

  // 上一轮没关干净时会留下端口文件，指着死端口 —— 先试着接，接不上再清。
  const attachExisting = async () => {
    if (!existsSync(portFile)) return null
    const [port, path] = readFileSync(portFile, 'utf8').trim().split(/\r?\n/)
    if (!/^\d+$/.test(port || '')) return null
    let client = null
    try {
      client = connect(`ws://127.0.0.1:${port}${path}`)
      await client.call('Browser.getVersion')
      return client
    } catch { try { client?.close() } catch {}; return null }
  }
  const existing = await attachExisting()
  if (existing) return { child: null, client: existing, close: () => existing.close() }

  try { rmSync(portFile, { force: true }) } catch {}
  const startedAt = Date.now()
  const child = spawn(EDGE, args, { stdio: 'ignore', windowsHide: true })
  let client = null, lastError = null
  for (let attempt = 0; attempt < 3 && !client; attempt++) {
    try {
      const { port, path } = await waitPort(profile, 20_000, startedAt)
      client = connect(`ws://127.0.0.1:${port}${path}`)
      await client.call('Browser.getVersion')
    } catch (e) {
      lastError = e
      try { client?.close() } catch {}; client = null
      try { rmSync(portFile, { force: true }) } catch {}
      await sleep(900)
      if (child.exitCode !== null) break
    }
  }
  if (!client) { try { child.kill() } catch {}; throw lastError || new Error('连不上 Edge') }
  return { child, client, close: () => { try { client.close() } catch {}; try { child.kill() } catch {} } }
}

async function withPage(client, fn) {
  const { targetId } = await client.call('Target.createTarget', { url: 'https://m.weibo.cn/' })
  const { sessionId } = await client.call('Target.attachToTarget', { targetId, flatten: true })
  const evaluate = async (expression) => {
    const r = await client.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId)
    if (r.exceptionDetails) throw new Error('页面脚本出错：' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text))
    return r.result?.value
  }
  const go = async (url) => {
    try { await client.call('Page.navigate', { url }, sessionId) } catch (e) {
      if (!/navigated or closed/.test(e.message)) throw e
    }
    await waitLoaded(client, sessionId)
  }
  try {
    await client.call('Page.enable', {}, sessionId)
    await client.call('Runtime.enable', {}, sessionId)
    await go('https://m.weibo.cn/')
    // 新 profile 第一次来会被丢去 Sina Visitor System；等它把访客 cookie 种下，再回 m.weibo.cn
    for (let attempt = 0; attempt < 4; attempt++) {
      let host = ''
      try { host = String(await evaluate('location.host')) } catch { host = '' }
      if (host === 'm.weibo.cn') break
      await sleep(900)
      await go('https://m.weibo.cn/')
    }
    const host = String(await evaluate('location.host'))
    if (host !== 'm.weibo.cn') throw new Error(`微博页面没落在 m.weibo.cn（停在 ${host || '未知'}）`)
    return await fn(evaluate)
  } finally {
    try { await client.call('Target.closeTarget', { targetId }) } catch {}
  }
}

async function waitLoaded(client, sessionId, timeoutMs = 25_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const r = await client.call('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true }, sessionId)
      if (r.result?.value === 'complete') return
    } catch {}
    await sleep(200)
  }
  throw new Error('页面加载超时')
}

/** 页面里跑一次 GET，返回 { status, json, text } */
function pageGet(evaluate, url, timeoutMs = 20_000) {
  return evaluate(`(async () => {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), ${timeoutMs})
    try {
      const res = await fetch(${JSON.stringify(url)}, { credentials: 'include', signal: ctl.signal, headers: { 'x-requested-with': 'XMLHttpRequest', 'mweibo-pwa': '1' } })
      const text = await res.text()
      let json = null
      try { json = JSON.parse(text) } catch {}
      return { status: res.status, json, len: text.length, head: text.slice(0, 160) }
    } finally { clearTimeout(t) }
  })()`)
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

export function cleanHtml(html) {
  if (!html) return ''
  const s = String(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<a[^>]*>([\s\S]*?)<\/a>/gi, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (m, code) => {
      if (code[0] === '#') {
        const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
        return Number.isFinite(n) ? String.fromCodePoint(n) : m
      }
      return ENT[code.toLowerCase()] ?? m
    })
  return s.replace(/[ \t\u00a0]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
}

const API = {
  recommend: () => '/api/container/getIndex?containerid=102803',
  // 访客身份下这个 container 给的是热门流（响应里 statistics_from=hotweibo），不是"你关注的人"
  hotTimeline: () => '/api/container/getIndex?containerid=102803_ctg1_8999_-_ctg1_8999_home&page_type=03',
  search: (q, page = 1) => `/api/container/getIndex?containerid=${encodeURIComponent(`100103type=1&q=${q}`)}&page_type=searchall&page=${page}`,
  hotWords: () => '/api/container/getIndex?containerid=' + encodeURIComponent('106003type=25&t=3&disable_hot=1&filter_type=realtimehot'),
  comments: (id) => `/comments/hotflow?id=${id}&mid=${id}&max_id_type=0`,
}

function pickMblogs(payload) {
  const cards = payload?.data?.cards || []
  const out = []
  for (const card of cards) {
    if (card.mblog) out.push(card.mblog)
    for (const group of card.card_group || []) if (group.mblog) out.push(group.mblog)
  }
  return out
}

/** 把一条 mblog 变成插件里统一的素材形状（和 core.normalizeItems 同一套字段） */
export function toItem(mblog) {
  const id = String(mblog?.id || mblog?.mid || '')
  const text = cleanHtml(mblog?.longText?.longTextContent || mblog?.text)
  if (!id || !text) return null
  const user = mblog.user || {}
  const remoteId = id
  return {
    id: createHash('sha256').update(`weibo\0${remoteId}`).digest('hex').slice(0, 24),
    remoteId,
    title: text.slice(0, 60),
    text: text.slice(0, 1200),
    author: cleanHtml(user.screen_name).slice(0, 100),
    authorId: String(user.id || ''),
    url: `https://m.weibo.cn/detail/${id}`,
  }
}

/**
 * 读一轮。
 * @param {string} root       数据目录（放 edge-profile）
 * @param {object} config     { limit, keywords }
 * @returns {{ items, info }}
 */
export async function fetchGuestItems(root, config = {}) {
  const limit = Math.max(1, Math.min(Number(config.limit) || 10, 30))
  const keyword = String(config.keywords || '').trim().slice(0, 200)
  const browser = await launchEdge(profileDir(root))
  const info = { engine: 'm.weibo.cn 访客', mode: keyword ? 'search' : 'timeline', keyword }
  try {
    return await withPage(browser.client, async (evaluate) => {
      const calls = keyword
        ? [['search', pageGet(evaluate, API.search(keyword, 1))]]
        : [['recommend', pageGet(evaluate, API.recommend())], ['hot', pageGet(evaluate, API.hotTimeline())]]

      const items = []
      const seen = new Set()
      for (const [what, promise] of calls) {
        const r = await promise
        const list = pickMblogs(r.json)
        info[what] = { status: r.status, items: list.length }
        for (const mblog of list) {
          const item = toItem(mblog)
          if (!item || seen.has(item.remoteId)) continue
          seen.add(item.remoteId)
          items.push(item)
          if (items.length >= limit) break
        }
        if (items.length >= limit) break
      }
      if (!items.length) {
        const first = await calls[0][1]
        throw new Error(`微博网页版没返回内容（HTTP ${first?.status ?? '?'}）；可能被限流，过一会儿再试`)
      }
      return { items, info }
    })
  } finally { browser.close() }
}

/** 只读探活：能不能读到东西 */
export async function probeGuest(root) {
  const browser = await launchEdge(profileDir(root))
  try {
    return await withPage(browser.client, async (evaluate) => {
      const r = await pageGet(evaluate, API.recommend())
      const n = pickMblogs(r.json).length
      const guestOnly = r.json?.data?.cardlistInfo?.statistics_from === 'hotweibo'
      return { ok: n > 0, items: n, status: r.status, guestFeed: guestOnly }
    })
  } finally { browser.close() }
}

export async function fetchGuestComments(root, id, limit = 10) {
  if (!/^\d{6,}$/.test(String(id || ''))) return []
  const browser = await launchEdge(profileDir(root))
  try {
    return await withPage(browser.client, async (evaluate) => {
      const r = await pageGet(evaluate, API.comments(id))
      const list = r.json?.data?.data || []
      return list.slice(0, limit).map((c) => ({
        id: String(c.id || ''),
        contentId: String(id),
        text: cleanHtml(c.text),
        author: cleanHtml(c.user?.screen_name),
        authorId: String(c.user?.id || ''),
        likes: c.like_count ?? 0,
      }))
    })
  } finally { browser.close() }
}

export async function fetchHotWords(root, limit = 20) {
  const browser = await launchEdge(profileDir(root))
  try {
    return await withPage(browser.client, async (evaluate) => {
      const r = await pageGet(evaluate, API.hotWords())
      const words = []
      const dig = (node, depth = 0) => {
        if (!node || depth > 4) return
        if (Array.isArray(node)) return node.forEach((v) => dig(v, depth + 1))
        if (typeof node !== 'object') return
        const w = node.word || node.name
        if (typeof w === 'string' && w.trim() && !words.includes(w.trim())) words.push(w.trim())
        Object.values(node).forEach((v) => { if (v && typeof v === 'object') dig(v, depth + 1) })
      }
      dig(r.json?.data?.cards || [])
      return words.slice(0, limit)
    })
  } finally { browser.close() }
}
