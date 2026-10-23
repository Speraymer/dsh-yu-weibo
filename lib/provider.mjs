import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { cleanText, normalizeComments, normalizeItems } from './core.mjs'
import { fetchGuestComments, fetchGuestItems, probeGuest } from './web.mjs'

const require = createRequire(import.meta.url)

/**
 * 两种读法：
 *   web  —— 网页版 m.weibo.cn 的公开接口（访客身份，只读，默认）
 *   cli  —— 官方 @weibo-ai/weibo-cli（要开放平台服务开通；写入也走这条）
 */
export function readModeOf(config = {}) {
  return config.readMode === 'cli' ? 'cli' : 'web'
}

export const READ_ONLY_ERROR = '只读模式：这条链路只有 GET，没有点赞/评论/转发/发博'

function cliEntry() {
  return join(dirname(require.resolve('@weibo-ai/weibo-cli/package.json')), 'dist', 'index.js')
}

export function weiboLoginCommand() {
  return { file: process.execPath, args: [cliEntry(), 'auth', 'login', '--device'] }
}

function runCli(args, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliEntry(), ...args], {
      windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: process.env,
    })
    let stdout = '', stderr = '', settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill()
      reject(new Error('微博 CLI 超时'))
    }, timeoutMs)
    child.stdout.on('data', (chunk) => { stdout += chunk; if (stdout.length > 4 * 1024 * 1024) child.kill() })
    child.stderr.on('data', (chunk) => { stderr += chunk; if (stderr.length > 256 * 1024) child.kill() })
    child.on('error', (error) => {
      if (settled) return
      settled = true; clearTimeout(timer); reject(error)
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true; clearTimeout(timer)
      if (code !== 0) return reject(new Error(cleanText(stderr || stdout, 500) || `微博 CLI 退出码 ${code}`))
      try { resolve(JSON.parse(stdout)) } catch { reject(new Error('微博 CLI 没有返回 JSON')) }
    })
  })
}

