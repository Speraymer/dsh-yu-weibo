window.__ModuleLoader__.load({
  id: 'dsh-yu-weibo',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const API = '/api/weibo-duty'
    const request = async (path, body) => {
      const response = await fetch(API + path, body === undefined ? {} : {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      })
      const json = await response.json()
      if (!response.ok || json.ok === false) throw new Error(json.error || `HTTP ${response.status}`)
      return json
    }
    const css = `[data-social-page]{max-width:660px;display:flex;flex-direction:column;gap:12px;padding:4px}[data-social-page]>h3{margin:2px 0 0;font-size:20px}[data-social-page]>h4{margin:0;font-size:15px;font-weight:650}[data-social-page]>hr{width:100%;border:0;border-top:1px solid rgba(128,128,128,.24);margin:8px 0 2px}
[data-social-row]{display:flex;gap:10px;align-items:center;flex-wrap:wrap}[data-social-grow]{flex:1;min-width:220px}
[data-social-input]{box-sizing:border-box;width:100%;padding:8px 10px;border:1px solid rgba(128,128,128,.35);border-radius:8px;background:transparent;color:inherit}
[data-social-btn]{padding:8px 12px;border:1px solid rgba(128,128,128,.35);border-radius:8px;background:rgba(128,128,128,.12);color:inherit;cursor:pointer}[data-social-btn]:disabled{opacity:.5;cursor:not-allowed}[data-social-btn]:focus-visible,[data-social-input]:focus-visible{outline:2px solid currentColor;outline-offset:2px}
[data-social-note]{font-size:12px;line-height:1.6;color:var(--dsw-alias-label-tertiary,#888);white-space:pre-wrap;word-break:break-word}
[data-social-report]{max-height:260px;overflow:auto;padding:10px;border-radius:8px;background:rgba(128,128,128,.1);white-space:pre-wrap;font-size:12px}`

    function Panel() {
      const [state, setState] = React.useState(null)
      const [message, setMessage] = React.useState('')
      const [report, setReport] = React.useState('')
      const [login, setLogin] = React.useState({ status: 'idle' })
      const [loginBusy, setLoginBusy] = React.useState(false)
      const load = React.useCallback(async () => {
        try { setState(await request('/status')); setMessage('') } catch (error) { setMessage(error.message) }
      }, [])
      React.useEffect(() => { load() }, [load])
      React.useEffect(() => {
        let stopped = false, timer
        const poll = async () => {
          try {
            const result = await request('/login')
            if (stopped) return
            setLogin(result.login)
            if (result.login.status === 'running') timer = setTimeout(poll, 1500)
            else if (result.login.status === 'success') await load()
          } catch (error) { if (!stopped) setMessage(error.message) }
        }
        poll()
        return () => { stopped = true; clearTimeout(timer) }
      }, [login.status, load])
      const beginLogin = async (cancel = false) => {
        setLoginBusy(true)
        try { const result = await request('/login', { cancel }); setLogin(result.login) }
        catch (error) { setMessage(error.message) }
        finally { setLoginBusy(false) }
      }
      if (!state) return h('div', { 'data-social-note': '' }, message || '正在读取…')
      const cfg = state.config
      const save = async (patch) => {
        try { await request('/config', patch); await load(); setMessage('已保存') } catch (error) { setMessage(error.message) }
      }
      const run = async () => {
        try { setMessage('正在读取微博…'); const result = await request('/run', {}); setMessage(`完成：读取 ${result.read}，新增 ${result.added}`); await load() }
        catch (error) { setMessage(error.message) }
      }
      const post = async () => {
        try { setMessage('大肥鱼正在想主题并写微博…'); const result = await request('/post', {}); setMessage(result.summary || '已提交，请到微博核对实际展示状态。'); await load() }
        catch (error) { setMessage(error.message) }
      }
      const windowText = Object.values(state.windows || {}).map((w) => `${w.label} ${w.start}–${w.end}`).join('；')
      return h('div', { 'data-social-page': '' },
        h('h3', null, '刷微博'),
        h('div', { 'data-social-note': '' }, '通过微博官方 weibo-cli 刷已登录账号的好友时间线；填写关键词后改为搜索。普通微博始终只是素材；只有已登录账号自己发布且以 /dsh 开头的微博可进入下方目标会话。'),

        h('section', { 'aria-label': '微博账号登录' },
          h('h4', null, '账号登录'),
          h('div', { 'data-social-note': '' }, state.provider.loggedIn ? '账号已连接。需要换账号时可重新登录。' : '点击下方按钮获取授权链接，在微博授权页输入验证码并确认。'),
          h('div', { 'data-social-row': '' },
            h('button', { 'data-social-btn': '', disabled: loginBusy || login.status === 'running', onClick: () => beginLogin() }, login.status === 'running' ? '等待登录…' : state.provider.loggedIn ? '重新登录' : '登录微博'),
            login.status === 'running' ? h('button', { 'data-social-btn': '', disabled: loginBusy, onClick: () => beginLogin(true) }, '取消登录') : null,
            h('button', { 'data-social-btn': '', onClick: load }, '检查连接')),
          h('div', { 'data-social-note': '', role: 'status', 'aria-live': 'polite' }, login.message || ''),
          login.url ? h('a', { href: login.url, target: '_blank', rel: 'noopener noreferrer' }, '打开微博授权页') : null,
          login.code ? h('div', null, '验证码：', h('code', { style: { fontSize: 20, userSelect: 'all' } }, login.code)) : null),
        h('label', { 'data-social-row': '' }, h('input', { type: 'checkbox', checked: cfg.enabled, onChange: (e) => save({ enabled: e.target.checked }) }), '启用人格素材源'),
        h('hr'), h('h4', null, '谷时自动刷'),
        h('label', { 'data-social-row': '' }, h('input', { type: 'checkbox', checked: cfg.peakValley, onChange: (e) => save({ peakValley: e.target.checked }) }), '在谷时自动刷'),
        h('div', { 'data-social-row': '' },
          h('label', null, h('input', { type: 'checkbox', checked: cfg.noon, onChange: (e) => save({ noon: e.target.checked }) }), ' 中午'),
          h('label', null, h('input', { type: 'checkbox', checked: cfg.night, onChange: (e) => save({ night: e.target.checked }) }), ' 晚上 / 夜间'),
          h('label', null, '每天最多 ', h('input', { 'data-social-input': '', type: 'number', min: 0, max: 80, value: cfg.perDay, onChange: (e) => save({ perDay: Number(e.target.value) }) }), ' 条')),
        h('div', { 'data-social-note': '' }, `${windowText}\n今天自动读取 ${cfg.readToday || 0}/${cfg.perDay || 0} 条；填 0 不自动刷，手动按钮仍可用。`),
        h('label', null, '关键词（留空刷好友时间线）', h('input', { 'data-social-input': '', value: cfg.keywords, placeholder: '例如：AI 产品设计', onChange: (e) => setState({ ...state, config: { ...cfg, keywords: e.target.value } }), onBlur: (e) => save({ keywords: e.target.value }) })),
        h('hr'), h('h4', null, '主动发文'),
        h('div', { 'data-social-note': '' }, '不填题目、不贴草稿。大肥鱼按当前人格自己决定主题；每天最多尝试一条，提交前先记账，结果不明确时不重试。'),
        h('button', { 'data-social-btn': '', disabled: state.posting || !state.provider.loggedIn, onClick: post }, state.posting ? '正在想主题…' : '让大肥鱼自己想主题并发一条'),
        h('hr'), h('h4', null, '账号与指令安全'),
        h('label', { 'data-social-row': '' }, h('input', { type: 'checkbox', checked: cfg.trustedCommands, onChange: (e) => save({ trustedCommands: e.target.checked }) }), '允许本人微博发布 /dsh 指令'),
        h('label', null, '指令目标会话 ID', h('input', { 'data-social-input': '', value: cfg.commandSession || '', placeholder: 'session-…', onChange: (e) => setState({ ...state, config: { ...cfg, commandSession: e.target.value } }), onBlur: (e) => save({ commandSession: e.target.value }) })),
        h('div', { 'data-social-note': '' }, '硬校验已登录账号的 UID，并按微博 ID 只投递一次。昵称和别人复制 /dsh 都无效；未登录或不填目标会话时保持关闭。'),
        h('div', { 'data-social-note': '' }, state.provider.loggedIn
          ? `微博账号已连接${state.provider.account ? `：${state.provider.account}` : ''}`
          : `微博账号未连接，请使用上方“登录微博”按钮\n${state.provider.error || ''}`),
        h('div', { 'data-social-row': '' },
          h('button', { 'data-social-btn': '', onClick: run, disabled: state.running || !state.provider.loggedIn }, state.running ? '正在刷…' : '现在刷一轮'),
          h('button', { 'data-social-btn': '', onClick: load }, '重新检查登录'),
          h('button', { 'data-social-btn': '', onClick: async () => { const value = await request('/report'); setReport(report ? '' : value.text) } }, report ? '收起报告' : '看今天报告')),
        message ? h('div', { 'data-social-note': '' }, message) : null,
        h('div', { 'data-social-note': '' }, `人格接口：${state.personaSource}\n最近结果：${state.lastResult || '还没运行'}`),
        report ? h('pre', { 'data-social-report': '' }, report) : null,
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style)
        ctx.effect(() => () => style.remove(), 'dsh-weibo-scroll styles')
        const slots = ctx.get?.('slots') || ctx.slots
        if (slots) slots.inject('settings.section', () => slots.register(
          { name: 'settings.section', id: 'weibo-scroll', order: 32, label: '刷微博' }, () => h(Panel),
        ))
      },
    }
  },
})
