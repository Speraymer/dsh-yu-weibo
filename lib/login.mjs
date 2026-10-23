import { spawn } from 'node:child_process'

export function stopLoginProcess(child, run = spawn, platform = process.platform) {
  if (!child || child.exitCode != null) return
  if (platform === 'win32' && child.pid) {
    // Windows 的 Python 启动器可能另起子进程，取消时只结束本次登录进程树。
    const killer = run('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', shell: false })
    killer.once('error', () => child.kill())
  } else child.kill()
}

// 仅返回二维码 / 授权链接和状态；CLI 原始输出可能含凭据，不回显也不记日志。
export function createLogin({ command, verify, launch = spawn, timeoutMs = 240_000 }) {
  let state = { status: 'idle', message: '' }, active = null
  
  const finish = (job, status, message) => {
    if (active !== job) return
    clearTimeout(job.timer)
    active = null
    state = { status, message }
  }
  const cancel = () => {
    if (!active) return
    const job = active
    finish(job, 'cancelled', '已取消登录。原有账号凭据不会由插件清除。')
    stopLoginProcess(job.child)
  }
  const start = () => {
    if (active) return
    const job = { child: null, timer: null, output: '' }
    active = job
    state = { status: 'running', message: '正在获取微博授权链接…' }
    try {
      const spec = command()
      if (!spec.file) throw new Error('missing command')
      job.child = launch(spec.file, spec.args, {
        windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, NO_COLOR: '1', PYTHONUTF8: '1', PYTHONUNBUFFERED: '1' },
      })
      job.timer = setTimeout(() => {
        finish(job, 'expired', '登录已超时，请重新点击登录获取新的授权信息。')
        stopLoginProcess(job.child)
      }, timeoutMs)
      job.timer.unref?.()
      let outputSize = 0
      const read = (chunk) => {
        if (active !== job) return
        outputSize += chunk.length
        if (outputSize > 256 * 1024) {
          finish(job, 'error', '登录程序返回异常，请检查程序版本后重试。')
          stopLoginProcess(job.child)
          return
        }
        job.output = (job.output + chunk.toString('utf8')).replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').slice(-8192)
        const match = /https:\/\/open\.weibo\.com\/cli\/[^\s<>"']+/.exec(job.output)
        const code = /Enter this code:\s*([A-Za-z0-9-]{4,32})(?=\s|$)/.exec(job.output)
        if (match) {
          const url = new URL(match[0])
          if (url.hostname === 'open.weibo.com' && !url.username && !url.password) state.url = url.href
        }
        if (code) state.code = code[1]
        if (state.url && state.code) state.message = '打开授权页，输入下方验证码并确认。此页会自动检查登录结果。'
      }
      job.child.stdout.on('data', read)
      job.child.stderr.on('data', read)
      job.child.once('error', () => finish(job, 'error', '无法启动登录程序，请检查 CLI 是否已安装以及程序路径是否正确。'))
      job.child.once('close', async (code) => {
        if (active !== job) return
        if (code !== 0) return finish(job, 'error', '登录未完成，可能是授权过期、网络失败或平台拒绝；请重新登录。')
        try {
          const connected = await verify()
          finish(job, connected ? 'success' : 'error', connected ? '登录成功，账号已连接。' : '授权已结束，但账号检查未通过。请检查网络后重新检查连接。')
        } catch { finish(job, 'error', '授权已结束，但连接检查失败，请重新检查连接。') }
      })
    } catch { finish(job, 'error', '找不到登录程序，请先安装 CLI 或检查已配置的程序路径。') }
  }
  const snapshot = () => {
    
    return { ...state }
  }
  return { start, cancel, snapshot }
}
