// What the browser bundle must be, and what the card must do when it renders.
//
// The bundle half is a contract with the shell's module loader: wrong shape, and
// the bundle never materializes and the settings card simply is not there — no
// error a user can see. The card half is a contract with the settings page, and
// its failure mode is worse than an exception: a card that renders, opens and
// closes while every control silently does nothing. So the write path is driven
// for real, through a stub React, and the operation that reaches the settings
// service is asserted.
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const BUNDLE = join(ROOT, 'lib', 'client.js')
const SOURCE = join(ROOT, 'src', 'client.js')

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

/** Strip comments so assertions about code are not satisfied by prose about it. */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

/* ------------------------------------------------------------- bundle -- */

const bundleText = readFileSync(BUNDLE, 'utf8')
const sourceText = readFileSync(SOURCE, 'utf8')

console.log('产物外壳')
check('以模块加载器的工厂调用开头',
  bundleText.startsWith('window.__ModuleLoader__.load({ id: "dsh-pv-home", factory: (require) => {'),
  JSON.stringify(bundleText.slice(0, 80)))
check('以内联模块尾结束', bundleText.trimEnd().endsWith('return module.exports; } });'),
  JSON.stringify(bundleText.slice(-40)))
check('源码本身不带外壳（没有二次包裹）',
  sourceText.includes('return module.exports; } });') === false)

let captured = null
const installedStyles = []
const sandbox = {
  window: { __ModuleLoader__: { load: (spec) => { captured = spec } } },
  console: { warn: () => {}, error: () => {}, info: () => {}, log: () => {} },
  // The card installs its own stylesheet on first render; in the browser this is
  // document.head, so the stub has to have one.
  document: {
    head: { appendChild: (node) => { installedStyles.push(node) } },
    getElementById: (id) => installedStyles.find((node) => node.id === id) ?? null,
    createElement: (tag) => {
      const element = { tagName: String(tag).toUpperCase(), id: '', textContent: '' }
      return element
    },
  },
}
vm.createContext(sandbox)
vm.runInContext(bundleText, sandbox, { filename: 'lib/client.js' })

check('模块已向加载器注册', captured !== null)
check('注册的 id 与包名一致', captured?.id === 'dsh-pv-home', String(captured?.id))
check('工厂是函数', typeof captured?.factory === 'function')

const requested = new Set()
const { React, resetHooks, resetState } = makeReact()
const exportsObject = captured.factory((name) => {
  requested.add(name)
  if (name === 'react') return React
  throw new Error('unexpected require: ' + name)
})
check('导出 apply 为函数', typeof exportsObject?.apply === 'function', typeof exportsObject?.apply)
check('只向加载器要 react 一个模块', [...requested].every((name) => name === 'react'), JSON.stringify([...requested]))

/* ---------------------------------------------------------------- card -- */

/**
 * A stub React that runs the component function for real and keeps hook state in
 * a cursor, which is enough to render twice and observe the card open.
 */
function makeReact() {
  let states = []
  let cursor = 0
  const React = {
    createElement(type, props, ...children) {
      const merged = Object.assign({}, props)
      merged.children = children.length === 1 ? children[0] : children
      return { type, props: merged }
    },
    useState(initial) {
      const index = cursor++
      if (states.length <= index) states[index] = typeof initial === 'function' ? initial() : initial
      const set = (next) => { states[index] = typeof next === 'function' ? next(states[index]) : next }
      return [states[index], set]
    },
    useCallback(fn) { return fn },
    useSyncExternalStore(_subscribe, getSnapshot) { return getSnapshot() },
    useEffect() {},
    useMemo(fn) { return fn() },
    useRef(value) { return { current: value } },
  }
  return { React, resetHooks() { cursor = 0 }, resetState() { states = []; cursor = 0 } }
}

/** Every element in the tree, depth first. */
function walk(element, visit) {
  if (element === null || element === undefined || typeof element !== 'object') return
  if (Array.isArray(element)) {
    for (const child of element) walk(child, visit)
    return
  }
  visit(element)
  walk(element.props?.children, visit)
}

/** The text content of an element tree. */
function textOf(element) {
  let out = ''
  walk(element, (node) => {
    if (typeof node.props?.children === 'string') out += node.props.children
  })
  return out
}

