window.__ModuleLoader__.load({ id: "dsh-pv-home", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
/*
 * dsh-pv-home — browser half.
 *
 * One contribution: the card that appears under 设置 → 插件. The home screen
 * itself is NOT built here and must not be: it is the head-injected script in
 * src/home-screen.js, which runs before this bundle is even fetched. This half
 * exists so the feature has a face — a switch to turn it off, the values that
 * decide what the screen does, a preview button, and an honest report of the
 * film the Host is actually serving.
 *
 * Two wiring facts are load-bearing, and both were paid for by the sibling
 * boot-animation plugin before this one existed:
 *
 *   * The card must be contributed through `ctx.inject([...], cb)` rather than a
 *     one-shot `ctx.get('slots')`. This bundle may be applied before ui-settings
 *     is; a single `get` at that moment reads "service absent", which is
 *     indistinguishable from "service does not exist", and the card silently
 *     never appears.
 *   * The write path must prefer the PAGE's own `form` prop over the injected
 *     scope. On the desktop build the page's form is the channel the kernel
 *     actually wires up; a card that writes only through `configForms` renders,
 *     opens, closes, and does nothing at all, with no error anywhere.
 */
;(function () {
  'use strict'

  /** The settings namespace. This string is the patch id in cordis.patch.yml. */
  const SETTINGS_NAMESPACE = 'pv-home'

  /** The Plugins page's official-plugin list slot. */
  const SLOT = 'plugins.item'

  /** Locale namespace for this card's own strings. */
  const LOCALE_NAMESPACE = 'pvHome'

  const DICTIONARY_ZH = { title: '主页' }
  const DICTIONARY_EN = { title: 'Home page' }

  /** The Host's own manifest for the film it is serving. */
  const MANIFEST = '/plugins/dsh-pv-home/film.json'

  const FADE_CHOICES = [200, 420, 800, 1500]
  const DIM_CHOICES = [0, 0.18, 0.35, 0.5]
  const VOLUME_CHOICES = [0.25, 0.5, 0.75, 1]
  const FIT_CHOICES = ['contain', 'cover']

  /** Stable empty snapshot, so `getSnapshot` never returns a fresh object. */
  const NO_SNAPSHOT = Object.freeze({
    status: 'unavailable', value: undefined, base: undefined, user: undefined,
    revision: undefined, writable: false, mode: 'host',
  })

  const STYLE_ID = 'dsh-pv-home-card-style'

  // Token names and geometry are copied from the harness's own plugin card so
  // this reads as a shipped card rather than a guest. Each token keeps a literal
  // fallback for a page with no theme loaded.
  const CSS = [
    '.pvhome-card{list-style:none;border:.5px solid var(--dsw-alias-border-l4,rgba(127,127,127,.28));',
    'border-radius:16px;background:var(--dsw-alias-bg-layer-3,transparent);',
    'transition:border-color .16s,background .16s;font-family:inherit}',
    '.pvhome-card:hover{border-color:var(--dsw-alias-label-dimmed,rgba(127,127,127,.5))}',
    '.pvhome-card[data-open="1"]{background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.07));',
    'border-color:var(--dsw-alias-label-dimmed,rgba(127,127,127,.5))}',
    '.pvhome-head{width:100%;appearance:none;border:0;background:none;font:inherit;color:inherit;',
    'text-align:left;cursor:pointer;display:flex;align-items:center;gap:12px;padding:14px 16px;border-radius:12px}',
    '.pvhome-head:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4f9dd9);outline-offset:-2px}',
    '.pvhome-headtext{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}',
    '.pvhome-name{font-size:15px;font-weight:600;line-height:1.4;color:var(--dsw-alias-label-primary,inherit)}',
    '.pvhome-desc{font-size:13px;line-height:1.5;color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.9))}',
    '.pvhome-chev{flex:none;width:7px;height:7px;margin-right:3px;',
    'border-right:1.5px solid var(--dsw-alias-label-tertiary,rgba(127,127,127,.9));',
    'border-bottom:1.5px solid var(--dsw-alias-label-tertiary,rgba(127,127,127,.9));',
    'transform:rotate(45deg);transition:transform .16s}',
    '.pvhome-card[data-open="1"] .pvhome-chev{transform:rotate(225deg)}',
    '.pvhome-body{border-top:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.2));',
    'margin:0 16px;padding:14px 0 10px}',
    '.pvhome-sec{margin:0 0 18px}',
    '.pvhome-sec:last-child{margin-bottom:4px}',
    '.pvhome-h{font-size:13px;font-weight:600;line-height:1.5;margin:0 0 3px;',
    'color:var(--dsw-alias-label-primary,inherit)}',
    '.pvhome-p{margin:0 0 10px;font-size:12px;line-height:1.5;',
    'color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.9))}',
    '.pvhome-row{display:flex;flex-wrap:wrap;gap:6px}',
    '.pvhome-switch{display:inline-flex;align-items:center;gap:9px;cursor:pointer}',
    '.pvhome-switch input{margin:0;flex:none}',
    '.pvhome-opt{border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.34));background:none;',
    'color:inherit;border-radius:8px;padding:5px 12px;font:inherit;font-size:12.5px;cursor:pointer}',
    '.pvhome-opt:hover:not(:disabled){background:rgba(127,127,127,.14)}',
    '.pvhome-opt[data-on="1"]{border-color:var(--dsw-alias-brand-primary,#07974b);',
    'color:var(--dsw-alias-brand-primary,#07974b);font-weight:600;background:rgba(7,193,96,.1)}',
    '.pvhome-opt:disabled{opacity:.45;cursor:default}',
    '.pvhome-badge{font-size:11px;line-height:1.5;padding:1px 7px;border-radius:999px;white-space:nowrap;',
    'background:rgba(127,127,127,.18);color:var(--dsw-alias-label-secondary,rgba(127,127,127,.95))}',
    '.pvhome-badge.warn{background:rgba(210,120,40,.18);color:#b46214}',
    '.pvhome-badge.bad{background:rgba(210,74,67,.18);color:#d24a43}',
    '.pvhome-meta{font-size:11.5px;color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.8));white-space:nowrap}',
    '.pvhome-msg{margin-top:8px;font-size:11.5px;line-height:1.5;',
    'color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.8))}',
    '.pvhome-msg.err{color:var(--dsw-alias-label-error,#d24a43)}',
    '.pvhome-film{display:flex;align-items:center;gap:9px;flex-wrap:wrap;padding:6px 2px}',
    '.pvhome-nm{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px}',
    '.pvhome-code{font-family:Consolas,ui-monospace,monospace;font-size:11.5px;',
    'background:rgba(127,127,127,.16);border-radius:4px;padding:1px 5px}',
  ].join('')

  /** Install the card's stylesheet once per document. */
  function ensureStyle() {
    if (document.getElementById(STYLE_ID) !== null) return
    const style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = CSS
    document.head.appendChild(style)
  }

  /** Human-readable byte count. */
  function formatBytes(value) {
    if (typeof value !== 'number' || !isFinite(value) || value <= 0) return '-'
    if (value < 1024) return String(value) + ' B'
    if (value < 1024 * 1024) return (value / 1024).toFixed(0) + ' KB'
    return (value / 1024 / 1024).toFixed(2) + ' MB'
  }

  /** `m:ss` for a duration in seconds, or a status word while it is unknown. */
  function formatDuration(seconds) {
    if (typeof seconds !== 'number' || !isFinite(seconds) || seconds <= 0) return '…'
    const whole = Math.round(seconds)
    const minutes = Math.floor(whole / 60)
    const rest = whole - minutes * 60
    return String(minutes) + ':' + (rest < 10 ? '0' : '') + String(rest)
  }

  /**
   * The summary answer: one line, as a string.
   *
   * The page puts it inside a clamped `<span>` on the list and inside a `<p>` on
   * the detail page, so returning an element here would nest a block inside a
   * paragraph and be clipped to one line anyway.
   * @returns the one-line description.
   */
  function PvHomeSummary() {
    return 'PV 全屏主页 · Esc 返回默认窗口 · 音量按钮'
  }

  /**
   * The reader/writer pair for this card.
   *
   * Exactly the shape the shipped configuration pages consume: an observable
   * `{ subscribe, getSnapshot }` source for `useSyncExternalStore`, a `mutate`
   * for writes, and an unfenced remote retry used only to learn WHY a write was
   * refused (`mutate` answers a bare `false` and swallows the reason).
   * @param props - the slot's inject face plus the page's owner props.
   * @returns the reader/writer pair.
   */
  function cardForm(props) {
    const pageForm = props.form
    const scope = props.scope
    const observable = pageForm !== undefined && pageForm !== null
      && typeof pageForm.subscribe === 'function' && typeof pageForm.getSnapshot === 'function'
    const observableScope = scope !== undefined && scope !== null
      && typeof scope.subscribe === 'function' && typeof scope.getSnapshot === 'function'
    const source = observable ? pageForm : (observableScope ? scope : null)

    let fallback = NO_SNAPSHOT
    if (pageForm !== undefined && pageForm !== null && pageForm.state !== undefined) fallback = pageForm.state
    else if (scope !== undefined && scope !== null && typeof scope.getSnapshot === 'function') fallback = scope.getSnapshot()
    else if (observableScope) fallback = scope.getSnapshot()

    const mutate = (() => {
      if (pageForm !== undefined && pageForm !== null && typeof pageForm.mutate === 'function') {
        return (ops, revision) => pageForm.mutate(ops, revision)
      }
      if (scope !== undefined && scope !== null && typeof scope.mutate === 'function') {
        return (ops, revision) => scope.mutate(ops, revision)
      }
      return null
    })()

    const remoteMutate = (() => {
      const remote = props.remote
      const settings = remote !== undefined && remote !== null ? remote.settings : undefined
      if (settings !== undefined && settings !== null && typeof settings.mutate === 'function') {
        return (namespace, ops, revision) => settings.mutate(namespace, ops, revision)
      }
      return null
    })()

    return { source, fallback, mutate, remoteMutate }
  }

  /**
   * The configuration page.
   * @param props - the slot's inject face plus the page's owner props.
   * @returns the card element.
   */
  function PvHomePage(props) {
    const React = props.runtime
    const [open, setOpen] = React.useState(false)
    const [film, setFilm] = React.useState(null)
    const [probe, setProbe] = React.useState(null)
    const [failure, setFailure] = React.useState(null)
    const [busy, setBusy] = React.useState(false)
    const [live, setLive] = React.useState(null)

    ensureStyle()

    const form = cardForm(props)
    const source = form.source
    const subscribe = React.useCallback(
      (listener) => (source === null ? function () {} : source.subscribe(listener)),
      [source],
    )
    const readSnapshot = React.useCallback(
      () => (source === null ? form.fallback : source.getSnapshot()),
      [source, form.fallback],
    )
    const snapshot = React.useSyncExternalStore(subscribe, readSnapshot)
    const stored = (snapshot && snapshot.value) || {}

    // Every switch is read the way the Host reads it — absent means the
    // documented default — so a profile written before a field existed still
    // renders that field at its shipped value.
    const enabled = stored.enabled !== false
    const loop = stored.loop !== false
    const startMuted = stored.startMuted !== false
    const showHint = stored.showHint !== false
    const resetSession = stored.resetSession !== false
    const volume = typeof stored.volume === 'number' ? stored.volume : 1
    const fadeMs = typeof stored.fadeMs === 'number' ? stored.fadeMs : 420
    const dim = typeof stored.dim === 'number' ? stored.dim : 0.18
    const matchCaption = stored.matchCaption !== false
    const fit = stored.fit === 'cover' ? 'cover' : 'contain'

    // The manifest, and the film's real length. The length comes from a throwaway
    // media element rather than from the container: the browser's own decode is
    // the only answer that also says whether this film can play at all.
    React.useEffect(() => {
      if (!open || film !== null) return undefined
      let alive = true
      fetch(MANIFEST, { cache: 'no-store' })
        .then((response) => (response.ok ? response.json() : Promise.reject(new Error('HTTP ' + String(response.status)))))
        .then((body) => { if (alive) setFilm(body) })
        .catch((error) => { if (alive) setFailure('读取影片清单失败：' + String(error && error.message ? error.message : error)) })
      return () => { alive = false }
    }, [open, film])

    React.useEffect(() => {
      if (!open || film === null || probe !== null) return undefined
      const src = film.film && film.film.src
      if (typeof src !== 'string') return undefined
      let alive = true
      const element = document.createElement('video')
      const settle = (verdict) => { if (alive) setProbe(verdict) }
      element.preload = 'metadata'
      element.muted = true
      element.addEventListener('loadedmetadata', () => {
        settle({ seconds: element.duration, width: element.videoWidth, height: element.videoHeight, refused: false })
      })
      element.addEventListener('error', () => settle({ refused: true }))
      element.src = src
      return () => {
        alive = false
        element.removeAttribute('src')
      }
    }, [open, film, probe])

    // What the injected screen is doing right now. Read on demand rather than
    // subscribed: the overlay is not a store, and a stale answer is only a
    // curiosity — the controls above are the part that matters.
    React.useEffect(() => {
      if (!open) return undefined
      const read = () => {
        const overlay = globalThis.__DSH_PV_HOME__
        setLive(overlay === undefined || overlay === null
          ? { available: false, state: '未注入' }
          : { available: overlay.available === true, state: String(overlay.state) })
      }
      read()
      const timer = setInterval(read, 1000)
      return () => clearInterval(timer)
    }, [open])

    /**
     * Stage one field write.
     *
     * The operation is the settings service's own `SettingsPathOp` shape — one
     * atomic `set` at a top-level path — so the same call works whether the page
     * handed us its configuration form or we fell back to the injected scope.
     * @param field - config field name.
     * @param value - the value to store.
     */
    const write = (field, value) => {
      if (form.mutate === null) {
        setFailure('这一页没有连上设置文档，改动不会保存。')
        return
      }
      setBusy(true)
      setFailure(null)
      const revision = snapshot === undefined || snapshot === null ? undefined : snapshot.revision
      const ops = [{ op: 'set', path: [field], value }]
      Promise.resolve(form.mutate(ops, revision))
        .then(async (accepted) => {
          if (accepted !== false) return
          if (form.remoteMutate === null) {
            setFailure('保存失败：本部署没有接受这次修改。')
            return
          }
          try {
            const answer = await form.remoteMutate(SETTINGS_NAMESPACE, ops, undefined)
            if (answer !== null && typeof answer === 'object' && answer.ok === false) {
              const reason = answer.error === undefined || answer.error === null
                ? '未说明原因'
                : String(answer.error.message ?? answer.error)
              setFailure('保存失败：' + reason)
            } else {
              setFailure('保存失败：本部署没有接受这次修改。')
            }
          } catch (error) {
            setFailure('保存失败：' + String(error))
          }
        })
        .catch((error) => setFailure('保存失败：' + String(error)))
        .then(() => setBusy(false))
    }

    const switchRow = (field, label, onNote, offNote, checked) => React.createElement('div', {
      className: 'pvhome-sec',
      key: field,
    },
    React.createElement('label', { className: 'pvhome-switch' },
      React.createElement('input', {
        type: 'checkbox',
        checked,
        disabled: busy,
        onChange: (event) => write(field, event.target.checked),
      }),
      React.createElement('span', { className: 'pvhome-h', style: { margin: '0' } }, label)),
    React.createElement('div', { className: 'pvhome-p', style: { marginTop: '6px', marginBottom: '0' } },
      checked ? onNote : offNote))

    const optionRow = (field, value, choices, render) => React.createElement('div', { className: 'pvhome-row' },
      choices.map((choice) => React.createElement('button', {
        key: String(choice),
        type: 'button',
        className: 'pvhome-opt',
        'data-on': choice === value ? 1 : 0,
        disabled: busy,
        onClick: () => write(field, choice),
      }, render(choice))))

    const header = React.createElement('button', {
      type: 'button',
      className: 'pvhome-head',
      'aria-expanded': open,
      'aria-label': (open ? '收起' : '展开') + '：主页',
      onClick: () => { setOpen(!open) },
    },
    React.createElement('span', { className: 'pvhome-headtext' },
      React.createElement('span', { className: 'pvhome-name' }, '主页'),
      React.createElement('span', { className: 'pvhome-desc' }, PvHomeSummary())),
    React.createElement('span', { className: 'pvhome-chev' }))

    try {
      if (!open) {
        return React.createElement('li', { className: 'pvhome-card', 'data-open': '0' }, header)
      }

      const sections = []

      sections.push(React.createElement('div', { className: 'pvhome-sec', key: 'enabled' },
        React.createElement('label', { className: 'pvhome-switch' },
          React.createElement('input', {
            type: 'checkbox',
            checked: enabled,
            disabled: busy,
            onChange: (event) => write('enabled', event.target.checked),
          }),
          React.createElement('span', { className: 'pvhome-h', style: { margin: '0' } }, '开启主页')),
        React.createElement('div', { className: 'pvhome-p', style: { marginTop: '6px', marginBottom: '0' } },
          enabled
            ? '关掉并刷新页面，就回到 DSH 原生启动页——不注入覆盖层，也不发影片请求'
            : '已关闭：刷新页面后是 DSH 原生启动页，下面的设置暂时不生效')))

      sections.push(React.createElement('div', { className: 'pvhome-sec', key: 'behaviour-head' },
        React.createElement('div', { className: 'pvhome-h' }, '打开时的行为'),
        React.createElement('div', { className: 'pvhome-p', style: { marginBottom: '0' } },
          '这些都在下次刷新页面时生效')))

      sections.push(switchRow('resetSession', '打开默认窗口而不是上次会话', '每次启动和刷新都会落到 DSH 的默认窗口，主页返回后也是它',
        '保留 DSH 原本的「恢复上次会话」行为，主页只当背景图', resetSession))
      sections.push(switchRow('loop', '循环播放', '影片循环播放，按 Esc 随时返回',
        '影片放一遍后停在最后一帧，按 Esc 返回', loop))
      sections.push(switchRow('startMuted', '首次默认静音', '第一次打开是静音的，点音量按钮或按 M 开声音',
        '第一次打开就尝试带声播放（浏览器不允许时会自动退回静音）', startMuted))
      sections.push(switchRow('showHint', '显示 esc 提示框', '右下角除了音量按钮，还有「返回 DSH 界面」',
        '只留音量按钮', showHint))
      sections.push(switchRow('matchCaption', '标题栏跟随影片配色',
        '主页播放时，右上角那三个窗口按钮变成影片的深色；返回界面时恢复',
        '右上角窗口按钮始终跟随应用主题', matchCaption))

      sections.push(React.createElement('div', { className: 'pvhome-sec', key: 'volume' },
        React.createElement('div', { className: 'pvhome-h' }, '初始音量'),
        optionRow('volume', volume, VOLUME_CHOICES, (choice) => String(Math.round(choice * 100)) + '%'),
        React.createElement('div', { className: 'pvhome-p', style: { marginTop: '8px', marginBottom: '0' } },
          '只决定第一次打开的音量。之后你在主页上调过的音量会被记住，并优先于这个值。')))

      sections.push(React.createElement('div', { className: 'pvhome-sec', key: 'fade' },
        React.createElement('div', { className: 'pvhome-h' }, '返回时的淡出时长'),
        optionRow('fadeMs', fadeMs, FADE_CHOICES, (choice) => String(choice) + ' ms'),
        React.createElement('div', { className: 'pvhome-p', style: { marginTop: '8px', marginBottom: '0' } },
          '影片声音在同一个时长里一起收到 0，所以退场不会有一刀切的断音。')))

      sections.push(React.createElement('div', { className: 'pvhome-sec', key: 'fit' },
        React.createElement('div', { className: 'pvhome-h' }, '画面适配'),
        optionRow('fit', fit, FIT_CHOICES, (choice) => (choice === 'contain' ? '完整呈现' : '铺满裁切')),
        React.createElement('div', { className: 'pvhome-p', style: { marginTop: '8px', marginBottom: '0' } },
          fit === 'cover'
            ? '铺满窗口，画面按比例放大到填满为止——超出的部分被裁掉。窗口越不像 16:9，裁得越多（1280×820 的窗口左右各裁 89px）。'
            : '整幅 16:9 画面完整显示，多出来的地方留黑边。片子本身底接近纯黑，黑边基本看不出来。')))

      sections.push(React.createElement('div', { className: 'pvhome-sec', key: 'dim' },
        React.createElement('div', { className: 'pvhome-h' }, '画面压暗'),
        optionRow('dim', dim, DIM_CHOICES, (choice) => (choice === 0 ? '不压暗' : String(Math.round(choice * 100)) + '%')),
        React.createElement('div', { className: 'pvhome-p', style: { marginTop: '8px', marginBottom: '0' } },
          '平铺在影片上的一层暗色，让按钮在明亮的画面上也清楚。设为 0 就是原片不动。')))

      // The film the Host is actually serving. This is the one place a missing or
      // unoptimised file becomes visible to the user rather than a mystery.
      const filmNodes = []
      if (film === null) {
        filmNodes.push(React.createElement('div', { className: 'pvhome-msg', key: 'loading' }, '正在读取…'))
      } else if (film.film === undefined || film.film === null) {
        filmNodes.push(React.createElement('div', { className: 'pvhome-msg err', key: 'missing' },
          'Host 没有在 assets/video/ 里找到影片，所以主页不会被注入。'))
      } else {
        const badges = [React.createElement('span', { className: 'pvhome-badge', key: 'len' },
          formatDuration(probe && probe.seconds))]
        if (probe && probe.refused === true) {
          badges.push(React.createElement('span', {
            className: 'pvhome-badge bad',
            key: 'refused',
            title: '浏览器拒绝解码这个文件：可能是编码档次不被支持，或文件不完整。',
          }, '浏览器播不了'))
        }
        if (probe && typeof probe.width === 'number' && probe.width > 0) {
          badges.push(React.createElement('span', { className: 'pvhome-badge', key: 'res' },
            String(probe.width) + '×' + String(probe.height)))
        }
        if (film.film.faststart === false) {
          badges.push(React.createElement('span', {
            className: 'pvhome-badge warn',
            key: 'moov',
            title: '索引表(moov)在文件末尾：浏览器要整段下载完才出画面，主页会先黑一会儿。',
          }, '未优化'))
        }
        filmNodes.push(React.createElement('div', { className: 'pvhome-film', key: 'film' },
          React.createElement('span', { className: 'pvhome-nm', title: film.film.name }, film.film.name),
          badges,
          React.createElement('span', { className: 'pvhome-meta' }, formatBytes(film.film.bytes))))
        filmNodes.push(React.createElement('div', { className: 'pvhome-msg', key: 'session' },
          '每次加载清理的恢复点：',
          React.createElement('span', { className: 'pvhome-code' },
            String(film.sessionSelectionKey === undefined ? 'dsh.sessions.current' : film.sessionSelectionKey))))
      }

      sections.push(React.createElement('div', { className: 'pvhome-sec', key: 'film' },
        React.createElement('div', { className: 'pvhome-h' }, '影片'),
        React.createElement('div', null, filmNodes)))

      // Preview and leave, for the times the settings page is where the user is.
      sections.push(React.createElement('div', { className: 'pvhome-sec', key: 'preview' },
        React.createElement('div', { className: 'pvhome-h' }, '预览'),
        React.createElement('div', { className: 'pvhome-row' },
          React.createElement('button', {
            type: 'button',
            className: 'pvhome-opt',
            disabled: !(live && live.available),
            onClick: () => {
              const overlay = globalThis.__DSH_PV_HOME__
              if (overlay && typeof overlay.show === 'function') overlay.show()
            },
          }, '显示主页'),
          React.createElement('button', {
            type: 'button',
            className: 'pvhome-opt',
            disabled: !(live && live.available),
            onClick: () => {
              const overlay = globalThis.__DSH_PV_HOME__
              if (overlay && typeof overlay.dismiss === 'function') overlay.dismiss('preview')
            },
          }, '返回界面')),
        React.createElement('div', { className: 'pvhome-p', style: { marginTop: '8px', marginBottom: '0' } },
          live === null
            ? '正在查询主页状态…'
            : (live.available ? '主页已注入，当前状态：' + live.state : '这一页没有检测到主页脚本：' + live.state))))

      return React.createElement('li', { className: 'pvhome-card', 'data-open': '1' },
        header,
        React.createElement('div', { className: 'pvhome-body' },
          sections,
          failure === null ? null : React.createElement('div', { className: 'pvhome-msg err' }, failure)))
    } catch (error) {
      // A card that cannot draw itself must still leave the settings page usable.
      return React.createElement('li', { className: 'pvhome-card', 'data-open': '1' },
        header,
        React.createElement('div', { className: 'pvhome-body' },
          '主页设置面板渲染失败：' + String(error && error.message ? error.message : error)))
    }
  }

  /**
   * The Plugins page asks every entry twice through the same component:
   * `view: 'summary'` for the row and `view: 'page'` for the configuration
   * section. Two components rather than two branches of one, because the summary
   * answer calls no hooks and the page answer calls seven — one component
   * returning early for one view would be a conditional hook call, which React
   * throws on, leaving a card that is present and dead.
   * @param props - the slot's inject face plus the page's owner props.
   * @returns the requested view.
   */
  function PvHomeEntry(props) {
    return props.view === 'summary' ? PvHomeSummary() : PvHomePage(props)
  }

  /**
   * Read one awaited service from the injected owner context.
   * @param owner - the context passed to the inject callback.
   * @param name - service name.
   * @returns the service, or undefined when it is not reachable.
   */
  function serviceAt(owner, name) {
    try {
      if (owner !== null && owner !== undefined && typeof owner.get === 'function') {
        const value = owner.get(name)
        if (value !== undefined && value !== null) return value
      }
    } catch (error) {
      // A global-store miss is the expected miss; the property may still answer.
    }
    try {
      return owner === null || owner === undefined ? undefined : owner[name]
    } catch (error) {
      return undefined
    }
  }

  /**
   * Contribute the settings card if the shell is willing.
   * @param ctx - Client plugin context.
   */
  exports.apply = function apply(ctx) {
    try {
      let React = null
      try {
        React = require('react')
      } catch (error) {
        React = null
      }
      if (React === null || typeof React.createElement !== 'function') return
      if (ctx === undefined || ctx === null || typeof ctx.inject !== 'function') return

      ctx.inject(['slots', 'locale', 'configForms'], (owner) => {
        try {
          const slots = serviceAt(owner, 'slots')
          const locale = serviceAt(owner, 'locale')
          const forms = serviceAt(owner, 'configForms')
          if (slots === undefined || slots === null || typeof slots.inject !== 'function') return
          if (forms === undefined || forms === null || typeof forms.get !== 'function') return
          if (typeof forms.whileServed !== 'function') return

          if (locale !== undefined && locale !== null && typeof locale.register === 'function') {
            const dictionaries = () => locale.register(LOCALE_NAMESPACE, {
              zh: DICTIONARY_ZH,
              en: DICTIONARY_EN,
            })
            if (typeof owner.effect === 'function') owner.effect(dictionaries, 'pv-home: dictionaries')
            else dictionaries()
          }
          const t = locale !== undefined && locale !== null && typeof locale.bind === 'function'
            ? locale.bind(LOCALE_NAMESPACE)
            : function (key) { return DICTIONARY_ZH[key] === undefined ? key : DICTIONARY_ZH[key] }

          // Registration is idempotent, and that is load-bearing. `slots.register`
          // throws when a list slot already holds an entry with the same id, and
          // that throw lands inside the slot ledger's store notification — which
          // React's own subscription rides. A duplicate registration therefore
          // does not merely log: it kills the card's updates while leaving the
          // rendered DOM in place, i.e. a visible card that is dead to mouse and
          // keyboard. Disposing the previous registration before registering
          // again, and owning the failure so it never reaches the store, is what
          // makes a re-entry harmless.
          let registration = null
          const contribute = function () {
            if (registration !== null) return
            try {
              registration = slots.inject(SLOT, () => slots.register(
                {
                  name: SLOT,
                  id: SETTINGS_NAMESPACE,
                  order: 61,
                  label: () => t('title'),
                  locale: LOCALE_NAMESPACE,
                  // Read lazily: the scope binds when the slot actually renders.
                  inject: () => ({ runtime: React, scope: forms.get(SETTINGS_NAMESPACE) }),
                },
                PvHomeEntry,
              ))
            } catch (error) {
              registration = null
              console.warn('pv-home: settings card not registered', error)
            }
          }
          const withdraw = function () {
            if (registration === null) return
            const dispose = registration
            registration = null
            try {
              if (typeof dispose === 'function') dispose()
            } catch (error) {
              console.warn('pv-home: settings card not withdrawn', error)
            }
          }
          const serve = function () {
            return forms.whileServed([SETTINGS_NAMESPACE], function () {
              contribute()
              return withdraw
            })
          }
          if (typeof owner.effect === 'function') owner.effect(serve, 'pv-home: settings page')
          else serve()
        } catch (error) {
          console.warn('pv-home: settings card not registered', error)
        }
      })
    } catch (error) {
      // The card is a convenience; the home page is the feature.
      console.warn('pv-home: settings card wiring failed', error)
    }
  }
})()

return module.exports; } });
