import { readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const file = join(homedir(), '.dsh', 'weibo-duty', 'config.json')
const cfg = JSON.parse(readFileSync(file, 'utf8'))
const next = {
  ...cfg,
  enabled: true,
  readMode: 'web', readOnly: true, readOnlyV1: true,
  autoLike: false, autoComment: false, autoReply: false, autoRepost: false, autoPost: false,
  likePerRound: 0, commentPerRound: 0, replyPerRound: 0, repostPerRound: 0, commentFetch: 0,
  trustedCommands: false,
  peakValley: true, noon: true, night: true, perDay: 10,
  lastResult: '已切换成只读（网页版访客）：不登录，不写，只读公开内容',
}
const tmp = file + '.tmp'
writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8')
renameSync(tmp, file)
console.log(JSON.stringify({ enabled: next.enabled, readMode: next.readMode, readOnly: next.readOnly, peakValley: next.peakValley, perDay: next.perDay }, null, 2))