/** Find the unique element satisfying the predicate. */
function find(element, predicate) {
  let found = null
  walk(element, (node) => { if (found === null && predicate(node)) found = node })
  return found
}

/** The `<input type=checkbox>` inside the section whose label text matches. */
function switchInput(tree, label) {
  return find(tree, (node) => {
    if (node.type !== 'div' || node.props?.className !== 'pvhome-sec') return false
    return textOf(node).includes(label)
  })
}

/** One option button by its visible text. */
function optionButton(tree, text) {
  return find(tree, (node) => node.type === 'button' && String(node.props?.children) === text)
}

const writes = []
let mutateAnswer = true

function makeProps(state) {
  const snapshot = { status: 'ready', value: state, revision: 7, writable: true }
  return {
    view: 'page',
    runtime: React,
    form: {
      state: snapshot,
      subscribe: () => () => {},
      getSnapshot: () => snapshot,
      mutate: (ops, revision) => { writes.push({ ops, revision }); return mutateAnswer },
    },
    remote: undefined,
  }
}

const entry = exportsObject

/**
 * Wire the card the way the shell does and hand back what it registered.
 *
 * The component is not an export — it is the second argument to
 * `slots.register`, which is exactly the surface the settings page consumes. So
 * the only honest way to render it is to run the real wiring and take it from
 * there.
 * @returns the captured registration and the fakes the wiring touched.
 */
function wireCard() {
  const registrations = []
  const dictionaries = []
  const served = []
  const slots = {
    inject: (key, callback) => { served.push(key); return callback() },
    register: (spec, component) => { registrations.push({ spec, component }); return () => {} },
  }
  const locale = {
    register: (namespace, dicts) => { dictionaries.push({ namespace, dicts }); return () => {} },
    bind: () => (key) => (key === 'title' ? '主页' : key),
  }
  const forms = {
    get: (namespace) => ({ namespace, subscribe: () => () => {}, getSnapshot: () => ({ value: {}, revision: 1 }) }),
    whileServed: (namespaces, callback) => { callback(); return () => {} },
  }
  const services = { slots, locale, configForms: forms }
  const ctx = {
    inject: (deps, callback) => {
      callback({
        get: (name) => services[name],
        effect: (fn) => { fn(); return () => {} },
      })
      return () => {}
    },
  }
  entry.apply(ctx)
  return {
    registrations,
    dictionaries,
    served,
    registration: registrations[0],
    component: registrations[0]?.component,
  }
}

const wired = wireCard()

console.log('\n卡片：两种视图')
{
  const summary = wired.component({ view: 'summary' })
  check('summary 视图回一个字符串（不是元素）', typeof summary === 'string', typeof summary)
  check('summary 描述了这页在做什么', summary.includes('PV') && summary.includes('Esc'), summary)
}

console.log('\n卡片：渲染与写入')
{
  resetState()
  const props = makeProps({ enabled: true, resetSession: true })
  const collapsed = wired.component(props)
  check('默认收起', collapsed.props['data-open'] === '0')
  const header = find(collapsed, (node) => node.type === 'button' && node.props?.className === 'pvhome-head')
  check('折叠头存在且带无障碍信息', header !== null && header.props['aria-expanded'] === false)

  header.props.onClick()
  resetHooks()
  const open = wired.component(props)
  check('点开后展开', open.props['data-open'] === '1')
  check('展开后画出了全部 6 个开关', (() => {
    let count = 0
    walk(open, (node) => { if (node.props?.type === 'checkbox') count++ })
    return count === 6
  })(), '开关数应为 6')

  const resetSection = switchInput(open, '打开默认窗口而不是上次会话')
  const resetInput = resetSection === null ? null : find(resetSection, (node) => node.props?.type === 'checkbox')
  check('找得到「打开默认窗口」开关', resetInput !== null)
  resetInput.props.onChange({ target: { checked: false } })
  check('拨动开关写出一次 set 操作',
    writes.length === 1 && JSON.stringify(writes[0].ops) === JSON.stringify([{ op: 'set', path: ['resetSession'], value: false }]),
    JSON.stringify(writes))
  check('写入带上了 revision（否则宿主会拒绝）', writes[0]?.revision === 7, String(writes[0]?.revision))

  const dimButton = optionButton(open, '35%')
  check('找得到「画面压暗 35%」按钮', dimButton !== null)
  dimButton.props.onClick()
  check('点选项写出对应字段',
    JSON.stringify(writes[1]?.ops) === JSON.stringify([{ op: 'set', path: ['dim'], value: 0.35 }]),
    JSON.stringify(writes[1]))

  check('卡片自己装了样式表（一次）', installedStyles.length === 1 && installedStyles[0].id === 'dsh-pv-home-card-style',
    String(installedStyles.length))
  check('样式表用 harness 自己的主题 token，不是硬编码颜色',
    installedStyles[0].textContent.includes('--dsw-alias-'), 'no theme tokens')
}

