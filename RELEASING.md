# 发版

这个仓库的构建与发布**在 DSH 里点**：侧边栏图标 → 发布台（`dsh-plugin-cicd`）→ 找到
`SOH4C4759/dsh-pv-home` 这一行。行上的按钮顺序就是工作顺序：**提交 → 构建 → 发布**。

没有面板时（或要打 tag）走下面这三条。

## 1. 升版本、提交、推送

`release.yml` 用的是 `package.json` 的版本号，而它**有意拒绝复用属于另一个提交的同号
Release**（否则 tag 与已上传的资产会静默地指向不同提交）。所以树往前走了而版本没升，
发布的运行会在第一步就红掉。

```powershell
# 改 package.json 的 version，然后
git add -A
git commit -F <把提交信息写进文件再交给 git -F，别在命令行里塞中文>
git push origin main
```

`github.com:443` 被间歇阻断时（`git push` 报 `Connection was reset`）用发布台自带的
逐 SHA 推送脚本，它会顺手更新 `origin/main`，避免面板误报「领先 N」：

```powershell
powershell -File F:\CodeProj\dsh-plugin-cicd\scripts\push-via-api.ps1
```

## 2. 打 tag（或手动触发）

```powershell
git tag v0.2.0
git push origin v0.2.0
```

不想打 tag 也可以手动触发，默认产出**草稿**：

```powershell
gh workflow run release.yml -R SOH4C4759/dsh-pv-home -f draft=true
```

⚠ `gh workflow run` 返回成功只代表「运行被接受了」。失败发生在约 10 秒后的第一步——
别用 dispatch 的退出码判断发布成功，去看那一行的状态。

## 3. 发布物的两个形状

| 资产 | 用途 |
|---|---|
| `<name>-<version>.zip` | 整棵树，给人看、可 diff |
| `<name>-<version>.tgz` | **可安装的那份**：`dsh plugin add file:<tarball>` |
| `SHA256SUMS.txt` | 上面两个的校验和 |

## 四道门禁（都在 `release.yml` 里，不是靠人记）

1. **tag 必须等于 `v` + `package.json` 的 version**——推错提交或忘了升版本会响亮地失败，
   而不是发布出一份漂移的包。
2. **拒绝复用属于另一个提交的版本号**（见第 1 节）。
3. **成片绝不能进发布包**。影片是 git-ignored 的，因为它的音乐没有再分发授权
   （见 `NOTICE.md`）——把 `assets/video/*.mp4` 打进发布资产等于再分发一首我们无权
   转手的曲子。检出里本来就没有它，所以这道门禁查的是**构建出来的资产**，
   而那正是 `files` 白名单写错时会露出来的地方（对 zip 与 tgz 各查一遍）。
4. **对解包后的资产跑自检**，不是对检出跑——证明的是**发布出去的那些字节**可用。
   缺少某个依赖或影片时，自检会打印带原因的 SKIP 并如实上报环境，不会假装通过。

## npm

GitHub Release 给人下载，npm 给 `dsh plugin add <名字>` 一条命令装完。两条路：

- **在这台机器上推一次**：发布台行上的【推送到 npm vX】。它走 DSH 自带的 `pnpm publish`，
  凭据从 `~/.npmrc` 读（Granular Access Token，可写 token 默认强制 2FA、最长 90 天），
  被拒时会把 npm 的原话归类成下一步。**没有 provenance**。
- **CI 自动发布（推荐用于正式版本）**：npm 的 trusted publishing（GitHub Actions OIDC）——
  `release.yml` 加 `id-token: write` 并在 npm 上登记本仓库，发布时用 OIDC 换一次性凭据，
  不存任何长期 token，还自带 provenance。需要 token 时放仓库 secret，不放这台机器。

⚠ 名字在 npm 上是先到先得，公开名 `dsh-pv-home` **已经被本项目的账号预留**为
`0.0.0-stage` 占位包（2026-10-11 核实）。首次发布真版本时它是 `unregistered`→发布即覆盖
那个占位。发之前先确认 `package.json` 的 `private` 不是 `true`（本仓库为空，可发）。
