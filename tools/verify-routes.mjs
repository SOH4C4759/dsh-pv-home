// What the film routes must answer, over real HTTP against the real handlers.
//
// A player feeds itself with overlapping range requests, and the failure modes
// here are silent ones: a 200 answered where a 206 was asked for still plays,
// just by re-downloading the whole film every time the element seeks; a suffix
// range answered wrongly seeks to the wrong place; and a response that may be
// cached turns a request aborted mid-flight (which is exactly what dismissing
// the home page does) into a truncated cache entry that decodes to nothing on
// the next reload. Structure has to be asserted, not eyeballed.
import { createServer, request as httpRequest } from 'node:http'
import { readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const ROUTE = '/plugins/dsh-pv-home'
const FILM = join(ROOT, 'assets', 'video', 'film.mp4')
const FONT = join(ROOT, 'assets', 'fonts', 'SpaceMono-Bold.ttf')

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

const mod = await import('../entry.js')

/** Register the plugin's routes into a plain HTTP server, longest prefix first. */
function collectRoutes() {
  const routes = []
  const ctx = {
    webServer: { register: (spec) => { routes.push(spec); return () => {} } },
    effect: (fn) => { fn(); return () => {} },
    on: () => () => {},
    logger: { warn: () => {}, error: () => {} },
  }
  mod.apply(ctx, {})
  return routes
}

const routes = collectRoutes()

const server = createServer((req, res) => {
  const pathname = decodeURIComponent((req.url ?? '/').split('?')[0])
  const exact = routes.find((route) => route.kind === 'exact' && route.path === pathname)
  if (exact !== undefined) {
    exact.handler(req, res)
    return
  }
  const prefix = routes
    .filter((route) => route.kind === 'prefix' && pathname.startsWith(route.path))
    .sort((left, right) => right.path.length - left.path.length)[0]
  if (prefix !== undefined) {
    prefix.handler(req, res)
    return
  }
  res.writeHead(404, { 'content-type': 'text/plain', 'x-verify-router': 'no-match' })
  res.end('no route')
})

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const origin = 'http://127.0.0.1:' + String(server.address().port)

/** One raw request, returning status, headers and the body as bytes. */
function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, origin)
    const call = httpRequest({
      host: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: options.method ?? 'GET',
      headers: options.headers ?? {},
    }, (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks),
      }))
    })
    call.on('error', reject)
    call.end()
  })
}

const film = readFileSync(FILM)
const filmSize = statSync(FILM).size

console.log('清单')
{
  const res = await request(ROUTE + '/film.json')
  check('清单 200', res.status === 200, String(res.status))
  check('清单是 JSON', String(res.headers['content-type']).startsWith('application/json'), res.headers['content-type'])
  check('清单不可缓存', res.headers['cache-control'] === 'no-store', res.headers['cache-control'])
  const body = JSON.parse(res.body.toString('utf8'))
  check('清单报告影片名', body.film?.name === 'film.mp4', JSON.stringify(body.film))
  check('清单报告字节数与磁盘一致', body.film?.bytes === filmSize, String(body.film?.bytes) + ' vs ' + String(filmSize))
  check('清单报告 moov 前置（faststart）', body.film?.faststart === true, String(body.film?.faststart))
  check('清单报告恢复点键名', body.sessionSelectionKey === 'dsh.sessions.current', String(body.sessionSelectionKey))
  check('清单里的 src 带版本号', /\/plugins\/dsh-pv-home\/clip\/film\.mp4\?v=\d+-\d+$/.test(String(body.film?.src)), String(body.film?.src))
}

console.log('\n整片')
{
  const res = await request(ROUTE + '/clip/film.mp4')
  check('整片 200', res.status === 200, String(res.status))
  check('声明接受 Range', res.headers['accept-ranges'] === 'bytes', String(res.headers['accept-ranges']))
  check('整片也不可缓存（被中断的响应绝不能留下缓存条目）',
    res.headers['cache-control'] === 'no-store', String(res.headers['cache-control']))
  check('content-length 与磁盘一致', Number(res.headers['content-length']) === filmSize, String(res.headers['content-length']))
  check('体长与磁盘一致', res.body.length === filmSize, String(res.body.length))
  check('首字节是 ftyp（是一个 MP4）', res.body.toString('latin1', 4, 8) === 'ftyp', res.body.toString('latin1', 4, 8))
  check('末字节与磁盘一致', res.body.subarray(filmSize - 32).equals(film.subarray(filmSize - 32)))
  check('content-type 是 video/mp4', res.headers['content-type'] === 'video/mp4', res.headers['content-type'])
}

