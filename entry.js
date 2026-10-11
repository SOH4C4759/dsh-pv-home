// dsh-pv-home — Host half.
//
// Three contributions, and the first two are what make a "home page" possible at
// all without touching DSH's own source:
//
//  1. a webserver route serving the PV film (bytes from ./assets/video, with
//     Range support) and a same-origin manifest describing it,
//  2. an index injection whose two head rows install the home screen before the
//     shell boots — and, in the same breath, drop the persisted main-view
//     selection so the window DSH opens underneath is the DEFAULT one rather
//     than the last Session,
//  3. a settings namespace, DECLARED rather than registered (see below).
//
// Why the injection and not a client component: the kernel builds its own boot
// page synchronously inside the shell module script, so a client-side overlay
// always arrives after the interface has already painted — a visible flash of
// the thing the home page is supposed to cover. `webserver/index-inject` head
// rows are spliced directly after `<head>` in the served index, i.e. before that
// module script is even parsed (verified against
// `dsh-host-webserver/lib/index.js`: `renderIndexInjections` puts every
// `placement: 'head'` row at the head's start), so the overlay owns the viewport
// from the first paint.
//
// The same mechanism is what makes "open the default window, not the last
// Session" a one-liner: `dsh-client-ui-workspace` persists its main-view
// selection in `localStorage['dsh.sessions.current']` and restores it in
// `restoreSelection()` once the workspace and session lists are ready. Removing
// that key from a parse-blocking head script happens long before the client
// store rehydrates, so `restoreSelection()` falls through to its blank-session
// branch and the app opens on the default window.
//
// Settings are DECLARED, not registered. Under DSH 0.2.0-rc.2 the Host
// `settings` service has no `register(ns, schema)`: a settings namespace IS a
// plugin entry. `@deepseek-ai/dsh-settings` describes every running entry whose
// resolved module export carries a `Config` schema — keyed by the entry id in the
// profile patch, here `pv-home` — and the browser half pairs with that same
// string through the client `configForms` service. Two consequences are
// load-bearing:
//
//   * `Config` must be a property of the module namespace object, so the schema
//     package has to resolve at module-evaluation time. That is why
//     `@deepseek-ai/schemastery` is a peer dependency (the host supplies its own
//     copy) and never a vendored one.
//   * `describe()` projects only fields marked `.volatile()`, and drops every
//     entry whose projection is empty — a schema with no live field is invisible
//     to the settings page. See `LIVE_CAPABLE`.
//
// The patch id is therefore part of the contract: renaming the `- insert:` id in
// cordis.patch.yml moves the namespace and silently orphans the browser card.

