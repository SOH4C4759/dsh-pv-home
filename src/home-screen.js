/*
 * dsh-pv-home — the home screen.
 *
 * This file is injected, verbatim, as a parse-blocking <script> at the START of
 * the served index's <head>, i.e. before the shell module script and long before
 * React mounts. It is deliberately framework-free and dependency-free: the only
 * thing it may assume is that `document.head` exists, which is true at the point
 * its own <script> tag is being parsed.
 *
 * Two jobs, in this order and for this reason:
 *
 *   1. Give DSH its default window back. `localStorage['dsh.sessions.current']`
 *      is where DSH's own workspace controller persists the Session it should
 *      reopen; it rehydrates that store when the client boots. Dropping the key
 *      here — during parsing, before any module has run — is what makes this a
 *      home page rather than a wallpaper over yesterday's conversation. It runs
 *      first because it is the one part whose failure would be silent: the page
 *      would look right and still be wrong.
 *
 *   2. Own the viewport until the user leaves. Full-bleed looping film, plus two
 *      panels drawn in the film's own visual language — the information-free
 *      chrome is the point; the user should not be able to tell where the film
 *      stops and this script starts.
 *
 * The visual language is taken from the PV's own renderer
 * (`film/tui_pv_world_execute_20260926/tuikit.py`, palette `deepsea`): the
 * box-with-a-title-on-its-border motif is that file's `box()`, down to the
 * title's x-offset and the bright 2px corner ticks; the colours are its
 * `PALETTES.deepsea` entries. Shipping the same Space Mono Bold the film uses
 * for box titles is what keeps the panels from reading as an overlay.
 *
 * Escape hatch, deliberately unconditional: the keydown listener is attached
 * synchronously below and Esc leaves from the very first frame. Nothing in this
 * file — a dead film, a refused autoplay, a broken preference document — may
 * take that away, because the screen sits between the user and the whole
 * application.
 */
