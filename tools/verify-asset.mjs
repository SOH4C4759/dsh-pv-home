// What the shipped assets must be, read out of the bytes rather than trusted
// from a note.
//
// The film is the feature; everything here is a way for it to be absent or
// unusable while the plugin still reports success. A missing file degrades to
// "no injection" (visible as DSH's own boot page, which a user reads as "the
// plugin is broken"); a `moov` at the end of the file degrades to a long black
// screen on every launch; a track-less file degrades to a silent film with no
// way to tell whether the volume button works.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const FILM = join(ROOT, 'assets', 'video', 'film.mp4')
const FONT = join(ROOT, 'assets', 'fonts', 'SpaceMono-Bold.ttf')
const OFL = join(ROOT, 'assets', 'fonts', 'OFL_spacemono.txt')
const SOURCE = join(ROOT, 'assets', 'video', 'film.source.json')

let failures = 0
let checks = 0

function check(name, condition, detail) {
  checks++
  if (condition) {
    console.log('  ok   ' + name)
    return true
  }
  failures++
  console.log('  FAIL ' + name + (detail === undefined ? '' : ' — ' + detail))
  return false
}

/** The top-level box chain: `[type, offset, size]` in file order. */
function boxChain(buffer, end = buffer.length, start = 0) {
  const boxes = []
  let offset = start
  while (offset + 8 <= end) {
    const size = buffer.readUInt32BE(offset)
    const type = buffer.toString('latin1', offset + 4, offset + 8)
    if (size < 8 || offset + size > end) break
    boxes.push({ type, offset, size })
    offset += size
  }
  return boxes
}

/**
 * `{ timescale, durationSeconds }` from the movie header.
 *
 * Reads through the WHOLE file buffer, not the moov slice: a box's `offset` is
 * absolute, so indexing the slice with it reads plausible-looking bytes from the
 * wrong place — a failure that returns a number rather than throwing.
 */
function readMovieHeader(film, moov) {
  const header = moov.boxes.find((box) => box.type === 'mvhd')
  if (header === undefined) return null
  const base = header.offset
  const version = film.readUInt8(base + 8)
  const after = base + 12 + (version === 1 ? 16 : 8)
  const timescale = film.readUInt32BE(after)
  const duration = version === 1
    ? Number(film.readBigUInt64BE(after + 4))
    : film.readUInt32BE(after + 4)
  if (timescale === 0) return null
  return { timescale, durationSeconds: duration / timescale }
}

console.log('影片')
check('assets/video/film.mp4 存在', existsSync(FILM))
const film = readFileSync(FILM)
const filmSize = statSync(FILM).size
check('影片不是空文件', filmSize > 1024 * 1024, String(filmSize) + ' bytes')

const top = boxChain(film)
const order = top.map((box) => box.type)
check('顶层盒顺序是 ftyp → moov → … → mdat',
  order[0] === 'ftyp' && order.indexOf('moov') > 0 && order.indexOf('moov') < order.indexOf('mdat'),
  JSON.stringify(order))
check('moov 在文件前 1 MiB 内（首帧不需要整片下载）',
  top.find((box) => box.type === 'moov').offset < 1024 * 1024,
  String(top.find((box) => box.type === 'moov').offset) + ' bytes in')
check('存在媒体数据盒 mdat', order.includes('mdat'), JSON.stringify(order))

const moovBox = top.find((box) => box.type === 'moov')
const moovBuffer = film.subarray(moovBox.offset, moovBox.offset + moovBox.size)
const moov = { buffer: moovBuffer, boxes: boxChain(film, moovBox.offset + moovBox.size, moovBox.offset + 8) }
check('moov 里有 trak（轨道表）', moov.boxes.some((box) => box.type === 'trak'),
  JSON.stringify(moov.boxes.map((box) => box.type)))

const moovTypes = []
for (const box of moov.boxes) {
  if (box.type !== 'trak') continue
  const trak = film.subarray(box.offset, box.offset + box.size)
  for (const codec of ['avc1', 'mp4a']) if (trak.includes(Buffer.from(codec, 'latin1'))) moovTypes.push(codec)
}
check('有 H.264 视频轨（avc1）', moovTypes.includes('avc1'), JSON.stringify(moovTypes))
check('有 AAC 音频轨（mp4a）——音量按钮才有东西可调', moovTypes.includes('mp4a'), JSON.stringify(moovTypes))

const header = readMovieHeader(film, moov)
check('读得到片长', header !== null && header.durationSeconds > 10,
  header === null ? 'no mvhd' : header.durationSeconds.toFixed(2) + 's')
check('片长在合理区间（短于 30 分钟）',
  header !== null && header.durationSeconds < 1800,
  header === null ? '' : header.durationSeconds.toFixed(2) + 's')

console.log('\n字体与许可')
check('Space Mono Bold 存在（按钮标题用的是影片同一支字体）', existsSync(FONT))
const font = readFileSync(FONT)
check('是 TrueType 轮廓', font.readUInt32BE(0) === 0x00010000, '0x' + font.readUInt32BE(0).toString(16))
check('随附 SIL OFL 许可全文', existsSync(OFL) && readFileSync(OFL, 'utf8').includes('SIL OPEN FONT LICENSE'),
  String(existsSync(OFL)))

console.log('\n出处与署名')
check('保存了影片出处记录', existsSync(SOURCE))
const source = JSON.parse(readFileSync(SOURCE, 'utf8'))
check('记录了 B 站地址', String(source.webpage_url).includes('BV1xCai6aE9g'), String(source.webpage_url))
check('记录了上传者', typeof source.uploader === 'string' && source.uploader.length > 0, String(source.uploader))
check('记录了抓取时间', typeof source.fetched_at === 'string' && source.fetched_at.length > 0, String(source.fetched_at))
check('出处说明里写明美术按 CC BY-NC-SA 分享', String(source.description).includes('CC BY-NC-SA'),
  String(source.description).slice(0, 80))
check('出处说明里写明音乐权利人', String(source.description).includes('Mili'),
  String(source.description).slice(0, 80))

const notice = join(ROOT, 'NOTICE.md')
check('NOTICE.md 存在', existsSync(notice))
if (existsSync(notice)) {
  const text = readFileSync(notice, 'utf8')
  for (const name of ['上善无形', 'ZipZipPipe', 'dsh-deep-whale', 'dsh-whale-galgame', 'Mili', 'BV1xCai6aE9g']) {
    check('NOTICE.md 保留了署名链：' + name, text.includes(name))
  }
  check('NOTICE.md 写明非商用', text.includes('非商用') || text.includes('不得商用'))
}

console.log('\n仓库卫生')
{
  const video = readdirSync(join(ROOT, 'assets', 'video'))
  check('assets/video 只有影片与出处记录', video.every((name) => name === 'film.mp4' || name === 'film.source.json'),
    JSON.stringify(video))
  const stray = readdirSync(ROOT).filter((name) => name.endsWith('.mph') || name.endsWith('.info.json') || name.endsWith('-parked'))
  check('没有留下临时或抓取中间产物', stray.length === 0, JSON.stringify(stray))
  check('lib/client.js 已构建', existsSync(join(ROOT, 'lib', 'client.js')))
  check('node_modules 里链着 schemastery（否则 Host 半侧求值即失败）',
    existsSync(join(ROOT, 'node_modules', '@deepseek-ai', 'schemastery', 'package.json')))
}

console.log('\n' + (failures === 0 ? 'verify-asset: PASS' : 'verify-asset: FAIL')
  + ' (' + String(checks - failures) + '/' + String(checks) + ')')
process.exit(failures === 0 ? 0 : 1)