import { closeSync, createReadStream, openSync, readFileSync, readSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { basename } from 'node:path'
import z from '@deepseek-ai/schemastery'

/**
 * Absolute path of the pre-boot home screen source.
 *
 * Read per index render rather than once at module load: pinning it at load time
 * would mean editing a label or the button's look required restarting DSH, which
 * is the one operation this plugin's whole design tries to avoid asking for.
 */
const HOME_SCREEN_PATH = fileURLToPath(new URL('./src/home-screen.js', import.meta.url))

/** Absolute path of the film served as the home page. */
const FILM_PATH = fileURLToPath(new URL('./assets/video/film.mp4', import.meta.url))

/** Absolute path of the display font used for the button's box titles. */
const FONT_PATH = fileURLToPath(new URL('./assets/fonts/SpaceMono-Bold.ttf', import.meta.url))

/** Route prefix the manifest, the film bytes and the font live under. */
const ROUTE = '/plugins/dsh-pv-home'

/**
 * The localStorage key DSH's own workspace controller persists its main-view
 * selection under.
 *
 * It is DSH's key, not this plugin's: `dsh-client-ui-workspace` creates its
 * `selection` store with `persist: { name: 'dsh.sessions.current' }`, and
 * `dsh-client-store`'s `attachPersistence` is a plain `localStorage` get/set of
 * that exact string. Clearing it is the entire mechanism behind "open the
 * default window instead of the last Session", so it is named here as a
 * documented cross-package dependency rather than spelled inline — if DSH ever
 * renames it, this constant is the one place to change.
 */
const SESSION_SELECTION_KEY = 'dsh.sessions.current'

/**
 * The values the screen runs with when the applied config does not carry one.
 *
 * With a `Config` schema present these are unreachable in practice: Cordis
 * validates the profile row against the schema before `apply` runs, so every
 * field arrives already defaulted. They are kept anyway, because the fallback
 * must not depend on the schema having been resolvable — a profile that cannot
 * load the schema package still boots, and this plugin then still serves its
 * film under the documented defaults.
 */
const DEFAULT_SETTINGS = {
  /** Off means nothing is injected at all: no overlay, no localStorage edit, no film request. */
  enabled: true,
  /** Whether the film loops. Off, it plays once and holds on its last frame until Esc. */
  loop: true,
  /** Whether the first visit starts muted. Once the user touches the button, their choice wins. */
  startMuted: true,
  /** Playback level the first visit starts at, 0–1. */
  volume: 1,
  /** Whether the bottom-right "esc" box is drawn. */
  showHint: true,
  /**
   * Whether the persisted main-view selection is dropped on every page load.
   *
   * On, every launch AND every refresh opens the default window, which is what
   * makes this a home page rather than a wallpaper over whatever was open last.
   * Off, DSH behaves as it always did and the film is purely decorative.
   */
  resetSession: true,
  /** How long the dissolve out of the home page takes. */
  fadeMs: 420,
  /** Flat darkening laid over the film, 0–0.7, so the boxes stay readable on a bright frame. */
  dim: 0.18,
  /**
   * Whether the Windows caption buttons take the film's colours while it plays.
   *
   * The window's minimize/maximize/close buttons are drawn by the desktop shell's
   * `titleBarOverlay`, above the page, so a full-bleed dark film otherwise leaves
   * three system-coloured glyphs sitting in the corner of it. The shell measures
   * the page's own palette and repaints the overlay from it, so overriding two
   * CSS variables for as long as the film is up is enough. Off, the caption keeps
   * the application's colours throughout.
   */
  matchCaption: true,
  /**
   * How the film meets a window that is not 16:9: `contain` or `cover`.
   *
   * `cover` fills the window by cropping, and the crop is larger than it sounds:
   * a 1280x820 window (1.56) against a 16:9 film loses 178px horizontally, which
   * is the PV's entire left panel and half of its right one. `contain` shows the
   * complete frame with bars, and this film's background is near-black, so the
   * bars read as part of it.
   */
  fit: 'contain',
}

/**
 * Whether the resolved schemastery can mark a Config field live-editable.
 *
 * `.volatile()` is what makes `dsh-settings` project a field into the form the
 * settings page renders: `volatileForm()` keeps only fields with
 * `meta.volatile`, and `describe()` drops every entry whose projected form is
 * empty. The kernel's copy (inside the app payload) has the method; an older
 * copy linked next to this package might not, and calling it there would throw
 * while this module is being evaluated — taking the routes and the home screen
 * down with the settings card.
 *
 * So the method is probed once and the schema degrades to non-volatile when it
 * is absent. The cost is a hidden settings card; `apply` warns with the fix.
 */
const LIVE_CAPABLE = typeof z.boolean().volatile === 'function'

/** Mark one Config field live-editable, where the schema library allows it. */
function live(schema) {
  return LIVE_CAPABLE ? schema.volatile() : schema
}

/**
 * The well-known key cosmokit puts on a live config reference.
 *
 * `.volatile()` does not yield the value: it yields a stable reference whose
 * `get()` answers the current immutable snapshot, identified across ESM/CJS
 * copies of the library by this global-registry symbol rather than by identity.
 * A plugin therefore reads a volatile field through `get()`.
 */
const VOLATILE_REF = Symbol.for('cosmokit.volatile.write')

/** Whether a config value is a live reference rather than a plain snapshot. */
function isLive(value) {
  return typeof value === 'object' && value !== null && VOLATILE_REF in value
}

/**
 * Read one applied-config field.
 * @param config - the applied config, possibly undefined.
 * @param key - field name.
 * @returns the current value, or undefined when the field is absent.
 */
function readField(config, key) {
  const value = config?.[key]
  return isLive(value) && typeof value.get === 'function' ? value.get() : value
}

/**
 * This entry's Host configuration schema.
 *
 * The namespace is not named here because it is not named anywhere on this side:
 * it is the entry id the profile patch mounts this row under,
 * `- insert: id: pv-home`. `src/client.js` spells that same string in
 * `SETTINGS_NAMESPACE`, and nothing else checks that the two agree.
 */
export const Config = z.object({
  enabled: live(z.boolean().default(DEFAULT_SETTINGS.enabled)),
  loop: live(z.boolean().default(DEFAULT_SETTINGS.loop)),
  startMuted: live(z.boolean().default(DEFAULT_SETTINGS.startMuted)),
  volume: live(z.number().min(0).max(1).default(DEFAULT_SETTINGS.volume)),
  showHint: live(z.boolean().default(DEFAULT_SETTINGS.showHint)),
  resetSession: live(z.boolean().default(DEFAULT_SETTINGS.resetSession)),
  fadeMs: live(z.number().min(150).max(3000).default(DEFAULT_SETTINGS.fadeMs)),
  dim: live(z.number().min(0).max(0.7).default(DEFAULT_SETTINGS.dim)),
  matchCaption: live(z.boolean().default(DEFAULT_SETTINGS.matchCaption)),
  // A plain string rather than a union: the screen treats anything that is not
  // exactly `cover` as `contain`, so an unknown value can never produce a broken
  // video element — only the safe default.
  fit: live(z.string().default(DEFAULT_SETTINGS.fit)),
})

/** Package name the loader mounts this row as. */
export const name = 'dsh-pv-home'

/** Services this half consumes. */
export const inject = ['webServer']

/** Answer one JSON response. */
function sendJson(res, status, value) {
  const body = Buffer.from(JSON.stringify(value), 'utf8')
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(body.byteLength),
    'cache-control': 'no-store',
  })
  res.end(body)
}