(function () {
  'use strict'

  var CFG = globalThis.__DSH_PV_HOME_CFG__

  var ROOT_ID = 'dsh-pv-home'
  var STYLE_ID = 'dsh-pv-home-style'
  var PREF_KEY = 'dsh.pv-home.prefs'

  // Idempotence, and it is not theoretical: the same injection table is served
  // two ways — rendered into the index's <head> by the web server AND carried in
  // the client's boot payload — so this file can legitimately execute twice in
  // one load. The second execution must be a no-op rather than a second overlay
  // stacked on the first.
  var prior = globalThis.__DSH_PV_HOME__
  if (prior !== undefined && prior !== null && prior.available === true) return

  // The film's palette (tuikit.py PALETTES.deepsea) plus its brand blue.
  var BG = '#04070F'
  var UI = '#C8D6EA'
  var BRIGHT = '#E6EEF8'
  var BLUE = '#4D6BFE'
  var ANOM = '#FFCC00'
  var ANOM_HI = '#FFE066'

  var IDLE_MS = 3200
  var METER_CELLS = 10

  /* ------------------------------------------------------------------ API --
   * Published before anything can fail, so a diagnostic (or the settings card's
   * preview button) can always ask what happened instead of guessing from an
   * absent global.
   */
  var api = {
    available: false,
    showing: false,
    state: 'starting',
    info: null,
    show: function () {},
    dismiss: function () {},
  }
  globalThis.__DSH_PV_HOME__ = api

  if (CFG === null || typeof CFG !== 'object' || typeof CFG.src !== 'string') {
    api.state = 'no-config'
    return
  }

  var FADE = typeof CFG.fadeMs === 'number' ? CFG.fadeMs : 420
  var DIM = typeof CFG.dim === 'number' ? CFG.dim : 0.18
  var MATCH_CAPTION = CFG.matchCaption !== false
  /*
   * How the film meets a window that is not its aspect ratio.
   *
   * `cover` fills the box and therefore CROPS, and the crop is not the sliver it
   * sounds like: in a 1280x820 window (1.56) a 16:9 film is scaled to the height
   * and loses 178px horizontally — 89px off each side, which is the whole left
   * panel of the PV and half of the right one. `contain` shows the complete
   * frame and leaves bars instead; against this film's near-black background the
   * bars are close to invisible, which is why it is the default.
   */
  var FIT = CFG.fit === 'cover' ? 'cover' : 'contain'
  var SESSION_KEY = typeof CFG.sessionKey === 'string' && CFG.sessionKey !== ''
    ? CFG.sessionKey
    : 'dsh.sessions.current'

  /* ------------------------------------------------ 1. the default window --
   * Wrapped because storage can be unavailable (private mode, a quota refusal)
   * and DSH's own behaviour is a perfectly good fallback; it just is not a home
   * page. Reported through `api.state` rather than thrown.
   */
  var sessionReset = 'skipped'
  if (CFG.resetSession !== false) {
    try {
      localStorage.removeItem(SESSION_KEY)
      sessionReset = 'cleared'
    } catch (error) {
      sessionReset = 'unavailable'
    }
  }
  api.info = { sessionKey: SESSION_KEY, sessionReset: sessionReset }

  /* ----------------------------------------------------------- 2. prefs --
   * The user's own choice outranks the configured default: this screen appears
   * on every launch, and a volume knob that forgets is a volume knob nobody
   * touches twice. A corrupt or absent document falls back to the config.
   */
  function readPrefs() {
    try {
      var raw = localStorage.getItem(PREF_KEY)
      if (typeof raw !== 'string' || raw === '') return {}
      var parsed = JSON.parse(raw)
      return parsed !== null && typeof parsed === 'object' ? parsed : {}
    } catch (error) {
      return {}
    }
  }

  function writePrefs(next) {
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify(next))
    } catch (error) {
      // Persistence is a convenience; the switch still works for this page.
    }
  }

  var prefs = readPrefs()

  function clamp01(value) {
    if (typeof value !== 'number' || !isFinite(value)) return 0
    return value < 0 ? 0 : (value > 1 ? 1 : value)
  }

  function wantedVolume() {
    return typeof prefs.volume === 'number' ? clamp01(prefs.volume) : clamp01(CFG.volume)
  }

  function wantedMuted() {
    return typeof prefs.muted === 'boolean' ? prefs.muted : CFG.startMuted !== false
  }

  /* ------------------------------------------------------------- 3. DOM -- */

  function el(tag, attrs, children) {
    var node = document.createElement(tag)
    if (attrs) {
      for (var key in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, key)) continue
        var value = attrs[key]
        if (value === null || value === undefined || value === false) continue
        if (key === 'text') node.textContent = String(value)
        else if (key === 'style') node.setAttribute('style', String(value))
        else node.setAttribute(key, value === true ? '' : String(value))
      }
    }
    if (children) {
      for (var i = 0; i < children.length; i++) {
        if (children[i]) node.appendChild(children[i])
      }
    }
    return node
  }

  /**
   * One panel in the film's own idiom: `box()` from tuikit.py.
   *
   * A 1px frame, four 7px bright corner ticks, and a title sitting ON the top
   * border with the background punched out of it. The offset (12px) and the tick
   * length are the renderer's constants, not invented here.
   */
  function panel(title, extraClass) {
    var button = el('button', { type: 'button', 'class': 'pv-box ' + extraClass })
    button.appendChild(el('span', { 'class': 'pv-tick tl' }))
    button.appendChild(el('span', { 'class': 'pv-tick tr' }))
    button.appendChild(el('span', { 'class': 'pv-tick bl' }))
    button.appendChild(el('span', { 'class': 'pv-tick br' }))
    button.appendChild(el('span', { 'class': 'pv-title', text: title }))
    var body = el('span', { 'class': 'pv-row' })
    button.appendChild(body)
    return { button: button, body: body }
  }

  var styleText = [
    '@font-face{font-family:"PV Mono";font-style:normal;font-weight:700;font-display:swap;',
    'src:url("' + String(CFG.font) + '") format("truetype")}',
    '#' + ROOT_ID + '{position:fixed;inset:0;z-index:2147483647;background:' + BG + ';overflow:hidden;',
    'margin:0;padding:0;opacity:1;transition:opacity var(--pv-fade,420ms) linear;',
    'font:700 12px/1 Consolas,"Cascadia Mono",ui-monospace,monospace;color:' + UI + ';',
    'text-rendering:geometricPrecision;-webkit-font-smoothing:antialiased}',
    '#' + ROOT_ID + '[data-hidden="1"]{opacity:0;pointer-events:none}',
    '#' + ROOT_ID + ' .pv-film{position:absolute;inset:0;width:100%;height:100%;object-fit:' + FIT + ';',
    'display:block;background:' + BG + '}',
    '#' + ROOT_ID + ' .pv-dim{position:absolute;inset:0;pointer-events:none;',
    'background:rgba(4,7,15,var(--pv-dim,0.18))}',
    '#' + ROOT_ID + ' .pv-hud{position:absolute;left:0;right:0;bottom:0;display:flex;align-items:flex-end;',
    'justify-content:space-between;gap:18px;padding:0 26px 22px;pointer-events:none;',
    'opacity:1;transition:opacity 280ms linear}',
    '#' + ROOT_ID + '[data-idle="1"] .pv-hud{opacity:.34}',
    '#' + ROOT_ID + ' .pv-box{pointer-events:auto;position:relative;margin:0;padding:13px 15px 12px;',
    'background:' + BG + ';border:1px solid rgba(200,214,234,.42);color:' + UI + ';',
    'font:700 12px/1 "PV Mono",Consolas,"Cascadia Mono",monospace;letter-spacing:.14em;',
    'text-transform:uppercase;cursor:pointer;text-align:left;appearance:none;',
    'box-shadow:0 12px 34px rgba(0,0,0,.5);',
    'transition:border-color 130ms linear,color 130ms linear}',
    '#' + ROOT_ID + ' .pv-box:hover{border-color:rgba(230,238,248,.82)}',
    '#' + ROOT_ID + ' .pv-box:focus-visible{outline:1px solid ' + BLUE + ';outline-offset:2px}',
    '#' + ROOT_ID + ' .pv-tick{position:absolute;width:7px;height:7px;color:' + BRIGHT + '}',
    '#' + ROOT_ID + ' .pv-tick.tl{top:-1px;left:-1px;border-top:2px solid;border-left:2px solid}',
    '#' + ROOT_ID + ' .pv-tick.tr{top:-1px;right:-1px;border-top:2px solid;border-right:2px solid}',
    '#' + ROOT_ID + ' .pv-tick.bl{bottom:-1px;left:-1px;border-bottom:2px solid;border-left:2px solid}',
    '#' + ROOT_ID + ' .pv-tick.br{bottom:-1px;right:-1px;border-bottom:2px solid;border-right:2px solid}',
    '#' + ROOT_ID + ' .pv-title{position:absolute;top:-8px;left:12px;padding:0 4px;background:' + BG + ';',
    'font:700 11px/16px "PV Mono",Consolas,monospace;letter-spacing:.16em;color:' + BRIGHT + '}',
    '#' + ROOT_ID + ' .pv-row{display:flex;align-items:center;white-space:nowrap}',
    '#' + ROOT_ID + ' .pv-meter{display:inline-flex;gap:2px;margin-right:10px}',
    '#' + ROOT_ID + ' .pv-meter i{display:block;width:5px;height:11px;background:rgba(200,214,234,.2)}',
    '#' + ROOT_ID + ' .pv-meter i.on{background:var(--pv-accent,' + BLUE + ')}',
    '#' + ROOT_ID + ' .pv-cjk{font-family:"Microsoft YaHei","PingFang SC",sans-serif;letter-spacing:.06em}',
    '#' + ROOT_ID + '[data-muted="1"] .pv-sound{border-color:rgba(255,204,0,.5);color:' + ANOM + '}',
    '#' + ROOT_ID + '[data-muted="1"] .pv-sound .pv-title{color:' + ANOM_HI + '}',
    '#' + ROOT_ID + '[data-muted="1"] .pv-sound .pv-tick{color:' + ANOM_HI + '}',
    '#' + ROOT_ID + '[data-playfail="1"] .pv-film{opacity:0}',
    '#' + ROOT_ID + ' .pv-diag{position:absolute;left:26px;top:20px;padding:8px 10px;background:' + BG + ';',
    'border:1px solid rgba(200,214,234,.35);font:700 11px/16px Consolas,monospace;color:' + UI + '}',
  ].join('')

  var style = el('style', { id: STYLE_ID, text: styleText })
  // `document.head` exists: this script is being parsed inside it.
  document.head.appendChild(style)

  var video = el('video', {
    'class': 'pv-film',
    playsinline: true,
    autoplay: true,
    preload: 'auto',
    // The attribute is the load-time truth; `applyAudio` takes over immediately
    // after and consults the stored preference. Muted is the only state Chromium
    // guarantees without a gesture, so it is the honest starting point.
    muted: true,
    loop: CFG.loop !== false,
  })
  video.setAttribute('disablepictureinpicture', '')
  video.src = String(CFG.src)

  var sound = panel('/ sound', 'pv-sound')
  sound.button.setAttribute('role', 'switch')
  sound.button.setAttribute('aria-checked', 'false')
  sound.button.setAttribute('aria-label', '静音开关')
  sound.button.title = '点击切换静音 · 滚轮调节音量 · M / ↑ ↓'

  var meter = el('span', { 'class': 'pv-meter' })
  var cells = []
  for (var c = 0; c < METER_CELLS; c++) {
    var cell = el('i')
    cells.push(cell)
    meter.appendChild(cell)
  }
  var stateText = el('span', { 'class': 'pv-state' })
  sound.body.appendChild(meter)
  sound.body.appendChild(stateText)

  var esc = panel('/ esc', 'pv-esc')
  esc.button.setAttribute('aria-label', '返回 DeepSeek Harness')
  esc.button.title = '返回 DSH 界面'
  esc.body.appendChild(el('span', { 'class': 'pv-cjk', text: '返回 DSH 界面' }))

  var hud = el('div', { 'class': 'pv-hud' }, [
    CFG.showHint === false ? null : esc.button,
    sound.button,
  ])

  var root = el('div', {
    id: ROOT_ID,
    'data-muted': '0',
    style: '--pv-dim:' + String(DIM) + ';--pv-fade:' + String(FADE) + 'ms',
  }, [
    video,
    el('div', { 'class': 'pv-dim' }),
    hud,
  ])

  var diag = null
  if (/[?&]dshpvdiag=1/.test(String(location.search))) {
    diag = el('div', { 'class': 'pv-diag' })
    root.appendChild(diag)
  }

  // `<body>` does not exist yet: this script runs while `<head>` is still being
  // parsed. Attaching to the document element keeps the overlay out of both the
  // parser's insertion point and `#root`, which is also what keeps the renderer's
  // mount a plain `createRoot` rather than a hydration of content it did not
  // emit. Done in the same tick as the style, so the very first paint is covered.
  var host = document.body || document.documentElement
  host.appendChild(root)

  api.available = true
  api.showing = true
  api.state = 'showing'

  /* ---------------------------------------------------------- 4. audio -- */

  var ramping = false

  function render() {
    var muted = video.muted === true || video.volume === 0
    // The epsilon is what makes the meter honest at the top of its range: one
    // wheel step down from 1 is 0.95, whose exact product with ten cells is 9.5,
    // and plain rounding would leave all ten lit and the control looking dead.
    var level = muted ? 0 : Math.round(clamp01(video.volume) * METER_CELLS - 1e-9)
    for (var i = 0; i < cells.length; i++) {
      if (i < level) cells[i].setAttribute('class', 'on')
      else cells[i].setAttribute('class', '')
    }
    root.setAttribute('data-muted', muted ? '1' : '0')
    sound.button.setAttribute('aria-checked', muted ? 'false' : 'true')
    stateText.textContent = muted ? 'muted' : 'on ' + String(Math.round(video.volume * 100)) + '%'
    sound.button.style.setProperty('--pv-accent', muted ? ANOM : BLUE)
  }

  function applyAudio() {
    if (ramping) return
    video.volume = wantedVolume()
    video.muted = wantedMuted()
    render()
  }

  var playFailed = false

  function play() {
    var attempt
    try {
      attempt = video.play()
    } catch (error) {
      attempt = null
    }
    if (attempt === null || typeof attempt.catch !== 'function') return
    attempt.catch(function () {
      if (api.showing === false) return
      // An unmuted autoplay refusal is expected on a cold profile and is
      // recoverable: fall back to the one state Chromium always grants, and say
      // so through the panel rather than through a silent freeze. A second
      // refusal is a real decode problem.
      if (video.muted !== true) {
        video.muted = true
        render()
        play()
        return
      }
      playFailed = true
      api.state = 'play-failed'
      root.setAttribute('data-playfail', '1')
    })
  }

  function persist() {
    prefs.muted = video.muted === true
    prefs.volume = clamp01(video.volume)
    writePrefs(prefs)
  }

  function setMuted(next) {
    video.muted = next === true
    if (video.muted === false && video.volume === 0) video.volume = wantedVolume() || 1
    if (video.muted === false) play()
    persist()
    render()
  }

  function toggleMute() {
    setMuted(video.muted !== true)
  }

  function nudge(delta) {
    var next = clamp01(video.volume + delta)
    video.volume = next
    // Raising the level on a muted panel is a request to hear it; leaving it
    // muted would make the meter lie about what the button does.
    if (next > 0 && video.muted === true) video.muted = false
    if (next === 0) video.muted = true
    if (video.muted === false) play()
    persist()
    render()
  }

  /* ------------------------------------------- 5. the Windows caption too --
   * The window's minimize/maximize/close buttons are not drawn by this page:
   * the desktop shell uses `titleBarStyle: 'hidden'` with a `titleBarOverlay`,
   * whose colour belongs to the MAIN process. The one seam the renderer owns is
   * measurement: the app's preload keeps a hidden probe whose colours come from
   * `--dsw-specific-sidebar-fill` and `--dsw-alias-label-primary`, re-reads them
   * on every mutation of `document.body`'s style, and sends the result over
   * `dsh-desktop:windows-appearance`, where the main process validates it and
   * calls `setTitleBarOverlay`.
   *
   * So overriding those two variables ON `document.body` — inline, which wins
   * over any stylesheet rule for that subtree — is enough to make the caption
   * part of the film while the film is playing, and removing them puts the
   * application's palette back. It also fires the observer for free, because
   * the two writes ARE `document.body`'s style. Setting them is not a hack
   * around the shell; it is the same input the shell's own theme uses.
   *
   * What this cannot do: change the GLYPHS. They are drawn by the system, and
   * only colour and height are addressable. Shape would need a main-process
   * change, which a plugin must not make.
   */
  var CAPTION_VARS = [
    ['--dsw-specific-sidebar-fill', BG],
    ['--dsw-alias-label-primary', BRIGHT],
  ]

  function applyCaption() {
    if (!MATCH_CAPTION) return
    var body = document.body
    if (body === null || body === undefined || body.style === undefined) return
    for (var i = 0; i < CAPTION_VARS.length; i++) {
      if (body.style.getPropertyValue(CAPTION_VARS[i][0]) !== CAPTION_VARS[i][1]) {
        body.style.setProperty(CAPTION_VARS[i][0], CAPTION_VARS[i][1])
      }
    }
  }

  function restoreCaption() {
    var body = document.body
    if (body === null || body === undefined || body.style === undefined) return
    for (var i = 0; i < CAPTION_VARS.length; i++) {
      if (body.style.getPropertyValue(CAPTION_VARS[i][0]) !== '') {
        body.style.removeProperty(CAPTION_VARS[i][0])
      }
    }
  }

  /** Re-assert the caption while showing; cheap, and it survives a theme repaint. */
  var captionTimer = null

  function armCaption() {
    if (captionTimer !== null || !MATCH_CAPTION) return
    captionTimer = setInterval(function () {
      if (api.showing !== true) return
      applyCaption()
    }, 2000)
    if (captionTimer && typeof captionTimer.unref === 'function') captionTimer.unref()
  }

  /* ------------------------------------------------ 6. leaving the page -- */

  var removeTimer = null
  var finished = false

  function finish() {
    if (finished) return
    finished = true
    try {
      video.pause()
    } catch (error) {
      // A pause on an element that never started is not a failure.
    }
    if (root.parentNode) root.parentNode.removeChild(root)
  }

  /**
   * Leave the home page.
   *
   * The film's own level is ramped to zero across the same span the picture
   * fades over, so the music leaves with the picture: cutting the audio at the
   * moment the visual starts dissolving is the one artefact a viewer always
   * hears. A timer, not the frame loop, guarantees the removal — a background
   * tab stops rAF and would otherwise leave the overlay on screen.
   */
  function dismiss(reason) {
    if (api.showing === false) return
    api.showing = false
    api.state = typeof reason === 'string' ? reason : 'dismissed'
    // Before the fade, not after: the caption is the window's, and the window
    // is what the user is returning to.
    restoreCaption()
    if (captionTimer !== null) {
      clearInterval(captionTimer)
      captionTimer = null
    }
    root.setAttribute('data-hidden', '1')
    ramping = true
    var from = video.volume
    var started = Date.now()
    var step = function () {
      var u = (Date.now() - started) / FADE
      if (u >= 1) {
        video.volume = 0
        return
      }
      video.volume = clamp01(from * (1 - u))
      if (api.showing === false && Date.now() - started < FADE) setTimeout(step, 33)
    }
    try {
      step()
    } catch (error) {
      video.volume = 0
    }
    removeTimer = setTimeout(function () {
      ramping = false
      finish()
    }, FADE + 80)
    if (removeTimer && typeof removeTimer.unref === 'function') removeTimer.unref()
  }

  function show() {
    if (api.showing === true) return
    finished = false
    if (removeTimer !== null) {
      clearTimeout(removeTimer)
      removeTimer = null
    }
    api.showing = true
    api.state = 'showing'
    root.removeAttribute('data-hidden')
    root.removeAttribute('data-playfail')
    if (!root.parentNode) host.appendChild(root)
    ramping = false
    applyAudio()
    applyCaption()
    armCaption()
    play()
    armIdle()
  }

  api.show = show
  api.dismiss = dismiss

  /* -------------------------------------------------------- 6. controls -- */

  sound.button.addEventListener('click', function (event) {
    event.preventDefault()
    toggleMute()
  })

  sound.button.addEventListener('wheel', function (event) {
    // A wheel over the panel is a volume gesture, never a page scroll: there is
    // no page to scroll, and the default would be a no-op anyway.
    event.preventDefault()
    nudge(event.deltaY < 0 ? 0.05 : -0.05)
  }, { passive: false })

  esc.button.addEventListener('click', function (event) {
    event.preventDefault()
    dismiss('esc-panel')
  })

  // Starting a refused film needs a gesture; any click that is not on a panel is
  // that gesture. It deliberately does NOT leave the page — the user asked for
  // Esc to be the way out, and a click on the film is how you watch it.
  root.addEventListener('click', function (event) {
    var target = event.target
    if (target === video || target === root) play()
    else if (target !== null && target !== undefined && target.getAttribute
      && target.getAttribute('class') === 'pv-dim') play()
  })

  var idleTimer = null

  function armIdle() {
    if (idleTimer !== null) clearTimeout(idleTimer)
    if (root.getAttribute('data-idle') === '1') root.removeAttribute('data-idle')
    idleTimer = setTimeout(function () {
      idleTimer = null
      if (api.showing === true) root.setAttribute('data-idle', '1')
    }, IDLE_MS)
  }

  function onKeyDown(event) {
    if (api.showing !== true) return
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return
    var target = event.target
    var tag = target === null || target === undefined ? '' : String(target.tagName || '')
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
    var key = event.key
    if (key === 'Escape' || key === 'Esc') {
      // Captured before the application sees it: the interface underneath is
      // covered, and a half-applied Escape (a closed panel the user cannot see)
      // is worse than a consumed one.
      event.preventDefault()
      event.stopPropagation()
      dismiss('esc')
      return
    }
    if (key === 'm' || key === 'M') {
      event.preventDefault()
      toggleMute()
      return
    }
    if (key === 'ArrowUp') {
      event.preventDefault()
      nudge(0.05)
      return
    }
    if (key === 'ArrowDown') {
      event.preventDefault()
      nudge(-0.05)
    }
  }

  // Capture phase, and attached synchronously — before the film has loaded,
  // before any preference has been read, before anything here could go wrong.
  window.addEventListener('keydown', onKeyDown, true)
  window.addEventListener('mousemove', armIdle, { passive: true })

  video.addEventListener('error', function () {
    // The film is not decodable. The page still works and Esc still leaves, so
    // the only thing to get right is not pretending otherwise.
    api.state = 'film-error'
    root.setAttribute('data-playfail', '1')
  })

  video.addEventListener('loadedmetadata', function () {
    if (diag === null) return
    diag.textContent = 'session=' + sessionReset
      + ' dur=' + String(Math.round(video.duration * 100) / 100)
      + ' muted=' + String(video.muted)
      + ' vol=' + String(video.volume)
      + ' state=' + api.state
  })

  // `<body>` does not exist yet — this script is being parsed inside `<head>` —
  // so the caption override is applied at the first moment there is a body to
  // put it on. Both orders work: if this runs before the shell's own appearance
  // probe installs, that probe's first measurement already sees the override;
  // if it runs after, the probe's MutationObserver sees the write.
  if (document.body !== null && document.body !== undefined) applyCaption()
  else document.addEventListener('DOMContentLoaded', function () {
    if (api.showing === true) applyCaption()
  })

  applyAudio()
  applyCaption()
  armCaption()
  play()
  armIdle()

  if (diag !== null) {
    diag.textContent = 'session=' + sessionReset + ' film=' + String(CFG.name)
      + ' bytes=' + String(CFG.bytes) + ' faststart=' + String(CFG.faststart)
      + ' loop=' + String(CFG.loop) + ' muted=' + String(video.muted)
      + ' caption=' + String(MATCH_CAPTION)
    console.info('[pv-home] diag', { config: CFG, info: api.info })
  }
})()
