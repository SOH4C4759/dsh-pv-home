// A stub DOM just large enough to run src/home-screen.js for real.
//
// The point is not to emulate a browser; it is to run the actual injected script
// against a document whose only interesting property is the one that matters at
// the moment its <script> tag is parsed: `document.body` does not exist yet.
// Everything else — elements, attributes, event dispatch, localStorage, the
// media element's own autoplay policy — is the smallest thing that lets the
// script's real control flow execute rather than be asserted about by regex.
//
// Regexes cannot tell the difference between "Escape is handled" and "Escape is
// mentioned in a comment"; a script that runs can.
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

/** Minimal style declaration with the one method the script uses. */
function makeStyle() {
  const vars = {}
  return {
    setProperty(name, value) { vars[name] = String(value) },
    getPropertyValue(name) { return vars[name] ?? '' },
    removeProperty(name) { delete vars[name] },
    vars,
  }
}

/** One DOM node. */
export class StubNode {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase()
    this.attributes = new Map()
    this.childNodes = []
    this.parentNode = null
    this.listeners = new Map()
    this.style = makeStyle()
    this._text = ''
    this.paused = true
  }

  get id() { return this.attributes.get('id') ?? '' }
  set id(value) { this.setAttribute('id', value) }

  get className() { return this.attributes.get('class') ?? '' }
  set className(value) { this.setAttribute('class', value) }

  get textContent() {
    if (this.childNodes.length === 0) return this._text
    return this.childNodes.map((child) => child.textContent).join('')
  }

  set textContent(value) {
    this.childNodes.length = 0
    this._text = String(value)
  }

  setAttribute(name, value) { this.attributes.set(String(name), String(value === true ? '' : value)) }
  getAttribute(name) { return this.attributes.has(String(name)) ? this.attributes.get(String(name)) : null }
  hasAttribute(name) { return this.attributes.has(String(name)) }
  removeAttribute(name) { this.attributes.delete(String(name)) }

  appendChild(node) {
    if (node.parentNode !== null) node.parentNode.removeChild(node)
    node.parentNode = this
    this.childNodes.push(node)
    return node
  }

  removeChild(node) {
    const index = this.childNodes.indexOf(node)
    if (index >= 0) this.childNodes.splice(index, 1)
    node.parentNode = null
    return node
  }

  addEventListener(type, listener, opts) {
    const key = String(type)
    if (!this.listeners.has(key)) this.listeners.set(key, [])
    const capture = opts === true
      || (opts !== null && opts !== undefined && typeof opts === 'object' && opts.capture === true)
    this.listeners.get(key).push({ fn: listener, capture })
  }

  removeEventListener(type, listener) {
    const list = this.listeners.get(String(type))
    if (list === undefined) return
    const index = list.findIndex((entry) => entry.fn === listener)
    if (index >= 0) list.splice(index, 1)
  }

  /** Every descendant, depth first, including this node. */
  descendants(out = []) {
    out.push(this)
    for (const child of this.childNodes) child.descendants(out)
    return out
  }

  findById(id) {
    return this.descendants().find((node) => node.id === id) ?? null
  }

  findAllByClass(name) {
    return this.descendants().filter((node) => node.getAttribute('class') !== null
      && node.getAttribute('class').split(/\s+/).includes(name))
  }

  /**
   * Dispatch an event with capture down and bubble up the parent chain, which is
   * the part of the real machine the script actually depends on: the click that
   * starts a refused film is heard by an ancestor, and Escape has to be caught
   * before the application sees it.
   */
  dispatch(type, event = {}) {
    const detail = Object.assign({
      type,
      target: this,
      currentTarget: this,
      defaultPrevented: false,
      stopped: false,
      preventDefault() { detail.defaultPrevented = true },
      stopPropagation() { detail.stopped = true },
    }, event)
    const path = []
    for (let node = this; node !== null; node = node.parentNode) path.push(node)
    const invoke = (node, capture) => {
      const list = node.listeners.get(String(type))
      if (list === undefined) return
      for (const entry of [...list]) {
        if (entry.capture !== capture) continue
        detail.currentTarget = node
        entry.fn.call(node, detail)
      }
    }
    for (const node of [...path].reverse()) invoke(node, true)
    for (const node of path) {
      invoke(node, false)
      if (detail.stopped) break
    }
    return detail
  }
}

/** The media element, with Chromium's autoplay policy as the default. */
export class StubMedia extends StubNode {
  constructor() {
    super('video')
    this.src = ''
    this.muted = false
    this.volume = 1
    this.duration = 0
    this.videoWidth = 0
    this.videoHeight = 0
    this.playCalls = 0
    this.pauseCalls = 0
  }

  play() {
    this.playCalls++
    this.paused = false
    const policy = this.ownerPolicy ?? { refuseUnmuted: true, refuseAlways: false }
    if (policy.refuseAlways === true || (policy.refuseUnmuted === true && this.muted !== true)) {
      const error = new Error('NotAllowedError')
      error.name = 'NotAllowedError'
      return Promise.reject(error)
    }
    return Promise.resolve()
  }

  pause() {
    this.pauseCalls++
    this.paused = true
  }
}

/**
 * Build one isolated document + script realm.
 * @param options - `bodyPresent` mounts a `<body>` before the script runs (the
 *   client-payload path), `search` seeds `location.search`, `stored` seeds
 *   localStorage, `storageThrows` makes every storage call throw.
 * @returns the harness.
 */
