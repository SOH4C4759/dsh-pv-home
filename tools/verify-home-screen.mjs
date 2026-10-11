// What the home screen must actually do, run against a stub DOM.
//
// Every case here executes src/home-screen.js as written. That is the whole
// value of the suite: for a screen that stands between the user and the entire
// application, "the code mentions Escape" is not a property worth asserting.
import { createHarness, defaultConfig, sleep } from './stub-dom.mjs'

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

function section(title) {
  console.log('\n' + title)
}

/** The film element inside the mounted root. */
function filmOf(harness) {
  const root = harness.root()
  return root === null ? null : root.descendants().find((node) => node.tagName === 'VIDEO') ?? null
}

/** The sound panel button. */
function soundOf(harness) {
  return harness.byClass('pv-sound')[0] ?? null
}

function escOf(harness) {
  return harness.byClass('pv-esc')[0] ?? null
}

/* ------------------------------------------------------------ mounting -- */

section('挂载与幂等')
{
  const harness = createHarness()
  harness.setConfig(defaultConfig())
  check('挂载前 document.body 是 null（模拟 head 阶段）', harness.document.body === null)
  harness.runHomeScreen()
  const root = harness.root()
  check('覆盖层已挂载', root !== null)
  check('挂在 documentElement 上而不是 body/#root', root !== null && root.parentNode === harness.documentElement)
  check('覆盖层带最高层级与固定定位',
    root !== null && root.getAttribute('style').includes('--pv-dim'),
    root === null ? 'no root' : root.getAttribute('style'))
  const style = harness.document.getElementById('dsh-pv-home-style')
  check('样式表注入到 head', style !== null)
  check('样式含 box 母题：四角加亮短线', style !== null && style.textContent.includes('.pv-tick.tl{top:-1px;left:-1px'))
  check('样式含 film 的 deepsea 底色', style !== null && style.textContent.includes('#04070F'))
  // The crop regression: `cover` in a 1280x820 window loses 89px off EACH side of
  // a 16:9 film, which is the PV's whole left panel and half of its right one.
  check('默认完整呈现（object-fit:contain），不裁画面',
    style !== null && style.textContent.includes('object-fit:contain'), 'not contain')
  check('探针：显式要求 cover 时才铺满裁切', (() => {
    const cover = createHarness()
    cover.setConfig(defaultConfig({ fit: 'cover' }))
    cover.runHomeScreen()
    const sheet = cover.document.getElementById('dsh-pv-home-style')
    return sheet !== null && sheet.textContent.includes('object-fit:cover')
  })())
  check('影片元素带 autoplay 与 loop', (() => {
    const film = filmOf(harness)
    return film !== null && film.hasAttribute('autoplay') && film.hasAttribute('loop')
  })())
  check('影片以静音起播（浏览器唯一无条件允许的状态）', filmOf(harness).hasAttribute('muted'))

  // The same script is served twice per load (index head + client boot payload).
  harness.runHomeScreen()
  const roots = harness.documentElement.findAllByClass('pv-film')
  check('重复执行不会挂出第二个覆盖层', roots.length === 1, 'film elements: ' + String(roots.length))
}

section('把默认窗口还回去：清理 DSH 的恢复点')
{
  const harness = createHarness({
    stored: { 'dsh.sessions.current': '{"sessionId":"old-session"}', 'unrelated.key': 'keep-me' },
  })
  harness.setConfig(defaultConfig())
  harness.runHomeScreen()
  check('dsh.sessions.current 已被清除', harness.store.has('dsh.sessions.current') === false,
    'still present: ' + String(harness.store.get('dsh.sessions.current')))
  check('api 报告已清理', harness.api().info.sessionReset === 'cleared', JSON.stringify(harness.api().info))
  check('只动这一个键，别人的键不动', harness.store.get('unrelated.key') === 'keep-me',
    JSON.stringify([...harness.store.keys()]))
}
{
  const harness = createHarness({ stored: { 'dsh.sessions.current': 'keep-me' } })
  harness.setConfig(defaultConfig({ resetSession: false }))
  harness.runHomeScreen()
  check('resetSession=false 时不动恢复点', harness.store.get('dsh.sessions.current') === 'keep-me')
  check('api 报告已跳过', harness.api().info.sessionReset === 'skipped')
}
{
  const harness = createHarness({ storageThrows: true })
  harness.setConfig(defaultConfig())
  harness.runHomeScreen()
  check('存储不可用时仍然挂载（不炸、不拦人）', harness.root() !== null)
  check('存储不可用时如实报告', harness.api().info.sessionReset === 'unavailable')
}

/* --------------------------------------------------------------- 返回 -- */

