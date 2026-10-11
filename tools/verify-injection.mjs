// What the Host half must contribute, run against a fake Cordis context.
//
// The two properties that decide whether this plugin works at all are both
// invisible at runtime when they are wrong: the head rows must exist, and they
// must exist in an order that puts the config global before the script that
// reads it. A missing row degrades to "DSH opens its normal page", which is
// exactly what a user would call "the plugin does nothing" with no error to read.
import { readFileSync, renameSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const ROUTE = '/plugins/dsh-pv-home'
const SESSION_KEY = 'dsh.sessions.current'

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

/** A Host context carrying only what this plugin touches. */
function makeHost() {
  const routes = []
  const listeners = []
  const warns = []
  const ctx = {
    webServer: {
      register(spec) {
        routes.push(spec)
        return () => {}
      },
    },
    effect(fn) {
      const dispose = fn()
      return () => { if (typeof dispose === 'function') dispose() }
    },
    on(event, callback) {
      if (event === 'webserver/index-inject') listeners.push(callback)
      return () => {}
    },
    logger: {
      warn: (...args) => warns.push(args),
      error: (...args) => warns.push(args),
    },
  }
  return { ctx, routes, listeners, warns }
}

/** Collect the injection table the way the web server does. */
function inject(listeners) {
  const table = []
  for (const listener of listeners) listener(table)
  return table
}

const mod = await import('../entry.js')

console.log('模块导出')
check('name 是包名（patch 行按它挂载）', mod.name === 'dsh-pv-home', mod.name)
check('inject 声明 webServer', Array.isArray(mod.inject) && mod.inject.includes('webServer'), JSON.stringify(mod.inject))
check('导出了 Config（设置命名空间靠它存在）', mod.Config !== undefined && mod.Config !== null)
{
  const fields = Object.keys(mod.Config?.dict ?? {})
  const expected = ['enabled', 'loop', 'startMuted', 'volume', 'showHint', 'resetSession', 'fadeMs', 'dim', 'matchCaption', 'fit']
  check('Config 声明了全部 10 个字段', expected.every((field) => fields.includes(field)), JSON.stringify(fields))
  const volatile = expected.filter((field) => mod.Config.dict[field]?.meta?.volatile === true)
  check('每个字段都标了 volatile（否则设置页整条隐藏）', volatile.length === expected.length,
    JSON.stringify(expected.filter((field) => mod.Config.dict[field]?.meta?.volatile !== true)))
}

console.log('\n注入行')
{
  const host = makeHost()
  mod.apply(host.ctx, {})
  const table = inject(host.listeners)
  check('恰好两行', table.length === 2, 'rows: ' + String(table.length))
  check('两行都在 head', table.every((row) => row.kind === 'script' && row.placement === 'head'),
    JSON.stringify(table.map((row) => [row.kind, row.placement])))
  const [configRow, scriptRow] = table
  check('第一行是配置全局（必须先于读它的脚本）',
    configRow !== undefined && configRow.text.startsWith('globalThis.__DSH_PV_HOME_CFG__='),
    configRow === undefined ? 'missing' : configRow.text.slice(0, 60))
  const cfg = JSON.parse(String(configRow.text).replace('globalThis.__DSH_PV_HOME_CFG__=', ''))
  check('配置里的影片 URL 带版本号（换片不会被旧缓存糊弄）',
    /\/plugins\/dsh-pv-home\/clip\/film\.mp4\?v=\d+-\d+$/.test(cfg.src), cfg.src)
  check('配置里带恢复点键名', cfg.sessionKey === SESSION_KEY, String(cfg.sessionKey))
  check('配置里带默认行为',
    cfg.loop === true && cfg.startMuted === true && cfg.resetSession === true && cfg.showHint === true,
    JSON.stringify(cfg))
  check('配置里报告 moov 前置（否则主页会先黑一会儿）', cfg.faststart === true, String(cfg.faststart))
  check('第二行是真实脚本源码（与 src/home-screen.js 逐字节一致）',
    scriptRow !== undefined && scriptRow.text === readFileSync(join(ROOT, 'src', 'home-screen.js'), 'utf8'),
    scriptRow === undefined ? 'missing' : 'length ' + String(scriptRow.text.length))
  check('脚本里含清理恢复点的那一句',
    scriptRow.text.includes('localStorage.removeItem(SESSION_KEY)'),
    'no removeItem call')
}

console.log('\n总开关')
{
  const host = makeHost()
  mod.apply(host.ctx, { enabled: false })
  const table = inject(host.listeners)
  check('关掉时一行都不注入（不是「注入了再自己退出」）', table.length === 0, 'rows: ' + String(table.length))
  check('关掉时仍然注册路由（设置卡还要读清单）', host.routes.length === 3, 'routes: ' + String(host.routes.length))
}

console.log('\n影片缺失时的兜底')
{
  const host = makeHost()
  mod.apply(host.ctx, {})
  const film = join(ROOT, 'assets', 'video', 'film.mp4')
  const parked = film + '.verify-parked'
  renameSync(film, parked)
  try {
    const table = inject(host.listeners)
    check('影片不在时不注入任何行（退回 DSH 原生启动页）', table.length === 0, 'rows: ' + String(table.length))
    check('并且留下一条可诊断的告警', host.warns.length >= 1, JSON.stringify(host.warns))
  } finally {
    renameSync(parked, film)
  }
  const restored = inject(host.listeners)
  check('影片放回后恢复注入', restored.length === 2, 'rows: ' + String(restored.length))
}

console.log('\n路由形态')
{
  const host = makeHost()
  mod.apply(host.ctx, {})
  const routes = host.routes
  const exact = routes.filter((route) => route.kind === 'exact').map((route) => route.path)
  const prefix = routes.filter((route) => route.kind === 'prefix').map((route) => route.path)
  check('清单是 exact 路由', exact.includes(ROUTE + '/film.json'), JSON.stringify(exact))
  check('字体是 exact 路由', exact.includes(ROUTE + '/font/SpaceMono-Bold.ttf'), JSON.stringify(exact))
  check('影片是 /clip 前缀路由', prefix.length === 1 && prefix[0] === ROUTE + '/clip', JSON.stringify(prefix))
  // The trap: a prefix on ROUTE itself also claims `<ROUTE>/client.js`, which is
  // where client-modules serves this package's own browser bundle. That request
  // would answer this plugin's 404 and the settings card would never register.
  check('没有任何前缀路由压在 ROUTE 本身或它的父路径上',
    routes.every((route) => route.kind !== 'prefix' || route.path.startsWith(ROUTE + '/')),
    JSON.stringify(prefix))
  check('每个路由都有 handler', routes.every((route) => typeof route.handler === 'function'))
}

console.log('\n配置读取（volatile 引用与普通值两种形态）')
{
  // A live reference is what the loader actually hands `apply`; a plain value is
  // what arrives when the schema could not be resolved. Both must read.
  const live = (value) => ({ [Symbol.for('cosmokit.volatile.write')]: true, get: () => value })
  const host = makeHost()
  mod.apply(host.ctx, {
    enabled: live(true),
    loop: live(false),
    startMuted: live(false),
    volume: live(0.42),
    showHint: live(false),
    resetSession: live(false),
    fadeMs: live(900),
    dim: live(0.5),
  })
  const cfgRow = inject(host.listeners)[0]
  const cfg = JSON.parse(String(cfgRow.text).replace('globalThis.__DSH_PV_HOME_CFG__=', ''))
  check('volatile 引用会被 get() 读出',
    cfg.loop === false && cfg.startMuted === false && cfg.volume === 0.42
      && cfg.showHint === false && cfg.resetSession === false && cfg.fadeMs === 900 && cfg.dim === 0.5,
    JSON.stringify(cfg))
}

console.log('\n' + (failures === 0 ? 'verify-injection: PASS' : 'verify-injection: FAIL')
  + ' (' + String(checks - failures) + '/' + String(checks) + ')')
process.exit(failures === 0 ? 0 : 1)