export function createHarness(options = {}) {
  const documentElement = new StubNode('html')
  const head = new StubNode('head')
  documentElement.appendChild(head)
  const body = options.bodyPresent === true ? documentElement.appendChild(new StubNode('body')) : null

  const store = new Map(Object.entries(options.stored ?? {}))
  const storageThrows = options.storageThrows === true
  const localStorage = {
    getItem(key) {
      if (storageThrows) throw new Error('storage unavailable')
      return store.has(key) ? store.get(key) : null
    },
    setItem(key, value) {
      if (storageThrows) throw new Error('storage unavailable')
      store.set(String(key), String(value))
    },
    removeItem(key) {
      if (storageThrows) throw new Error('storage unavailable')
      store.delete(String(key))
    },
    clear() { store.clear() },
    key(index) { return [...store.keys()][index] ?? null },
    get length() { return store.size },
  }

  const documentListeners = new Map()
  const document = {
    documentElement,
    head,
    body,
    readyState: 'loading',
    createElement(tag) {
      const element = String(tag).toLowerCase() === 'video' ? new StubMedia() : new StubNode(tag)
      element.ownerPolicy = mediaPolicy
      return element
    },
    getElementById(id) { return documentElement.findById(id) },
    addEventListener(type, listener) {
      const key = String(type)
      if (!documentListeners.has(key)) documentListeners.set(key, [])
      documentListeners.get(key).push(listener)
    },
    removeEventListener(type, listener) {
      const list = documentListeners.get(String(type))
      if (list === undefined) return
      const index = list.indexOf(listener)
      if (index >= 0) list.splice(index, 1)
    },
    querySelectorAll() { return [] },
  }

  const mediaPolicy = { refuseUnmuted: options.refuseUnmuted !== false, refuseAlways: options.refuseAlways === true }
  const windowListeners = new Map()
  const captured = { info: [], warn: [], error: [], log: [] }

  const sandbox = {
    document,
    localStorage,
    location: { search: options.search ?? '', href: 'http://127.0.0.1/' },
    console: {
      info: (...args) => captured.info.push(args),
      warn: (...args) => captured.warn.push(args),
      error: (...args) => captured.error.push(args),
      log: (...args) => captured.log.push(args),
    },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    addEventListener(type, listener) {
      const key = String(type)
      if (!windowListeners.has(key)) windowListeners.set(key, [])
      windowListeners.get(key).push(listener)
    },
    removeEventListener(type, listener) {
      const list = windowListeners.get(String(type))
      if (list === undefined) return
      const index = list.indexOf(listener)
      if (index >= 0) list.splice(index, 1)
    },
  }
  vm.createContext(sandbox)
  sandbox.window = sandbox

  const harness = {
    document,
    sandbox,
    localStorage,
    store,
    head,
    documentElement,
    body,
    console: captured,
    mediaPolicy,
    /** Every node carrying this class, from the document element down. */
    byClass: (name) => documentElement.findAllByClass(name),
    /** The home screen root, or null. */
    root: () => documentElement.findById('dsh-pv-home'),
    api: () => sandbox.__DSH_PV_HOME__,
    setConfig(cfg) { sandbox.__DSH_PV_HOME_CFG__ = cfg },
    /** Run the real injected script source in this realm. */
    runHomeScreen() {
      const source = readFileSync(join(ROOT, 'src', 'home-screen.js'), 'utf8')
      vm.runInContext(source, sandbox, { filename: 'home-screen.js' })
    },
    /** Fire a window-level event at every listener registered for it. */
    fireWindow(type, event = {}) {
      const detail = Object.assign({
        type,
        target: sandbox,
        defaultPrevented: false,
        stopped: false,
        preventDefault() { detail.defaultPrevented = true },
        stopPropagation() { detail.stopped = true },
      }, event)
      for (const listener of [...(windowListeners.get(String(type)) ?? [])]) listener.call(sandbox, detail)
      return detail
    },
    /** Fire a document-level event (DOMContentLoaded) at its listeners. */
    fireDocument(type, event = {}) {
      const detail = Object.assign({
        type,
        target: document,
        defaultPrevented: false,
        stopped: false,
        preventDefault() { detail.defaultPrevented = true },
        stopPropagation() { detail.stopped = true },
      }, event)
      for (const listener of [...(documentListeners.get(String(type)) ?? [])]) listener.call(document, detail)
      return detail
    },
    /** Attach a `<body>`, the way the parser does after `<head>` is done. */
    attachBody() {
      if (document.body !== null) return document.body
      const created = documentElement.appendChild(new StubNode('body'))
      document.body = created
      return created
    },
    windowListenerCount: (type) => (windowListeners.get(String(type)) ?? []).length,
  }
  return harness
}

/** The default config the Host would inject, for tests that only vary one field. */
export function defaultConfig(overrides = {}) {
  return Object.assign({
    route: '/plugins/dsh-pv-home',
    src: '/plugins/dsh-pv-home/clip/film.mp4?v=1-2',
    font: '/plugins/dsh-pv-home/font/SpaceMono-Bold.ttf',
    name: 'film.mp4',
    bytes: 2,
    faststart: true,
    sessionKey: 'dsh.sessions.current',
    loop: true,
    startMuted: true,
    volume: 1,
    showHint: true,
    resetSession: true,
    fadeMs: 30,
    dim: 0.18,
    matchCaption: true,
    fit: 'contain',
  }, overrides)
}

/** `await sleep(ms)` — for the timers the script deliberately relies on. */
export function sleep(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms) })
}