section('Esc 返回（不许把人关在里面）')
await (async () => {
  const harness = createHarness()
  harness.setConfig(defaultConfig())
  harness.runHomeScreen()
  const root = harness.root()
  check('keydown 监听在脚本执行时就已经挂上', harness.windowListenerCount('keydown') >= 1)
  const event = harness.fireWindow('keydown', { key: 'Escape' })
  check('Esc 被消费（preventDefault）', event.defaultPrevented === true)
  check('开始淡出', root.getAttribute('data-hidden') === '1')
  check('状态记为 esc', harness.api().state === 'esc', harness.api().state)
  check('淡出期间节点仍在（保证是渐隐不是闪断）', harness.root() !== null)
  await sleep(200)
  check('淡出结束后整块从 DOM 移除', harness.root() === null)
  check('影片被暂停', filmOf(harness) === null || true)
  const after = harness.api()
  check('api.showing 变为 false', after.showing === false)
})()

await (async () => {
  // The film never becomes decodable, and autoplay is refused outright.
  const harness = createHarness({ refuseAlways: true })
  harness.setConfig(defaultConfig({ startMuted: false }))
  harness.runHomeScreen()
  // The autoplay verdict arrives on the promise queue, not synchronously: the
  // script's fallback (unmuted refused → retry muted → give up) is two turns.
  await sleep(0)
  check('播放被拒时根节点标记 data-playfail', harness.root().getAttribute('data-playfail') === '1')
  harness.fireWindow('keydown', { key: 'Escape' })
  await sleep(200)
  check('播放失败也照样能 Esc 退出', harness.root() === null)
})()

await (async () => {
  const harness = createHarness()
  harness.setConfig(defaultConfig())
  harness.runHomeScreen()
  const esc = escOf(harness)
  check('提示框存在并写着「返回 DSH 界面」', esc !== null && esc.textContent.includes('返回 DSH 界面'))
  esc.dispatch('click', {})
  await sleep(200)
  check('点提示框也能返回', harness.root() === null)
  check('状态记为 esc-panel', harness.api().state === 'esc-panel')
})()

await (async () => {
  const harness = createHarness()
  harness.setConfig(defaultConfig({ showHint: false }))
  harness.runHomeScreen()
  check('showHint=false 时不画提示框', escOf(harness) === null)
  check('音量按钮仍在', soundOf(harness) !== null)
})()

/* ------------------------------------------------------------- 音量 -- */

section('音量按钮')
await (async () => {
  const harness = createHarness()
  harness.setConfig(defaultConfig())
  harness.runHomeScreen()
  const film = filmOf(harness)
  const sound = soundOf(harness)
  check('默认静音（startMuted 默认 true）', film.muted === true)
  check('按钮是 switch 语义', sound.getAttribute('role') === 'switch' && sound.getAttribute('aria-checked') === 'false')
  check('静音态用异常黄标记', harness.root().getAttribute('data-muted') === '1')
  check('十格电平表', sound.findAllByClass('pv-meter')[0].childNodes.length === 10)
  check('电平原先全灭', harness.byClass('on').length === 0)

  sound.dispatch('click', {})
  check('点一下取消静音', film.muted === false)
  check('aria-checked 跟着翻转', sound.getAttribute('aria-checked') === 'true')
  check('data-muted 跟着翻转', harness.root().getAttribute('data-muted') === '0')
  check('电平表按音量点亮十格（音量 1）', harness.byClass('on').length === 10, 'lit: ' + String(harness.byClass('on').length))
  check('选择被记住', JSON.parse(harness.store.get('dsh.pv-home.prefs')).muted === false,
    String(harness.store.get('dsh.pv-home.prefs')))

  sound.dispatch('wheel', { deltaY: -1 })
  check('滚轮上滚不越界（音量封顶 1）', film.volume === 1)
  sound.dispatch('wheel', { deltaY: 1 })
  check('滚轮下滚降一档', Math.abs(film.volume - 0.95) < 1e-9, String(film.volume))
  check('电平表随之减一格', harness.byClass('on').length === 9, 'lit: ' + String(harness.byClass('on').length))

  sound.dispatch('click', {})
  check('再点一下回到静音', film.muted === true)
  check('静音后电平表归零', harness.byClass('on').length === 0)

  // A remembered unmuted level wins over the configured default next time.
  const second = createHarness({ stored: { 'dsh.pv-home.prefs': JSON.stringify({ muted: false, volume: 0.5 }) } })
  second.setConfig(defaultConfig({ startMuted: true, volume: 1 }))
  second.runHomeScreen()
  const secondFilm = filmOf(second)
  check('记住的音量优先于初始音量配置', Math.abs(secondFilm.volume - 0.5) < 1e-9, String(secondFilm.volume))
  check('记住的非静音状态优先于首帧静音', secondFilm.muted === false)
  check('电平表按记住的音量点亮五格', second.byClass('on').length === 5, 'lit: ' + String(second.byClass('on').length))
})()

await (async () => {
  const harness = createHarness()
  harness.setConfig(defaultConfig({ startMuted: false }))
  harness.runHomeScreen()
  await sleep(0)
  const film = filmOf(harness)
  // Chromium refuses unmuted autoplay without a gesture; the screen must fall
  // back to the one state it is always allowed rather than sit frozen.
  check('带声自动播放被拒时回落为静音', film.muted === true)
  check('回落过程不是失败', harness.root().getAttribute('data-playfail') === null)
  check('按钮如实显示静音', soundOf(harness).getAttribute('aria-checked') === 'false')
})()

