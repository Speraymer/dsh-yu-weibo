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
      const load = React.useCallback(async () => {
        try { setState(await request('/status')); setMessage('') } catch (error) { setMessage(error.message) }
      }, [])
      React.useEffect(() => { load() }, [load])
      if (!state) return h('div', { 'data-social-note': '' }, message || '正在读取…')
      const cfg = state.config
      const provider = state.provider || {}
      const save = async (patch) => {
        try { await request('/config', patch); await load(); setMessage('已保存') } catch (error) { setMessage(error.message) }
      }
      const run = async () => {
        try { setMessage('正在读微博（要开一下 Edge，几秒）…'); const result = await request('/run', {}); setMessage(`完成：读取 ${result.read}，新增 ${result.added}`); await load() }
        catch (error) { setMessage(error.message); await load() }
      }
      const windowText = Object.values(state.windows || {}).map((w) => `${w.label} ${w.start}–${w.end}`).join('；')
      return h('div', { 'data-social-page': '' },
        h('h3', null, '刷微博（只读）'),
        h('div', { 'data-social-note': '' }, '走微博网页版 m.weibo.cn 的公开接口，以访客身份读时间线 / 搜索 / 热搜。只在页面里发 GET：不点赞、不评论、不转发、不发博，也不需要登录，账号上零痕迹。普通微博始终只是素材。'),
        h('div', { 'data-social-note': '' }, '关于推荐算法：访客拿到的推荐流就是热门榜（接口响应里 statistics_from=hotweibo），不是"你关注的人"；只有登录账号，推荐流才会按那个号的画像走。本插件故意不登录——所以它读的是"全站此刻最热的"，不是"你平时刷到的"。'),

        h('label', { 'data-social-row': '' }, h('input', { type: 'checkbox', checked: cfg.enabled, onChange: (e) => save({ enabled: e.target.checked }) }), '启用人格素材源'),
        h('hr'), h('h4', null, '谷时自动刷'),
        h('label', { 'data-social-row': '' }, h('input', { type: 'checkbox', checked: cfg.peakValley, onChange: (e) => save({ peakValley: e.target.checked }) }), '在谷时自动刷'),
        h('div', { 'data-social-row': '' },
          h('label', null, h('input', { type: 'checkbox', checked: cfg.noon, onChange: (e) => save({ noon: e.target.checked }) }), ' 中午'),
          h('label', null, h('input', { type: 'checkbox', checked: cfg.night, onChange: (e) => save({ night: e.target.checked }) }), ' 晚上 / 夜间'),
          h('label', null, '每天最多 ', h('input', { 'data-social-input': '', type: 'number', min: 0, max: 80, value: cfg.perDay, onChange: (e) => save({ perDay: Number(e.target.value) }) }), ' 条')),
        h('div', { 'data-social-note': '' }, `${windowText}\n今天自动读取 ${cfg.readToday || 0}/${cfg.perDay || 0} 条；填 0 不自动刷，手动按钮仍可用。`),
        h('label', null, '关键词（留空 = 推荐流 + 热门流；填了就改成搜这个词）', h('input', { 'data-social-input': '', value: cfg.keywords, placeholder: '例如：AI 产品设计', onChange: (e) => setState({ ...state, config: { ...cfg, keywords: e.target.value } }), onBlur: (e) => save({ keywords: e.target.value }) })),
        h('div', { 'data-social-note': '' }, '读取时会起一个本机 Edge 窗口放在屏幕外（不用 headless——headless 的 UA 微博一眼认出来），读完自己关掉。所以机器得醒着，Edge 得装着。'),
        h('hr'), h('h4', null, '状态'),
        h('div', { 'data-social-note': '' }, provider.error
          ? `读不到：${provider.error}`
          : `引擎：${provider.engine || 'm.weibo.cn 访客'}${provider.note ? ` · ${provider.note}` : ''} · 只读`),
        h('div', { 'data-social-row': '' },
          h('button', { 'data-social-btn': '', onClick: run, disabled: state.running }, state.running ? '正在刷…' : '现在刷一轮'),
          h('button', { 'data-social-btn': '', onClick: load }, '重新检查'),
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