function collectHotWords(node, out, depth = 0) {
  if (!node || depth > 4 || out.length >= 10) return out
  if (Array.isArray(node)) { for (const value of node) collectHotWords(value, out, depth + 1); return out }
  if (typeof node !== 'object') return out
  const word = cleanText(node.word || node.word_text || node.name || node.query, 40).replace(/^#+|#+$/g, '')
  if (word && !out.includes(word)) out.push(word)
  for (const value of Object.values(node)) if (value && typeof value === 'object') collectHotWords(value, out, depth + 1)
  return out
}

export function pickHotWord(payload) {
  const words = collectHotWords(payload, [])
  return words.find((word) => word.length >= 2) || ''
}

export function buildSearchArgs(keyword, limit) {
  return ['search', 'statuses/limited', '--q', String(keyword), '--type', '1', '--count', String(Math.max(1, Math.min(Number(limit) || 10, 30))), '--output', 'json']
}

// 微博 CLI 0.9.x 已经没有 friends_timeline 这条命令；留空关键词时先用热搜第一条当检索词。
export async function fetchWeibo(config = {}) {
  if (readModeOf(config) === 'web') {
    const { items } = await fetchGuestItems(config.root, config)
    return items
  }
  const limit = Math.max(1, Math.min(Number(config.limit) || 10, 30))
  let keyword = cleanText(config.keywords, 200)
  if (!keyword) {
    const hot = await runCli(['search', 'hot_word/biz', '--output', 'json'])
    keyword = pickHotWord(hot)
    if (!keyword) throw new Error('微博热搜没有返回可用的关键词；请在设置里填一个关键词')
  }
  const payload = await runCli(buildSearchArgs(keyword, limit))
  const items = normalizeItems(payload, `weibo·${keyword}`, limit)
  if (!items.length) throw new Error('微博 CLI 成功，但没有解析到内容；请检查账号权限或平台返回格式')
  return items
}

export async function fetchWeiboCommands(config = {}) {
  if (readModeOf(config) === 'web') {
    // 访客身份拿不到"哪个号是我发的"，可信指令这条路在只读模式下不成立。
    throw new Error('只读模式不支持可信指令：访客身份无法校验"这条是不是本人发的"')
  }
  const profile = await runCli(['auth', 'whoami', '--output', 'json'], 15_000)
  const ownerId = cleanText(profile?.user_id || profile?.uid || profile?.id || profile?.data?.user_id || profile?.data?.uid || profile?.data?.id, 120)
  if (!ownerId) throw new Error('微博账号信息没有返回可校验的 UID，可信指令保持关闭')
  const payload = await runCli(['statuses', 'user_timeline/biz', '--uid', ownerId, '--count', '10', '--output', 'json'])
  return { ownerId, items: normalizeItems(payload, 'weibo-command', 10) }
}

export async function publishWeibo(text, config = {}) {
  if (readModeOf(config) === 'web' || config.readOnly !== false) throw new Error(READ_ONLY_ERROR)
  const list = await runCli(['commands', 'list', '--output', 'json'], 15_000)
  const commands = Array.isArray(list?.commands) ? list.commands : []
  const candidate = commands.find((row) => row?.group === 'statuses' && /(?:create|update|publish|post)/i.test(String(row.action || '')) && row.access !== 'locked')
  if (!candidate) throw new Error('当前微博账号没有可用的发帖命令')
  const meta = await runCli(['commands', 'show', 'statuses', String(candidate.action), '--output', 'json'], 15_000)
  const flags = meta?.command?.flags || meta?.flags || []
  const textFlag = flags.find((flag) => ['status', 'text', 'content'].includes(String(flag?.name || '').toLowerCase()))
  if (!textFlag) throw new Error('微博发帖命令没有返回正文参数定义，已停止以避免误调用')
  return runCli(['statuses', String(candidate.action), `--${textFlag.name}`, String(text), '--output', 'json'])
}

function actionId(value, label = '目标 ID') {
  const id = String(value ?? '').trim()
  if (!/^\d{1,20}$/.test(id)) throw new Error(`${label} 必须是 1–20 位数字`)
  return id
}

function actionText(value, max) {
  return String(value ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max)
}

export function prepareWeiboAction(input = {}) {
  const kind = String(input.kind || '')
  const undo = input.undo === true
  if (kind === 'like') {
    const targetId = actionId(input.targetId)
    return {
      args: ['attitudes', undo ? 'destroy' : 'create', '--id', targetId, ...(undo ? [] : ['--attitude', 'heart']), '--output', 'json'],
      summary: `${undo ? '取消点赞' : '点赞'}微博 ${targetId}`,
    }
  }
  if (kind === 'comment') {
    const targetId = actionId(input.targetId)
    const text = actionText(input.text, 140)
    if (!text) throw new Error('评论正文不能为空')
    return {
      args: ['comments', 'create', '--id', targetId, '--comment', text, '--output', 'json'],
      summary: `评论微博 ${targetId}（${text.length} 字）`,
    }
  }
  if (kind === 'reply') {
    const targetId = actionId(input.targetId)
    const cid = actionId(input.replyTo, '评论 ID')
    const text = actionText(input.text, 140)
    if (!text) throw new Error('回复正文不能为空')
    return {
      args: ['comments', 'reply', '--id', targetId, '--cid', cid, '--comment', text, '--output', 'json'],
      summary: `回复评论 ${cid}（${text.length} 字）`,
    }
  }
  if (kind === 'repost') {
    const targetId = actionId(input.targetId)
    const text = actionText(input.text, 120)
    if (!text) throw new Error('转发语不能为空；没话说就别转')
    return {
      args: ['statuses', 'repost', '--id', targetId, '--status', text, '--output', 'json'],
      summary: `转发微博 ${targetId}（${text.length} 字）`,
    }
  }
  if (kind === 'post') {
    const text = actionText(input.text, 200)
    if (!text) throw new Error('微博正文不能为空')
    return { args: ['statuses', 'update', '--status', text, '--output', 'json'], summary: `发一条微博（${text.length} 字）` }
  }
  throw new Error('只支持点赞、评论、回复、转发和发博')
}

export async function executeWeiboAction(action, config = {}) {
  if (readModeOf(config) === 'web' || config.readOnly !== false) throw new Error(READ_ONLY_ERROR)
  const prepared = prepareWeiboAction(action)
  return runCli(prepared.args)
}

export async function fetchWeiboComments(config = {}) {
  if (readModeOf(config) === 'web') {
    // 网页版访客没有"别人给我的评论"这个入口；这里返回空，由调用方跳过。
    return []
  }
  const count = Math.max(1, Math.min(Number(config.commentFetch) || 10, 30))
  const payload = await runCli(['comments', 'to_me/biz', '--count', String(count), '--output', 'json'])
  return normalizeComments(payload, count)
}

/** 去某条微博底下读热评（只读；网页版访客可用） */
export async function fetchWeiboThreadComments(config = {}, id, limit = 10) {
  return fetchGuestComments(config.root, id, limit)
}

export async function checkWeibo(config = {}) {
  if (readModeOf(config) === 'web') {
    try {
      const probe = await probeGuest(config.root)
      return {
        ok: probe.ok, loggedIn: false, guest: true, mode: 'web',
        account: '', engine: 'm.weibo.cn 访客',
        note: probe.ok ? (probe.guestFeed ? '访客热门流' : '访客时间线') : '读不到内容',
        error: probe.ok ? '' : `HTTP ${probe.status}`,
      }
    } catch (error) {
      return { ok: false, loggedIn: false, guest: true, mode: 'web', engine: 'm.weibo.cn 访客', error: cleanText(error?.message || error, 300) }
    }
  }
  try {
    const value = await runCli(['auth', 'whoami', '--output', 'json'], 15_000)
    const user = value?.user || value?.data?.user || {}
    return {
      ok: true, loggedIn: true,
      account: cleanText(user.username || value?.screen_name || value?.name || value?.data?.screen_name, 100),
      balance: cleanText(user.balance ?? value?.service_status?.balance, 20),
      service: cleanText(value?.service_status?.label, 40),
    }
  } catch (error) {
    return { ok: true, loggedIn: false, error: cleanText(error?.message || error, 300) }
  }
}
