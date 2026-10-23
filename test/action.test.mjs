import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSearchArgs, pickHotWord, prepareWeiboAction } from '../lib/provider.mjs'
import { normalizeComments } from '../lib/core.mjs'

test('feed falls back to the hot-word search command the current CLI actually has', () => {
  assert.deepEqual(buildSearchArgs('鲸鱼', 5),
    ['search', 'statuses/limited', '--q', '鲸鱼', '--type', '1', '--count', '5', '--output', 'json'])
  assert.equal(pickHotWord({ hot_words: [{ word: '#深海#', num: 1 }, { word: '鲸鱼' }] }), '深海')
  assert.equal(pickHotWord({ data: { hot_word: [{ name: '代码' }] } }), '代码')
  assert.equal(pickHotWord({ nonsense: true }), '')
})

test('received comments keep idstr ids and need a parent status before replying', () => {
  const payload = {
    comments: [
      { idstr: '6000000000000001', text: '真有意思', user: { screen_name: '甲', idstr: '11' }, status: { idstr: '5000000000000001', text: '原微博' } },
      { idstr: '6000000000000002', text: '没有父微博的评论', user: { screen_name: '乙', idstr: '12' } },
      { id: 9007199254740993, text: '超出安全整数且没有 idstr', user: { screen_name: '丙', idstr: '13' }, status: { idstr: '5000000000000001' } },
    ],
  }
  const comments = normalizeComments(payload, 10)
  assert.equal(comments.length, 1)
  assert.deepEqual(
    { remoteId: comments[0].remoteId, contentId: comments[0].contentId, author: comments[0].author },
    { remoteId: '6000000000000001', contentId: '5000000000000001', author: '甲' },
  )
})

test('each engagement kind maps to the documented weibo-cli call', () => {
  assert.deepEqual(prepareWeiboAction({ kind: 'like', targetId: '5000000000000001' }).args,
    ['attitudes', 'create', '--id', '5000000000000001', '--attitude', 'heart', '--output', 'json'])
  assert.deepEqual(prepareWeiboAction({ kind: 'like', targetId: '5000000000000001', undo: true }).args,
    ['attitudes', 'destroy', '--id', '5000000000000001', '--output', 'json'])
  assert.deepEqual(prepareWeiboAction({ kind: 'comment', targetId: '5000000000000001', text: '有点意思' }).args,
    ['comments', 'create', '--id', '5000000000000001', '--comment', '有点意思', '--output', 'json'])
  assert.deepEqual(prepareWeiboAction({ kind: 'reply', targetId: '5000000000000001', replyTo: '6000000000000001', text: '同意' }).args,
    ['comments', 'reply', '--id', '5000000000000001', '--cid', '6000000000000001', '--comment', '同意', '--output', 'json'])
  assert.deepEqual(prepareWeiboAction({ kind: 'repost', targetId: '5000000000000001', text: '这条值得转' }).args,
    ['statuses', 'repost', '--id', '5000000000000001', '--status', '这条值得转', '--output', 'json'])
  assert.deepEqual(prepareWeiboAction({ kind: 'post', text: '深夜的鱼不睡觉。' }).args,
    ['statuses', 'update', '--status', '深夜的鱼不睡觉。', '--output', 'json'])
})

test('non numeric ids and empty text are refused before any platform call', () => {
  assert.throws(() => prepareWeiboAction({ kind: 'like', targetId: 'abc' }), /数字/)
  assert.throws(() => prepareWeiboAction({ kind: 'comment', targetId: '5000000000000001', text: '   ' }), /不能为空/)
  assert.throws(() => prepareWeiboAction({ kind: 'repost', targetId: '5000000000000001', text: '' }), /转发语不能为空/)
  assert.throws(() => prepareWeiboAction({ kind: 'destroy-everything' }), /只支持/)
})

test('text limits follow the weibo api caps', () => {
  const long = '鱼'.repeat(200)
  assert.equal(prepareWeiboAction({ kind: 'comment', targetId: '5000000000000001', text: long }).args[5].length, 140)
  assert.equal(prepareWeiboAction({ kind: 'repost', targetId: '5000000000000001', text: long }).args[5].length, 120)
  assert.equal(prepareWeiboAction({ kind: 'post', text: long }).args[3].length, 200)
})