/**
 * The film's identity on disk, or undefined when it is not there.
 *
 * The revision is published to the browser as part of the film URL, so replacing
 * `film.mp4` in place — re-exporting the PV, or swapping in a different cut —
 * yields a new URL and cannot be answered from a stale cache entry.
 * @returns `{ bytes, revision }`, or undefined when the film is missing or empty.
 */
function filmInfo() {
  try {
    const info = statSync(FILM_PATH)
    if (!info.isFile() || info.size === 0) return undefined
    return { bytes: info.size, revision: Math.round(info.mtimeMs) }
  } catch {
    // A missing film is not a crash: the home page simply is not injected and
    // DSH opens its own boot page. Reported once per index render by the caller.
    return undefined
  }
}

/**
 * Whether the movie box precedes the media data.
 *
 * A player cannot decode a frame until it has read `moov`, so a file whose
 * `moov` sits at the end must be fetched almost in full before anything appears
 * — the usual reason a home page shows nothing but background for a while.
 *
 * The header window is 64 KiB because the order of the first two boxes is NOT the
 * answer: an MP4 may carry a `uuid` metadata box before the media data, so a 1
 * KiB read can return no verdict at all.
 * @param absolute - resolved film path.
 * @returns true when `moov` comes first, false when `mdat` does, undefined when
 *   neither box is found within the header window.
 */