console.log('\nRange')
{
  const res = await request(ROUTE + '/clip/film.mp4', { headers: { range: 'bytes=0-99' } })
  check('0-99 回 206', res.status === 206, String(res.status))
  check('0-99 content-range 正确', res.headers['content-range'] === 'bytes 0-99/' + String(filmSize), String(res.headers['content-range']))
  check('0-99 体长 100', res.body.length === 100, String(res.body.length))
  check('0-99 逐字节一致', res.body.equals(film.subarray(0, 100)))
  check('切片响应不可缓存', res.headers['cache-control'] === 'no-store', String(res.headers['cache-control']))
}
{
  const res = await request(ROUTE + '/clip/film.mp4', { headers: { range: 'bytes=1048576-1048675' } })
  check('中段 range 逐字节一致', res.status === 206 && res.body.equals(film.subarray(1048576, 1048676)),
    String(res.status) + ' len ' + String(res.body.length))
}
{
  const res = await request(ROUTE + '/clip/film.mp4', { headers: { range: 'bytes=-100' } })
  check('后缀 range 回 206', res.status === 206, String(res.status))
  check('后缀 range 是最后 100 字节', res.body.equals(film.subarray(filmSize - 100)),
    String(res.headers['content-range']))
}
{
  const res = await request(ROUTE + '/clip/film.mp4', { headers: { range: 'bytes=' + String(filmSize + 10) + '-' } })
  check('越界 range 回 416', res.status === 416, String(res.status))
  check('416 带 content-range 星号形式', res.headers['content-range'] === 'bytes */' + String(filmSize), String(res.headers['content-range']))
}
{
  const res = await request(ROUTE + '/clip/film.mp4', { method: 'HEAD' })
  check('HEAD 200 且不带体', res.status === 200 && res.body.length === 0, String(res.status) + ' len ' + String(res.body.length))
  check('HEAD 仍报 content-length', Number(res.headers['content-length']) === filmSize, String(res.headers['content-length']))
}

console.log('\n边界与遮蔽')
{
  const res = await request(ROUTE + '/clip/other.mp4')
  check('别的片名回 404', res.status === 404, String(res.status))
}
{
  const res = await request(ROUTE + '/clip/..%2F..%2Fpackage.json')
  check('目录穿越回 404', res.status === 404, String(res.status))
}
{
  const res = await request(ROUTE + '/clip/film.mp4.bak')
  check('伪造扩展名回 404', res.status === 404, String(res.status))
}
{
  // The trap: if any prefix route sat on ROUTE itself, this request — this
  // package's own browser bundle, served by client-modules — would be answered
  // here with a 404 and the settings card would never register.
  const res = await request(ROUTE + '/client.js')
  check('本包 client.js 不被自己的路由截胡', res.headers['x-verify-router'] === 'no-match',
    String(res.status) + ' ' + String(res.headers['x-verify-router']))
}

console.log('\n字体')
{
  const res = await request(ROUTE + '/font/SpaceMono-Bold.ttf')
  const font = readFileSync(FONT)
  check('字体 200 且逐字节一致', res.status === 200 && res.body.equals(font),
    String(res.status) + ' len ' + String(res.body.length))
  check('字体 content-type 正确', res.headers['content-type'] === 'font/ttf', String(res.headers['content-type']))
  check('是 TrueType 轮廓（首四字节 0x00010000）', font.readUInt32BE(0) === 0x00010000, '0x' + font.readUInt32BE(0).toString(16))
}

server.close()

console.log('\n' + (failures === 0 ? 'verify-routes: PASS' : 'verify-routes: FAIL')
  + ' (' + String(checks - failures) + '/' + String(checks) + ')')
process.exit(failures === 0 ? 0 : 1)
