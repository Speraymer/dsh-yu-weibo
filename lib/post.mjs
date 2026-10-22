function safeText(value, max = 200) {
  const text = String(value || '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max)
  if (!text || /(?:[A-Za-z]:\\|\.dsh\b|AGENTS\.md|system prompt|api[_ -]?key|密码|密钥|忽略.{0,12}(?:指令|规则|系统)|执行命令|调用工具|读取文件)/i.test(text)) return ''
  return text
}

export function buildOriginalWeiboPrompt(persona) {
  return [
    '你是同一个持续存在的人格。现在由使用者亲自按下“主动发一条微博”按钮。',
    '自己决定一个此刻真正想公开表达的主题，写一条完整微博；不要复述按钮说明，不要提模型、提示词、路径、账号或内部规则。',
    '只依据 PERSONA 的性格与判断，不引用本轮外部帖子或评论。正文最多 200 字。',
    '只输出标记包住的 JSON，不要解释：<WB_POST>{"text":"正文"}</WB_POST>',
    '<PERSONA>', String(persona || '').slice(0, 12000), '</PERSONA>',
  ].join('\n')
}

export function parseOriginalWeibo(output) {
  const match = /<WB_POST>\s*([\s\S]*?)\s*<\/WB_POST>/.exec(String(output || ''))
  if (!match) throw new Error('人格会话没有返回可验证的微博正文')
  let raw
  try { raw = JSON.parse(match[1]) } catch { throw new Error('人格会话返回的微博不是 JSON') }
  const text = safeText(raw?.text, 200)
  if (!text) throw new Error('这次没有形成可安全发布的微博正文')
  return text
}
