import test from 'node:test'
import assert from 'node:assert/strict'
import { readModeOf, executeWeiboAction, publishWeibo, READ_ONLY_ERROR } from '../lib/provider.mjs'
import { cleanHtml, toItem } from '../lib/web.mjs'

test('web read mode is the default and cli stays opt-in', () => {
  assert.equal(readModeOf({}), 'web')
  assert.equal(readModeOf({ readMode: 'web' }), 'web')
  assert.equal(readModeOf({ readMode: 'cli' }), 'cli')
  assert.equal(readModeOf({ readMode: 'nonsense' }), 'web')
})

test('write paths are refused in web mode without touching the platform', async () => {
  await assert.rejects(() => executeWeiboAction({ kind: 'like', targetId: '1234567890' }, {}), (error) => {
    assert.equal(error.message, READ_ONLY_ERROR)
    return true
  })
  await assert.rejects(() => publishWeibo('随便说点什么', { readMode: 'web' }), (error) => {
    assert.equal(error.message, READ_ONLY_ERROR)
    return true
  })
})

test('mblog becomes the same material shape the rest of the plugin expects', () => {
  const item = toItem({
    id: '5357279735973710',
    text: '今天风好大<br />出门被吹成<img alt="[笑]" /> <a href="https://m.weibo.cn/detail/x">链接</a>',
    user: { id: 7952914206, screen_name: '测试号' },
  })
  assert.equal(item.remoteId, '5357279735973710')
  assert.equal(item.author, '测试号')
  assert.equal(item.authorId, '7952914206')
  assert.equal(item.url, 'https://m.weibo.cn/detail/5357279735973710')
  assert.match(item.text, /今天风好大/)
  assert.equal(item.text.includes('<br'), false)
  assert.equal(item.id.length, 24)
  assert.equal(toItem({ id: '', text: 'x' }), null)
})

test('html cleaning keeps words and drops markup', () => {
  assert.equal(cleanHtml('a &amp; b'), 'a & b')
  assert.equal(cleanHtml('<span>粗</span>体'), '粗体')
  assert.equal(cleanHtml('line1<br>line2'), 'line1\nline2')
})
