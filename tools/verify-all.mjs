// Offline self-check for dsh-pv-home. No network, no DSH, no system changes.
//
//   node tools/verify-all.mjs
//
// Each suite is a separate process so one crashing cannot hide the others'
// results. Output is inherited rather than captured: a sandbox that forbids
// named pipes makes piped child stdio fail with EPERM, and a self-check that
// cannot run is worse than one that prints its own output.
//
// Two suites depend on things a fresh clone legitimately does not have, and a
// gate that goes red for a correct checkout trains people to ignore it. Both are
// SKIPPED with the reason printed, never silently passed:
//
//   verify-injection / verify-routes  need @deepseek-ai/schemastery, the
//       kernel's schema library. It is a peerDependency resolved from the
//       PROFILE's node_modules on a normal install, and from a vendored copy
//       under `link:` installs; neither exists in a bare checkout.
//   verify-asset  needs assets/video/film.mp4, which is deliberately not
//       published (the film's music carries no redistribution grant). See
//       .gitignore and README.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const require = createRequire(import.meta.url)

const SUITES = [
  ['verify-injection.mjs', 'Host 半侧：两行 head 注入、总开关、影片缺失兜底、路由形态'],
  ['verify-routes.mjs', '影片路由：清单、整片、Range 206/416、HEAD、404、遮蔽陷阱'],
  ['verify-home-screen.mjs', '注入脚本：桩 DOM 真跑，清理恢复点、Esc、音量按钮、幂等'],
  ['verify-client-bundle.mjs', '浏览器产物：加载器外壳、卡片渲染、写入路径、接线'],
  ['verify-asset.mjs', '素材：moov 前置、双轨、片长、字体许可、署名链'],
]

/** Whether the kernel's schema library resolves from this checkout. */
function hasSchemaLibrary() {
  try {
    require.resolve('@deepseek-ai/schemastery', { paths: [ROOT] })
    return true
  } catch (error) {
    return false
  }
}

/**
 * The reason to skip a suite, or null to run it.
 *
 * `entry.js` imports the schema library at module scope, so anything that
 * imports entry.js cannot even be loaded without it — the skip is structural,
 * not a tolerance setting.
 */
function skipReason(script, environment) {
  if ((script === 'verify-injection.mjs' || script === 'verify-routes.mjs') && !environment.schemaLibrary) {
    return '解析不到 @deepseek-ai/schemastery（entry.js 在模块顶层静态导入它）'
  }
  if (script === 'verify-asset.mjs' && !environment.film) {
    return '没有 assets/video/film.mp4 —— 影片按权利原因不随仓库发布，放一份你自己的再跑'
  }
  return null
}

const environment = {
  schemaLibrary: hasSchemaLibrary(),
  film: existsSync(join(ROOT, 'assets', 'video', 'film.mp4')),
}

console.log('environment: schemastery=' + (environment.schemaLibrary ? 'resolved' : 'missing')
  + '  film=' + (environment.film ? 'present' : 'missing'))

const results = []
for (const [script, what] of SUITES) {
  console.log('\n' + '='.repeat(78))
  console.log('▶ ' + script + ' — ' + what)
  console.log('='.repeat(78))
  const reason = skipReason(script, environment)
  if (reason !== null) {
    console.log('  SKIP  ' + reason)
    results.push([script, 'skip', reason])
    continue
  }
  const result = spawnSync(process.execPath, [join(ROOT, 'tools', script)], {
    cwd: ROOT,
    stdio: 'inherit',
  })
  results.push([script, result.status])
}

console.log('\n' + '='.repeat(78))
let failed = 0
let skipped = 0
let passed = 0
for (const [script, status, reason] of results) {
  if (status === 'skip') {
    skipped++
    console.log('  SKIP  ' + script + ' — ' + reason)
    continue
  }
  const ok = status === 0
  if (ok) passed++
  else failed++
  console.log((ok ? '  PASS  ' : '  FAIL  ') + script + (ok ? '' : ' (exit ' + String(status) + ')'))
}
console.log('='.repeat(78))
const summary = String(passed) + ' 通过 / ' + String(skipped) + ' 跳过 / ' + String(SUITES.length) + ' 套'
console.log(failed === 0 ? 'verify-all: PASS — ' + summary : 'verify-all: FAIL — ' + summary)
process.exit(failed === 0 ? 0 : 1)
