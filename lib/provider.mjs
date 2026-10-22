import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { cleanText, normalizeItems } from './core.mjs'

const require = createRequire(import.meta.url)

function cliEntry() {
  return join(dirname(require.resolve('@weibo-ai/weibo-cli/package.json')), 'dist', 'index.js')
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

export async function fetchWeibo(config) {
  const query = cleanText(config.keywords, 200)
  const args = query
    ? ['search', 'statuses/limited', '--q', query, '--output', 'json']
    : ['statuses', 'friends_timeline/biz', '--count', String(config.limit), '--output', 'json']
  const payload = await runCli(args)
  const items = normalizeItems(payload, 'weibo', config.limit)
  if (!items.length) throw new Error('微博 CLI 成功，但没有解析到内容；请检查账号权限或平台返回格式')
  return items
}

export async function fetchWeiboCommands() {
  const profile = await runCli(['auth', 'whoami', '--output', 'json'], 15_000)
  const ownerId = cleanText(profile?.user_id || profile?.uid || profile?.id || profile?.data?.user_id || profile?.data?.uid || profile?.data?.id, 120)
  if (!ownerId) throw new Error('微博账号信息没有返回可校验的 UID，可信指令保持关闭')
  const payload = await runCli(['statuses', 'user_timeline/biz', '--uid', ownerId, '--count', '10', '--output', 'json'])
  return { ownerId, items: normalizeItems(payload, 'weibo-command', 10) }
}

export async function publishWeibo(text) {
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

export async function checkWeibo() {
  try {
    const value = await runCli(['auth', 'whoami', '--output', 'json'], 15_000)
    return { ok: true, loggedIn: true, account: cleanText(value?.screen_name || value?.name || value?.data?.screen_name, 100) }
  } catch (error) {
    return { ok: true, loggedIn: false, error: cleanText(error?.message || error, 300) }
  }
}