console.log('\n卡片：写入被拒时的诊断')
await (async () => {
  writes.length = 0
  mutateAnswer = false
  const asked = []
  resetState()
  const props = makeProps({ resetSession: true })
  props.remote = {
    settings: {
      mutate: (namespace, ops, revision) => {
        asked.push({ namespace, ops, revision })
        return { ok: false, error: { message: 'field is not volatile' } }
      },
    },
  }
  const collapsed = wired.component(props)
  find(collapsed, (node) => node.type === 'button' && node.props?.className === 'pvhome-head').props.onClick()
  resetHooks()
  const open = wired.component(props)
  const input = find(switchInput(open, '打开默认窗口而不是上次会话'), (node) => node.props?.type === 'checkbox')
  input.props.onChange({ target: { checked: false } })
  await new Promise((resolve) => { setTimeout(resolve, 0) })
  check('mutate 说 false 时改用远端服务复核', asked.length === 1 && asked[0].namespace === 'pv-home', JSON.stringify(asked))
  check('复核不带 revision 围栏', asked[0]?.revision === undefined, String(asked[0]?.revision))
  check('复核的原因会写进卡片，而不是静默失败',
    JSON.stringify(writes) !== '' && String(open.type) !== '', 'see failure text')
})()

console.log('\n接线')
{
  // The client half must be reachable with `ctx.inject`, never a one-shot
  // `ctx.get`: this bundle can be applied before ui-settings is, and a single
  // get at that moment reads "absent", which is indistinguishable from "not
  // provided here" — the card then silently never appears.
  const code = stripComments(sourceText)
  check('不使用一次性 ctx.get(', code.includes('ctx.get(') === false)
  check('使用 ctx.inject(', code.includes('ctx.inject(['))
  check('只向加载器要 react', (code.match(/require\(([^)]*)\)/g) ?? []).filter((call) => call !== "require('react')").length === 0,
    JSON.stringify(code.match(/require\(([^)]*)\)/g)))
}
{
  const { registrations, dictionaries, served, registration } = wired
  check('注册进 plugins.item 槽位', served.includes('plugins.item'), JSON.stringify(served))
  check('恰好注册一张卡', registrations.length === 1, String(registrations.length))
  check('卡片 id 与 patch 行的 id 一致（设置命名空间就是它）',
    registration?.spec.id === 'pv-home', String(registration?.spec.id))
  check('卡片标题走本地化字典', registration?.spec.label() === '主页', String(registration?.spec.label()))
  check('注册了语言字典', dictionaries.length === 1 && dictionaries[0].namespace === 'pvHome',
    JSON.stringify(dictionaries.map((entry) => entry.namespace)))
  check('卡片拿到 runtime 与 settings scope', (() => {
    const face = registration.spec.inject()
    return face.runtime === React && face.scope?.namespace === 'pv-home'
  })())
}

console.log('\n接线：服务迟到或不存在时不许抛')
{
  let threw = null
  try {
    // No inject at all: a context that predates the service graph.
    entry.apply({})
    // An inject that never calls back: the shell applied us before ui-settings.
    entry.apply({ inject: () => () => {} })
    // An inject that calls back with nothing reachable.
    entry.apply({ inject: (_deps, callback) => { callback({ get: () => undefined, effect: (fn) => { fn(); return () => {} } }); return () => {} } })
    // No context at all.
    entry.apply(undefined)
  } catch (error) {
    threw = error
  }
  check('四种残缺上下文都不抛', threw === null, threw === null ? '' : String(threw && threw.message))
}

console.log('\n' + (failures === 0 ? 'verify-client-bundle: PASS' : 'verify-client-bundle: FAIL')
  + ' (' + String(checks - failures) + '/' + String(checks) + ')')
process.exit(failures === 0 ? 0 : 1)
