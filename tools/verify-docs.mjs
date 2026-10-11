// Documentation-vs-disk gate.
//
// Doc drift does not break anything locally, which is exactly why it survives to
// the published repository and fails the reader on their first step. So every
// claim the docs make about FILES is checked against the filesystem here rather
// than by reading them over.
//
// It also refuses to publish this machine: an absolute path or a user name in a
// public README is a privacy leak that no other suite would ever notice.
//
//   node tools/verify-docs.mjs
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

let checks = 0
let failures = 0

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

function read(relative) {
  return readFileSync(join(ROOT, relative), 'utf8')
}

const pkg = JSON.parse(read('package.json'))

console.log('package.json 的打包面')
{
  const missing = pkg.files.filter((entry) => !existsSync(join(ROOT, entry)))
  check('files[] 里每一项都在盘上', missing.length === 0, JSON.stringify(missing))
  // The docs tell readers to run these two directories; leaving them out of the
  // tarball is the classic "shipped without the thing you told people to run".
  for (const required of ['tools', 'screensaver']) {
    check('files[] 含 ' + required + '（文档让人去跑的目录）', pkg.files.includes(required), JSON.stringify(pkg.files))
  }
  check('files[] 不把 node_modules 打进去', !pkg.files.includes('node_modules'))
  check('没有 private: true', pkg.private !== true)
  check('声明了 repository', typeof pkg.repository?.url === 'string', JSON.stringify(pkg.repository))
  for (const [key, target] of Object.entries(pkg.exports)) {
    const path = typeof target === 'string' ? target : target.default
    check('exports["' + key + '"] 指向的文件存在', existsSync(join(ROOT, path)), path)
  }
}

console.log('\nREADME 的目录清单')
{
  const readme = read('README.md')
  // NOT `split('```')[1]`: fenced blocks opened with a language tag (```bash)
  // do not close on the same token, and splitting on the raw fence grabs the
  // wrong block entirely — which is how this gate first reported "0 entries"
  // against a README that plainly had 20.
  const lines = readme.split('\n')
  const heading = lines.findIndex((line) => /^##\s*目录/.test(line))
  check('README 有「目录」一节', heading >= 0, 'no heading')
  let open = -1
  let close = -1
  for (let index = heading; index < lines.length && heading >= 0; index++) {
    if (!lines[index].startsWith('```')) continue
    if (open < 0) open = index + 1
    else { close = index; break }
  }
  const block = open >= 0 && close > open ? lines.slice(open, close).join('\n') : ''
  const gitignore = read('.gitignore')

  // Each entry is `<path>  <说明>`; a path may use shell brace expansion
  // (`tools/install-live.{ps1,sh}`), so those are expanded rather than skipped.
  const names = []
  for (const line of block.split('\n')) {
    const token = line.trim().split(/\s+/)[0]
    if (token === undefined || !/^[A-Za-z0-9_./{},-]+$/.test(token)) continue
    if (!token.includes('.') && !token.includes('/')) continue
    const braced = token.match(/^(.*)\{([^}]+)\}(.*)$/)
    if (braced !== null) {
      for (const option of braced[2].split(',')) names.push(braced[1] + option + braced[3])
    } else {
      names.push(token)
    }
  }
  check('目录清单解析到条目', names.length >= 8, JSON.stringify(names))

  for (const name of names) {
    if (name.startsWith('node_modules/')) {
      check('目录里的 ' + name + ' 是被 .gitignore 排除而非提交的',
        gitignore.includes('node_modules/'), name)
      continue
    }
    if (name.startsWith('assets/video/')) {
      check('目录里的影片条目按「不随仓库发布」处理，且 .gitignore 有对应规则',
        gitignore.includes('assets/video/*.mp4'), name)
      continue
    }
    check('目录里的 ' + name + ' 存在', existsSync(join(ROOT, name)), name)
  }
}

console.log('\n自检套件的清单')
{
  const onDisk = readdirSync(join(ROOT, 'tools'))
    .filter((name) => name.startsWith('verify-') && name.endsWith('.mjs') && name !== 'verify-all.mjs')
    .sort()
  const declared = [...read('tools/verify-all.mjs').matchAll(/\['(verify-[a-z-]+\.mjs)'/g)]
    .map((match) => match[1])
    .sort()
  check('verify-all 声明了全部套件', JSON.stringify(onDisk) === JSON.stringify(declared),
    'disk=' + JSON.stringify(onDisk) + ' declared=' + JSON.stringify(declared))
  const readme = read('README.md')
  for (const name of onDisk) {
    check('README 提到了 ' + name, readme.includes(name), 'not mentioned')
  }
}

console.log('\nAGENTS.md 的规则编号')
{
  const agents = read('AGENTS.md')
  const numbers = [...agents.matchAll(/^\*\*(\d+)\.\s/gm)].map((match) => Number(match[1]))
  check('至少有一条编号规则', numbers.length >= 5, JSON.stringify(numbers))
  // Contiguity from 1 is the check that matters: a copied-in rule that keeps the
  // old number, or a deleted one that leaves a hole, both read as "the list is
  // fine" until someone counts.
  const contiguous = numbers.every((value, index) => value === index + 1)
  check('编号从 1 连续且无重复', contiguous, JSON.stringify(numbers))
}

console.log('\n不许把本机发出去')
{
  const documents = ['README.md', 'MANUAL.md', 'NOTICE.md', 'AGENTS.md', 'package.json', 'cordis.patch.yml']
  const forbidden = [
    /[A-Za-z]:\\\\?Users\\\\/,
    /\bAdministrator\b/,
    /[A-Za-z]:\\CodeProj/,
    /[A-Za-z]:\\VideoProj/,
    /gho_[A-Za-z0-9]{20,}/,
    /SESSDATA/,
  ]
  for (const document of documents) {
    const text = read(document)
    const hit = forbidden.find((pattern) => pattern.test(text))
    check(document + ' 不含本机路径 / 用户名 / 凭据', hit === undefined,
      hit === undefined ? '' : String(hit))
  }
}

console.log('\n' + (failures === 0 ? 'verify-docs: PASS' : 'verify-docs: FAIL')
  + ' (' + String(checks - failures) + '/' + String(checks) + ')')
process.exit(failures === 0 ? 0 : 1)