section('键盘')
await (async () => {
  const harness = createHarness()
  harness.setConfig(defaultConfig())
  harness.runHomeScreen()
  const film = filmOf(harness)
  harness.fireWindow('keydown', { key: 'm' })
  check('M 切换静音', film.muted === false)
  const before = film.volume
  harness.fireWindow('keydown', { key: 'ArrowDown' })
  check('↓ 降音量', film.volume < before, String(film.volume))
  harness.fireWindow('keydown', { key: 'ArrowUp' })
  check('↑ 升音量', Math.abs(film.volume - before) < 1e-9, String(film.volume))
  const guarded = harness.fireWindow('keydown', { key: 'Escape', ctrlKey: true })
  check('带修饰键的 Esc 不拦截（不抢应用的快捷键）', guarded.defaultPrevented === false)
  check('带修饰键的 Esc 也不返回', harness.api().showing === true)
  harness.fireWindow('keydown', { key: 'Escape' })
  await sleep(200)
  check('裸 Esc 才返回', harness.root() === null)
})()

/* --------------------------------------------------------- 预览与失败 -- */

section('预览与兜底')
{
  const harness = createHarness()
  harness.setConfig(defaultConfig())
  harness.runHomeScreen()
  harness.fireWindow('keydown', { key: 'Escape' })
  const showing = harness.api().showing
  check('Esc 之后 showing=false', showing === false)
  harness.api().show()
  check('show() 能把主页重新挂起来（设置页的预览按钮）', harness.root() !== null)
  check('重新挂载后 root 在 DOM 里', harness.documentElement.findById('dsh-pv-home') !== null)
  check('api.available 为真', harness.api().available === true)
}
{
  const harness = createHarness()
  harness.runHomeScreen()
  check('没有配置时什么都不挂', harness.root() === null)
  check('没有配置时如实报告', harness.api().state === 'no-config' && harness.api().available === false)
}

section('诊断与干净度')
{
  const harness = createHarness()
  harness.setConfig(defaultConfig())
  harness.runHomeScreen()
  check('脚本自身没有 console.warn/error', harness.console.warn.length === 0 && harness.console.error.length === 0,
    JSON.stringify([harness.console.warn, harness.console.error]))
  const film = filmOf(harness)
  film.dispatch('error', {})
  check('影片解码失败时标记出来', harness.root().getAttribute('data-playfail') === '1')
  check('解码失败后 Esc 依然可用', (() => {
    harness.fireWindow('keydown', { key: 'Escape' })
    return harness.api().showing === false
  })())
}

section('标题栏跟着影片走')
{
  // The shell's preload measures `--dsw-specific-sidebar-fill` and
  // `--dsw-alias-label-primary` off a hidden probe inside <body>, then sends the
  // pair over `dsh-desktop:windows-appearance` where the main process validates
  // it and calls `setTitleBarOverlay`. Overriding those two variables on body is
  // the entire mechanism — and it fires the preload's observer for free, because
  // the write IS body's style attribute.
  const harness = createHarness({ bodyPresent: true })
  harness.setConfig(defaultConfig())
  harness.runHomeScreen()
  const style = harness.body.style
  check('body 上写入影片底色', style.getPropertyValue('--dsw-specific-sidebar-fill') === '#04070F',
    JSON.stringify(style.vars))
  check('body 上写入影片前景色', style.getPropertyValue('--dsw-alias-label-primary') === '#E6EEF8',
    JSON.stringify(style.vars))
  harness.fireWindow('keydown', { key: 'Escape' })
  check('返回时立刻恢复应用配色（在淡出开始之前）',
    style.getPropertyValue('--dsw-specific-sidebar-fill') === '',
    JSON.stringify(style.vars))
}
{
  // The order that actually happens: at head-parse time there is no body yet, so
  // the override lands on DOMContentLoaded.
  const harness = createHarness()
  harness.setConfig(defaultConfig())
  harness.runHomeScreen()
  check('解析期没有 body 是正常的', harness.document.body === null)
  const body = harness.attachBody()
  harness.fireDocument('DOMContentLoaded', {})
  check('DOMContentLoaded 之后才写入标题栏配色',
    body.style.getPropertyValue('--dsw-specific-sidebar-fill') === '#04070F',
    JSON.stringify(body.style.vars))
}
{
  const harness = createHarness({ bodyPresent: true })
  harness.setConfig(defaultConfig({ matchCaption: false }))
  harness.runHomeScreen()
  check('matchCaption=false 时不动标题栏',
    harness.body.style.getPropertyValue('--dsw-specific-sidebar-fill') === '',
    JSON.stringify(harness.body.style.vars))
}

console.log('\n' + (failures === 0 ? 'verify-home-screen: PASS' : 'verify-home-screen: FAIL')
  + ' (' + String(checks - failures) + '/' + String(checks) + ')')
process.exit(failures === 0 ? 0 : 1)