function readFaststart(absolute) {
  let fd
  try {
    const info = statSync(absolute)
    const head = Buffer.alloc(Math.min(65536, info.size))
    fd = openSync(absolute, 'r')
    // `readSync` answers a byte count, not the `{ bytesRead }` record its async
    // sibling `read` does. Destructuring it here silently scans nothing and
    // reports "unknown" for every file.
    const bytesRead = readSync(fd, head, 0, head.length, 0)
    let offset = 0
    while (offset + 8 <= bytesRead) {
      const type = head.toString('latin1', offset + 4, offset + 8)
      if (type === 'moov') return true
      if (type === 'mdat') return false
      const size = head.readUInt32BE(offset)
      if (size < 8) break
      offset += size
    }
    return undefined
  } catch {
    return undefined
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

/**
 * Parse one `Range` header against a known length.
 * @param header - raw header value, if present.
 * @param size - complete resource length.
 * @returns inclusive byte range, `{ unsatisfiable: true }`, or undefined for a full response.
 */
function parseRange(header, size) {
  if (typeof header !== 'string') return undefined
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (match === null) return undefined
  const [, rawStart, rawEnd] = match
  if (rawStart === '' && rawEnd === '') return undefined
  if (rawStart === '') {
    const length = Number(rawEnd)
    if (!Number.isFinite(length) || length <= 0) return undefined
    return { start: Math.max(size - length, 0), end: size - 1 }
  }
  const start = Number(rawStart)
  if (!Number.isFinite(start) || start >= size) return { unsatisfiable: true }
  const end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1)
  if (!Number.isFinite(end) || end < start) return { unsatisfiable: true }
  return { start, end }
}

/**
 * Stream the film, honouring range requests so the browser can seek and so a
 * repeated load does not re-download bytes it already holds.
 *
 * Nothing about a film response may be stored, for the reason the sibling
 * boot-animation plugin documents at length: the overlay removes its `<video>`
 * when the home page is dismissed, which aborts the in-flight request, so
 * whatever arrived is a TRUNCATED body. Any directive that lets the browser keep
 * it turns that into a poisoned cache entry — and a truncated MP4 with `moov` at
 * the END has no index in the fragment, so it paints nothing on the next normal
 * reload. The cost is one loopback re-read per page load, which is tens of
 * milliseconds for a local file.
 * @param absolute - resolved film path.
 * @param req - incoming request.
 * @param res - outgoing response.
 */
async function serveFile(absolute, type, req, res) {
  const info = statSync(absolute)
  const range = parseRange(req.headers.range, info.size)
  if (range?.unsatisfiable === true) {
    res.writeHead(416, { 'content-range': `bytes */${String(info.size)}` })
    res.end()
    return
  }
  const from = range === undefined ? 0 : range.start
  const to = range === undefined ? info.size - 1 : range.end
  res.writeHead(range === undefined ? 200 : 206, {
    'content-type': type,
    'accept-ranges': 'bytes',
    'cache-control': 'no-store',
    'content-length': String(to - from + 1),
    ...(range === undefined ? {} : {
      'content-range': `bytes ${String(from)}-${String(to)}/${String(info.size)}`,
    }),
  })
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  const stream = createReadStream(absolute, { start: from, end: to })
  stream.on('error', () => { res.destroy() })
  res.on('close', () => { stream.destroy() })
  stream.pipe(res)
}

/**
 * Mount the film routes and the pre-boot index injection.
 * @param ctx - Host plugin context.
 * @param config - the applied config, already validated against `Config`. Each
 *   field arrives as a live reference carrying its defaulted value.
 */
export function apply(ctx, config) {
  const server = ctx.webServer

  if (!LIVE_CAPABLE) {
    ctx.logger?.warn?.(
      'pv-home: the resolved @deepseek-ai/schemastery has no .volatile(), so DSH will not '
      + 'serve this entry as a settings namespace and the settings card stays hidden. Link '
      + 'node_modules/@deepseek-ai/schemastery to the copy the kernel loads.',
    )
  }

  // The settings the screen should run with right now, read per index render
  // rather than cached: a stored edit is committed into these references by the
  // loader without re-running `apply`, and the next page load is exactly when a
  // new value can take effect.
  function currentSettings() {
    try {
      const enabled = readField(config, 'enabled')
      const loop = readField(config, 'loop')
      const startMuted = readField(config, 'startMuted')
      const volume = readField(config, 'volume')
      const showHint = readField(config, 'showHint')
      const resetSession = readField(config, 'resetSession')
      const fadeMs = readField(config, 'fadeMs')
      const dim = readField(config, 'dim')
      const matchCaption = readField(config, 'matchCaption')
      const fit = readField(config, 'fit')
      return {
        enabled: typeof enabled === 'boolean' ? enabled : DEFAULT_SETTINGS.enabled,
        loop: typeof loop === 'boolean' ? loop : DEFAULT_SETTINGS.loop,
        startMuted: typeof startMuted === 'boolean' ? startMuted : DEFAULT_SETTINGS.startMuted,
        volume: typeof volume === 'number' ? volume : DEFAULT_SETTINGS.volume,
        showHint: typeof showHint === 'boolean' ? showHint : DEFAULT_SETTINGS.showHint,
        resetSession: typeof resetSession === 'boolean' ? resetSession : DEFAULT_SETTINGS.resetSession,
        fadeMs: typeof fadeMs === 'number' ? fadeMs : DEFAULT_SETTINGS.fadeMs,
        dim: typeof dim === 'number' ? dim : DEFAULT_SETTINGS.dim,
        matchCaption: typeof matchCaption === 'boolean' ? matchCaption : DEFAULT_SETTINGS.matchCaption,
        fit: typeof fit === 'string' ? fit : DEFAULT_SETTINGS.fit,
      }
    } catch (error) {
      ctx.logger?.warn?.('pv-home: settings unreadable, using defaults', error)
      return DEFAULT_SETTINGS
    }
  }

  const filmUrl = (info) => `${ROUTE}/clip/film.mp4?v=${String(info.revision)}-${String(info.bytes)}`

  // One exact manifest route plus one `/clip` prefix, rather than a prefix on
  // ROUTE. The web server resolves prefixes longest-first, so a prefix on ROUTE
  // would also claim `<ROUTE>/client.js` — the URL the browser fetches for this
  // package's own client bundle, served by client-modules at
  // `/plugins/<package>/client.js`. That request would answer this plugin's 404,
  // the bundle would never materialize, and the settings card would never
  // register. An exact route per fixed resource leaves every other path under
  // ROUTE to its owner.
  ctx.effect(() => server.register({
    kind: 'exact',
    path: `${ROUTE}/film.json`,
    handler: (req, res) => {
      const info = filmInfo()
      if (info === undefined) {
        sendJson(res, 404, { error: 'no film', path: FILM_PATH })
        return
      }
      sendJson(res, 200, {
        film: {
          name: basename(FILM_PATH),
          src: filmUrl(info),
          bytes: info.bytes,
          revision: info.revision,
          faststart: readFaststart(FILM_PATH),
        },
        // The key the home screen clears. Published so a diagnostic page can
        // report what was actually dropped without re-deriving the string.
        sessionSelectionKey: SESSION_SELECTION_KEY,
        settings: currentSettings(),
      })
    },
  }), 'pv-home: film manifest route')

  ctx.effect(() => server.register({
    kind: 'prefix',
    path: `${ROUTE}/clip`,
    handler: (req, res) => {
      const pathname = decodeURIComponent((req.url ?? '').split('?')[0])
      const requested = basename(pathname.slice(`${ROUTE}/clip`.length))
      // Exactly one film is served, by name. Anything else under this prefix is a
      // 404 rather than a path lookup, so there is no directory to traverse and
      // no path building to get wrong: the served file is a module constant.
      if (requested !== basename(FILM_PATH)) {
        sendJson(res, 404, { error: 'not found' })
        return
      }
      void serveFile(FILM_PATH, 'video/mp4', req, res).catch((error) => {
        if (error?.code === 'ENOENT') {
          sendJson(res, 404, { error: 'not found' })
          return
        }
        ctx.logger?.error?.('pv-home: film route failed', error)
        if (!res.headersSent) sendJson(res, 500, { error: 'internal' })
        else res.end()
      })
    },
  }), 'pv-home: film bytes route')

  ctx.effect(() => server.register({
    kind: 'exact',
    path: `${ROUTE}/font/SpaceMono-Bold.ttf`,
    handler: (req, res) => {
      void serveFile(FONT_PATH, 'font/ttf', req, res).catch((error) => {
        if (error?.code === 'ENOENT') {
          // A missing font is cosmetic: the button falls back to Consolas.
          sendJson(res, 404, { error: 'not found' })
          return
        }
        ctx.logger?.error?.('pv-home: font route failed', error)
        if (!res.headersSent) sendJson(res, 500, { error: 'internal' })
        else res.end()
      })
    },
  }), 'pv-home: font route')

  // `ctx.on` already returns a disposer the fiber tracks, so it is registered
  // directly rather than wrapped in an effect — matching the other subscribers
  // of this event (client-modules, ui-theme, client-connection).
  ctx.on('webserver/index-inject', (table) => {
    const settings = currentSettings()

    // Switched off means switched off: no configuration row, no screen script,
    // no localStorage edit and not one request for the film. Injecting a
    // disabled screen and making the script bail out would look the same and
    // leave the whole thing running; this is the only version of "off" that is
    // actually off.
    if (!settings.enabled) return

    const info = filmInfo()
    if (info === undefined) {
      ctx.logger?.warn?.(`pv-home: no film at ${FILM_PATH}; the home page is not injected`)
      return
    }

    // The row reads a plain global the script fills in, so the injection stays
    // JSON-serializable data and the script itself stays a static asset.
    table.push({
      kind: 'script',
      placement: 'head',
      text: `globalThis.__DSH_PV_HOME_CFG__=${JSON.stringify({
        route: ROUTE,
        src: filmUrl(info),
        font: `${ROUTE}/font/SpaceMono-Bold.ttf`,
        name: basename(FILM_PATH),
        bytes: info.bytes,
        faststart: readFaststart(FILM_PATH),
        sessionKey: SESSION_SELECTION_KEY,
        loop: settings.loop,
        startMuted: settings.startMuted,
        volume: settings.volume,
        showHint: settings.showHint,
        resetSession: settings.resetSession,
        fadeMs: settings.fadeMs,
        dim: settings.dim,
        matchCaption: settings.matchCaption,
        fit: settings.fit,
      })}`,
    })
    table.push({ kind: 'script', placement: 'head', text: homeScreenSource() })
  })
}

/**
 * The pre-boot home screen source, re-read on every index render.
 *
 * Synchronous because the injection table is collected synchronously; the file
 * is a few kilobytes and read once per page load, not per request in a hot path.
 * A missing or unreadable file must not blank the page: the caller then serves
 * the kernel page alone, which is the documented fallback.
 * @returns the script text, or an empty string when the source cannot be read.
 */
function homeScreenSource() {
  try {
    return readFileSync(HOME_SCREEN_PATH, 'utf8')
  } catch (error) {
    process.emitWarning(`pv-home: cannot read ${HOME_SCREEN_PATH}: ${String(error)}`)
    return ''
  }
}
