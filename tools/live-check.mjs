import { fetchGuestItems, probeGuest } from '../lib/web.mjs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const root = join(homedir(), '.dsh', 'weibo-duty')
const probe = await probeGuest(root)
console.log('probe:', probe)
const { items, info } = await fetchGuestItems(root, { limit: 5 })
console.log('info:', info)
console.log('items:', items.length)
for (const it of items) console.log('-', it.author, '|', it.text.slice(0, 50).replace(/\n/g, ' '), '|', it.url)
process.exit(0)
