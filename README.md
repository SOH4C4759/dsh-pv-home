# dsh-pv-home

把一支 PV 当作 **DeepSeek Harness 的主页**：

- **打开 DSH 就是它** —— 默认窗口而不是上一次的会话窗口，全屏循环播放，刷新也一样；
- **按 Esc 返回** —— 退回 DSH 界面，落点是默认窗口（空白会话），不是被恢复的旧对话；
- **PV 风格的音量按钮** —— 点击静音/取消，滚轮调音量，`M` / `↑` / `↓` 同效，选择会被记住。

**不改 DSH 本体源码**，升级 DSH 不受影响。

> 片源与署名：影片是非官方同人作品 **《如果聊天窗口就是她的整个世界 —— world.execute(me)》**（B 站 [BV1xCai6aE9g](https://www.bilibili.com/video/BV1xCai6aE9g/)，上传者 西西弗斯的风车；出片代码 [MisakaZentai/world-execute-me-dsh-pv](https://github.com/MisakaZentai/world-execute-me-dsh-pv)）。
> 角色美术 **CC BY-NC-SA 4.0（非商用）**，音乐权利属 Mili。完整署名链与条款见 **[NOTICE.md](NOTICE.md)** —— 分享前请先读它。

## 先看哪一份

| 文档 | 给谁 | 内容 |
|---|---|---|
| **[MANUAL.md](MANUAL.md)** | 用它的人 | 设置在哪、按键是什么、出问题怎么办、怎么关掉 |
| **[AGENTS.md](AGENTS.md)** | 接手维护的人 / AI | 架构、**不许破坏的规则**（每条都是踩出来的）、改动后要不要重启、怎么自检 |
| 本文件 | 想追根究底的人 | 机制、坑、目录、验证边界 |

## 它长什么样

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│                  （影片：全屏、cover、循环）                  │
│                                                              │
│                                                              │
│   ┌ / esc ─────┐                        ┌ / sound ─────────┐ │
│   │ 返回 DSH 界面│                        │ ▮▮▮▮▮▮▮▮▮▮ on 100% │ │
│   └─────────────┘                        └──────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

两个面板不是「照感觉画的」，它们抄的是影片自己的渲染器
（`tuikit.py` 的 `box()` 与 `PALETTES.deepsea`）：

- **母题**：1px 边框、四角 7px 加亮短线、标题压在边框上并从标题背景抠出缺口（标题左偏移 12px 是那里的常量）；
- **配色**：底 `#04070F`、系统色 `#C8D6EA`、品牌蓝 `#4D6BFE`、异常黄 `#FFCC00`；
- **字体**：标题用影片同一支 **Space Mono Bold**（SIL OFL 1.1，随包），正文 Consolas，中文微软雅黑。

静音时面板整体转成异常黄 —— 和影片里「系统出事了」是同一个语义。鼠标 3.2 秒不动，面板自动降到 34% 不透明度，动一下就回来。

## 它是怎么接进去的

三件事，全在 DSH 已经提供的接缝上：

**1. 抢在界面之前占住视口。** 内核的启动页是在 shell 模块脚本里同步构造的，所以任何客户端组件都太晚 —— 会先闪一下界面。插件在 Host 侧订阅 `webserver/index-inject`，往 `<head>` 的开头插两行解析阻塞脚本（`dsh-host-webserver` 的 `renderIndexInjections` 把 `placement:'head'` 的行拼在 head 最前），于是覆盖层从**第一帧**就在。

**2. 把默认窗口还回去。** DSH 的 workspace 控制器把自己的「当前会话」持久化在 `localStorage['dsh.sessions.current']`（`dsh-client-ui-workspace` 的 `selection` store，`dsh-client-store` 的 `attachPersistence` 就是一个朴素的 localStorage 读写）。注入脚本在解析期把这个键删掉 —— 那时任何模块都还没跑，客户端 store 也还没 rehydrate —— 于是 `restoreSelection()` 走它的空白会话分支，DSH 打开的就是默认窗口。**这一句就是「打开默认窗口而不是上一次的会话窗口」的全部实现。**

> 空白会话是**复用**的，不是每次新建一个堆积起来：`connectWorkspace()` 会先在这个工作区里找 cwd 相同、且仍是空白的会话并用它（`reuseOrCreateBlank`）。只有上一个已经被你聊过（不再是空白）时，才会开一个新的。所以「每次打开都是新会话」等于「每次回到空白会话」，旧对话照旧在侧边栏里。

**3. 影片与字体由 Host 路由送出。** 三条路由：清单与字体是 `exact`，影片是 `/clip` 前缀。**前缀绝不能压在 `ROUTE` 本身**：`client-modules` 在本包名下 `/plugins/dsh-pv-home/client.js` 送自己的浏览器产物，前缀压在 ROUTE 上会把那个请求吃掉，产物加载不到，设置卡片永远不会出现。

设置是**声明**而不是注册：0.2.0-rc.2 之后 `settings.register(ns, schema)` 没有了，命名空间就是一个插件条目 —— 模块导出上有 `Config`（schemastery schema）即可，命名空间就是 profile patch 里的 entry id（`pv-home`），浏览器半侧在 `SETTINGS_NAMESPACE` 里写同一个字符串。**字段必须标 `.volatile()`**：`describe()` 只投影 volatile 字段，一个都没有就整条隐藏。

### 桌面端也走这条路（已核实）

Electron 那个窗口不是自定义 scheme，而是**同一个 web server**：
`@deepseek-ai/dsh-desktop-host/lib/index.js` 用 `dsh-web-app` 跑 profile `desktop`、`--port 19387`，然后把
`ctx.connection.authenticatedUrl(...)` 得到的 URL 和 **`ctx.webServer.collectIndexInjections()`** 一起 IPC 给 Electron。
所以同一个页面既被服务端把 head 行拼进 HTML，又可能通过 boot payload 在客户端再执行一次 —— 注入脚本的幂等守卫（见 [AGENTS.md](AGENTS.md) 规则 3）因此是必须的，不是防御性编程。


## 设置

**设置 → 插件 → 「主页」**（和其他插件一样是收起的，点一下才展开）：

| 项 | 默认 | 作用 |
|---|---|---|
| **开启主页** | 开 | 总开关。关掉是**完全不注入**：没有覆盖层、不清理恢复点、不发一次影片请求，回到 DSH 原生启动页 |
| **打开默认窗口而不是上次会话** | 开 | 关掉就保留 DSH 原本的「恢复上次会话」，主页只当背景图 |
| **循环播放** | 开 | 关掉是放一遍后停在最后一帧，按 Esc 返回 |
| **首次默认静音** | 开 | 第一次打开静音（浏览器只保证允许静音自动播放）。**你点过一次之后，你的选择优先于这个值** |
| **显示 esc 提示框** | 开 | 关掉只留音量按钮 |
| **初始音量** | 100% | 只决定第一次打开；之后以你在主页上调过的为准 |
| **返回时的淡出时长** | 420 ms | 影片声音在同一个时长里一起收到 0，所以退场没有一刀切的断音 |
| **画面压暗** | 18% | 平铺在影片上的一层暗色，让面板在明亮画面上也清楚；设 0 就是原片不动 |
| **标题栏跟随影片配色** | 开 | 主页播放时把右上角那三个窗口按钮调成影片的深色，返回时恢复（机制见下） |
| **画面适配** | 完整呈现 | `contain`＝整幅 16:9 完整显示、多余处留黑边；`cover`＝铺满窗口并按比例裁掉超出部分（见下） |

改完**刷新页面生效**，不用重启 DSH。卡片里还有一对「显示主页 / 返回界面」按钮可以就地预览，以及 Host 实际在送的影片信息（时长、分辨率、字节数、`moov` 是否前置）。

## 按键

| 操作 | 发生什么 |
|---|---|
| **Esc** | 返回 DSH 界面（从第一帧起就有效，影片坏没坏都一样） |
| 点提示框 / 点音量按钮 | 分别是返回、切换静音 |
| `M` | 切换静音 |
| `↑` / `↓` / 滚轮 | 音量 ±5% |
| 点画面 | 若影片被浏览器拦下没开始播，这一下就是它要的手势（不会返回） |

音量与静音记在 `localStorage['dsh.pv-home.prefs']` 里，换片、刷新都不丢。

## 换片

**先说清楚：本仓库不带影片。** `assets/video/film.mp4` 不在 Git 里，而且是有意如此的——那支 PV 的**音乐是 Mili 的作品、没有随附的再分发授权**，把 40 MB 的文件放进公开仓库等于再分发那段音乐（角色美术那部分按 CC BY-NC-SA 4.0 是可以带署名分享的，音乐不是）。完整的署名链与各自条款见 [NOTICE.md](NOTICE.md)。

所以第一次用之前，自己放一份到 `assets/video/film.mp4`：

```powershell
# 出处：Bilibili BV1xCai6aE9g（上传者 西西弗斯的风车）。请按上方 NOTICE 的条款使用。
yt-dlp -f "bv*+ba/b" -o "assets/video/film.mp4" "https://www.bilibili.com/video/BV1xCai6aE9g/"
```

放好之后**不用改代码、不用重新构建**。清单与 URL 里的版本号按 `mtime-字节数` 生成，同名覆盖会得到新 URL，不会被旧缓存糊弄。影片缺失时插件有兜底：主页照常挂载、注入照常发生，只是没有影片可放，控制台与清单里会说明原因（`verify-injection.mjs` 有一条断言盯着这条兜底路径）。

换成你自己拍的片子也一样。真片子请守这几条：

| 项 | 建议 | 原因 |
|---|---|---|
| 容器 | **`moov` 必须在文件最前** | 否则浏览器要整段下载完才出画面，主页会先黑一会儿。原片已实测 moov 在偏移 32；`ffmpeg -movflags +faststart` 可以补齐 |
| 轨道 | 带音轨 | 静音起播，点按钮出声 |
| 画幅 | 16:9 | 默认 `object-fit: contain` 会完整呈现，比例不符时留黑边而不是裁画面；想铺满裁切在设置里切 |
| 时长 | 任意（会循环） | 主页常驻，按 Esc 随时走 |

设置卡片会自己探「浏览器播不了 / 未优化」并给你原因。

## 装法

**路一：免重启（当前已用）** —— 建一个 `node_modules` 目录链接 + 往 profile 的 `cordis.patch.yml` 追加一行 insert。

```powershell
sh tools/install-live.sh         # macOS / Linux
powershell -File tools\install-live.ps1   # Windows
```

跑完**刷新浏览器**即可。

**路二：正式依赖（推荐最终状态）** —— 路一不写依赖声明，profile 里以后任何一次 `pnpm install`（例如用 `dsh plugin add` 装别的插件）都可能把这个未声明的链接剪掉，而 patch 行还在，那时 DSH 会因为「行解析不到包」起不来。

```bash
dsh plugin --profile desktop add link:F:/CodeProj/dsh-pv-home
```

装完**完全退出并重开 DSH**。撤销用 `remove`，或把 patch 里那行 insert 删掉。

> ⚠️ **`link:` 安装时，包内需要一个 `node_modules/@deepseek-ai/schemastery`。** `entry.js` 是**静态**导入它（`Config` 必须是模块导出对象的属性），而 ESM 解析不认 `NODE_PATH`，只从导入文件所在目录逐级往上找 `node_modules`。`link:` 装法下本包的真实路径在 profile 之外，上一级没有 `node_modules` —— 少了包内那份，**整个模块求值就失败，路由和主页一起没了**。
>
> 两种装法的区别，按你的情况挑：
> - **`link:` 装法**（本机当前用法）：自己放一份，或者从内核那支复制过来。必须是内核在用的 3.18.4+（`.volatile()` 存在于该版本）。仓库**没有**提交这份副本（`.gitignore` 里排除了 `node_modules/`），因为提交包管理器目录是仓库腐烂的开始。
> - **装进 profile 的 `node_modules`**（普通的 `npm install`）：profile 自己那层就有 `@deepseek-ai/schemastery`，解析得到，包内不需要副本。
>
> `tools/verify-asset.mjs` 有一条断言盯着这件事；`tools/verify-all.mjs` 在解析不到它时会**跳过**需要它的两套并打印原因，而不是假装通过。

>
> 连带的一个后果：如果把本包**打包成 tarball** 分发，`package.json` 的 `files` 不含 `node_modules`，那份副本会丢。`link:` 安装不受影响（整目录链接）；真要打包分发，得先解决这个依赖怎么随包走。

## 右上角那三个窗口按钮

它们不是这个页面画的：桌面壳用的是 `titleBarStyle: 'hidden'` + `titleBarOverlay`，颜色属于 **Electron 主进程**。但页面握着一条官方接缝 —— 壳的 preload 一直在测量页面自己的 `--dsw-specific-sidebar-fill` 与 `--dsw-alias-label-primary`，经 `dsh-desktop:windows-appearance` 把结果送给主进程，主进程校验后调 `setTitleBarOverlay`。所以**主页播放期间，把这两个变量写在 `document.body` 上**（内联样式在那个子树里赢过任何样式表规则），右上角就变成影片的深色；返回时删掉，应用配色立刻回来。顺带还免费触发了那个 MutationObserver —— 因为这两次写入本身就是 body 的 style。

**它做不到的**：改**字形**。那三个符号由系统绘制，只有颜色和高度是可寻址的；换形状必须动 Electron 主进程，那不是插件该做的事。所以这个功能是「让它们融进画面」，不是「换一套按钮」。

「与 dsh-boot-animation 的关系」见下一节；主页以外的地方它们本来就跟主题一致，不需要动。

## 画面适配：为什么默认不铺满

原来写的是 `object-fit: cover`（铺满），这是个**错的默认值**。`cover` 会按比例放大到填满窗口，超出部分直接裁掉，而裁掉多少取决于窗口比例差多少 —— 不是一点点。

实测：一个 **1280×820** 的窗口（比例 1.561）放 16:9 的片子，要填满高度就得横向放大到 1458px，于是**左右各裁掉 89px**。片子里左边那个 dsh 聊天窗口、右边一半的 TUI 世界，就这么没了。窗口越扁，裁得越狠。

现在默认 `object-fit: contain`：**整幅画面完整呈现**，代价是上下各 50px 黑边 —— 而这片子本身的底色就接近纯黑，黑边基本看不出来。想铺满裁切的话，设置里能切回去。

（"把视频本身裁成窗口的比例"是另一条路，但那等于永久丢掉画面内容，和"完整呈现"正好相反，所以没做。）

## 锁屏时也播放它

**先说清楚 Windows 的限制**：锁屏界面只接受**静态图**（或图片幻灯片），**不支持视频**，第三方程序也没有任何办法在安全桌面上画东西。真正会「播放」的只有**屏保** —— 所以这一半做成了屏保：空闲触发、全屏循环播放这支 PV，配合 `ScreenSaverIsSecure=1`（恢复时要求登录）实际效果就是「回来一看，刚才在放它」。

**从侧栏那颗锁屏按钮点进来**（`dsh-lock-button` 插件）：那边默认就是「先播放 PV」，做法是带 `/lock` 启动这个屏保 —— 放完片、一动鼠标，屏保退出时自己调 `LockWorkStation()` 落到登录界面。所以那条链路是：**按钮 → 屏保放 PV → 退出时锁屏**，而不是「按钮 → 立刻锁屏」。

```
screensaver/src/PvScreensaver.cs   WPF 屏保源码（MediaElement + 每显示器一个窗口）
screensaver/build.ps1              用系统自带的 csc.exe 编译，并跑两项探针
screensaver/install.ps1            复制到 %LOCALAPPDATA%\dsh-pv-home + 设置注册表 + 立即生效
screensaver/uninstall.ps1          还原安装前的四项注册表值并删文件
```

```powershell
powershell -ExecutionPolicy Bypass -File screensaver\build.ps1      # 编译 + 自检
powershell -ExecutionPolicy Bypass -File screensaver\install.ps1    # 安装（默认 10 分钟、恢复需登录）
cmd /c "%LOCALAPPDATA%\dsh-pv-home\PvScreensaver.scr" /s            # 立刻看一次
```

`install.ps1` 的参数：`-TimeoutMinutes 5`、`-Secure 0`（恢复不要密码）、`-Muted 0`（开声音）、`-Volume 0.4`、`-Screens primary`（只在一台显示器上放）、`-Video <别的片子>`。它**只写** `HKCU\Control Panel\Desktop` 下的四项（`SCRNSAVE.EXE` / `ScreenSaveActive` / `ScreenSaveTimeOut` / `ScreenSaverIsSecure`），先把旧值备份成 JSON，再用 `SystemParametersInfo` 推进当前会话，所以不用注销。

### 默认静音，以及那个「双重播放」

**默认静音**（`muted=1`）。屏保是在没人在场时触发的，第一版会自己唱起来 —— 那是我做错了，不是你的设置问题。

更要紧的是它背后那个**结构性 bug**，也是「双重播放」的来源：这台机器有**两块显示器**，而 `/s` 给每块屏幕各建一个窗口、各有一个 `MediaElement`。同一条音轨被解码两遍，相差几毫秒叠加在一起 —— 听感上不是回声，是一条**发闷、加倍**的音轨。所以现在加了**音频归属规则**：

> **无论开几个窗口，只有一个窗口能出声**（主显示器那个）。其余的一律 `IsMuted`，且永远不会被取消静音。

「双重播放」如果是说**两块屏都看到画面**，那是 `screens=all` 的预期行为（声音仍然只有一路）。想只在一块屏上放：

```powershell
powershell -ExecutionPolicy Bypass -File screensaver\install.ps1 -Screens primary
```

多窗口之间还会各自漂移（每个窗口独立解码），所以主窗口每 20 秒会被当作时钟对一次，**偏差超过 400 ms 才 seek** —— 阈值不是容差：seek 一次有肉眼可见的卡顿，比这点偏差更难看。

三个实测细节留在这里，因为它们都是「不踩一次不会知道」：

- **`.scr` 在注册表里的关联是 `"%1" /S`**：用 ShellExecute 启动（`Start-Process`、双击）会**强行追加 `/S`**，你传的参数会被丢掉。所以构建脚本用 `cmd /c`（CreateProcess）。反过来，这也意味着**双击这个 .scr 就是运行屏保**，正是想要的行为。
- **没有屏保能配的参数**：`/c` 只弹一个说明框，告诉你改哪个 ini。片名、静音、音量、放哪几块屏都在 `pv-screensaver.ini` 里。
- **多显示器**：每台显示器一个窗口、各自循环，但只有一路声音。`/geom` 探针会报告窗口落点**和音频归属数**（本机实测 `windows=2 scale=1 audioWindows=0`（静音）/ `audioWindows=1`（有声），两块 2560×1440，DIP 落点 `0,0` 与 `2560,0`）。
- **DSH 主页如果还开着**，屏保启动时它不会自己停 —— 屏保已静音，所以你只会听到主页那一路。想彻底安静就先按 Esc 离开主页。
- **`/lock` 参数**：给屏保加这个参数，它退出时会调 `LockWorkStation()`。空闲触发的路径不需要它（`ScreenSaverIsSecure=1` 已经保证恢复时要登录），只有"手动启动"才需要 —— 否则退出屏保就等于把桌面还给你，那不叫锁屏。参数位置无关，`/geom <file> /lock` 这种调用也认。
- **抢焦点**：被别的进程启动的屏保不会自动成为前台窗口，所以它 `Loaded` 时会调 `SetForegroundWindow` —— 否则第一次按键会打到它背后的窗口上，什么都不发生（鼠标移动仍然有效，因为鼠标消息跟着指针走 —— 正是那种"半能用"最值得提前修掉）。

## 与 dsh-boot-animation 的关系

本机 desktop profile 里原本装着 `dsh-boot-animation`（启动动画：播一段片子再溶解进界面）。它和「主页」是两回事：启动动画会**先播 8–15 秒再交接**，如果两个都开着，你会先看一段启动动画、再看到这个主页。

因此安装时把它那一行改成了 `enabled: false`（它自己的开关，不是禁用插件）。**想恢复**：把 `profiles/desktop/cordis.patch.yml` 里

```yaml
- id: boot-animation
  name: dsh-boot-animation
  config:
    fadeMs: 2000
```

加上 `enabled: true` 即可。两者共存是能跑的，只是会连播两段影片。

## 已经验证到哪一步（2026-10-11，desktop profile）

**在真实运行进程里验证过的**（`http://127.0.0.1:19387`，插件路由不需要令牌）：

| 事实 | 怎么验的 |
|---|---|
| patch 行解析到了包、模块求值成功、`Config` 被投影 | `cordis_inspect_query` 的 Config 条目：`patchId: pv-home`、`status: schema`、`packageDir` 指向 profile 的 node_modules，9 个字段都带 `x-cordis.volatile: true` |
| 路由注册进了真实的 web server | `GET /plugins/dsh-pv-home/film.json` → 200，`cache-control: no-store`，`faststart: true`，字节数与磁盘一致 |
| 配置读取走的是真实的 volatile 引用 | 同一份清单里的 `settings` 就是 `readField()` 读出来的当前值 |
| Range 语义正确 | `bytes=0-63` → 206 / `content-range: bytes 0-63/40111552`；`bytes=-64` → 206 后缀；越界 → 416 带 `bytes */40111552` |
| HEAD 与不可缓存 | 200 + `content-length`，`no-store` |
| 本包 `client.js` 没被自己的路由截胡 | 该请求回的是框架的 404（无 `content-type`），不是本插件的 JSON 404 |
| 字体路由 | 200，98232 字节，`font/ttf` |
| **影片在本机真的能解码** | 屏保的 `/selftest` 走 Media Foundation 打开同一个文件：`result=ok width=1920 height=1080 seconds=211 audio=True` |
| 屏保的多显示器几何与音频归属 | `/geom`：`windows=2 scale=1`，两块 2560×1440，DIP 落点 `0,0` / `2560,0`；`muted=1 → audioWindows=0`、`muted=0 → audioWindows=1`（**两个方向都断言过**，这就是「双重播放」的回归测试） |
| `/lock` 参数真的被解析 | `/geom` 探针：不带参数 `lockOnExit=False`，带 `/lock`（放在第三个位置）`lockOnExit=True` |
| 画面不再被裁 | 桩 DOM：默认样式表里是 `object-fit:contain`，显式给 `cover` 时才变成 `cover`；实机量到 1280×820 窗口下 `cover` 会左右各裁 89px |
| 屏保已装成当前用户的屏保 | 注册表四项：`SCRNSAVE.EXE` 指向安装副本、`ScreenSaveActive=1`、`ScreenSaveTimeOut=600`、`ScreenSaverIsSecure=1`；旧值已备份成 JSON |

**没有端到端验证的那一步，说清楚**：把两行 head 注入真的拼进**服务端返回的那个 index HTML**，我没抓到——启动令牌是进程内生成的（`BrowserAuth` 的 `launchToken` 不落盘），拿不到就没有令牌去换 cookie，首页只会回 401。这一步的依据是**读源码**（`renderIndexInjections` 把 `placement:'head'` 的行拼在 head 最前）+ 桌面宿主确实调用了 `collectIndexInjections()` + 同机制的 `dsh-boot-animation` 在本机有既成事实。

另外，**「在真浏览器里看起来怎么样」不在任何自动化覆盖里**：桩 DOM 能证明「Esc 会移除节点」，证明不了「面板在真主题下好不好看」；`/selftest` 能证明 Media Foundation 解得开这个文件，证明不了窗口铺满屏幕好不好看。**视觉与听感只能靠刷新页面看一眼，屏保只能靠跑一次 `/s`。**

## 目录

```
entry.js                  Host 半侧：影片/字体路由 + head 注入 + Config
src/home-screen.js        注入进 <head> 的主页脚本（无框架，必须在 shell 之前跑）
src/client.js             浏览器半侧：「设置 → 插件」里的卡片
lib/client.js             构建产物（window.__ModuleLoader__.load 闭包工厂）
build-client.mjs          产物构建：仓库外的包拿不到共享 preset，自己复现那五行外壳
cordis.patch.yml          bundle 层：一条 `- insert: id: pv-home`
assets/video/film.mp4     影片 —— **不随仓库发布**，自己放一份（见「换片」）
assets/video/film.source.json  影片出处与抓取记录
assets/fonts/SpaceMono-Bold.ttf + OFL_spacemono.txt   面板标题用的字体与其许可
node_modules/@deepseek-ai/schemastery   内核那支 3.18.4 的副本（静态导入必需）
tools/stub-dom.mjs        桩 DOM：让注入脚本真跑起来
tools/verify-*.mjs        六套离线自检
tools/install-live.{ps1,sh} / uninstall-live.{ps1,sh}   免重启接线与撤销
screensaver/              屏保：C# 源码 + 编译/安装/卸载脚本（见上一节）
```

## 离线自检

```bash
node build-client.mjs      # 改了 src/client.js 之后重新出产物
node tools/verify-all.mjs  # 跑全部六套
```
| 检查 | 覆盖的契约 |
|---|---|
| `verify-docs.mjs` | **文档与磁盘不许漂移**：`files[]` 每项在盘上、且含文档让人去跑的 `tools`/`screensaver`、没有 `private: true`、`exports` 每项存在；README 目录清单里每个路径都存在（`node_modules/` 与影片条目改断言「被 .gitignore 排除而非提交」，而不是断言它存在）；`verify-all` 声明的套件集合与盘上一致；AGENTS.md 的规则编号从 1 连续无洞；**README/MANUAL/NOTICE/AGENTS/package.json 里不许出现本机绝对路径、用户名或凭据** |
| `verify-injection.mjs` | 恰好两行 head 注入且**配置行在脚本行之前**、总开关关掉时**一行都不注入**、影片缺失时不注入但留告警、路由形态（清单/字体是 exact，影片是 `/clip` 前缀，**没有任何前缀压在 ROUTE 上**）、volatile 引用与普通值两种配置形态都能读 |
| `verify-routes.mjs` | 挂真 HTTP 服务器打真请求：清单、整片逐字节、Range 206（首段/中段/后缀）、416、HEAD、404、目录穿越、伪造扩展名、**本包 `client.js` 不被自己的路由截胡**、字体逐字节 |
| `verify-home-screen.mjs` | 把注入脚本加载进桩 DOM 推真事件：挂在 `documentElement` 而非 `body`、**重复执行不会挂出第二个覆盖层**、清理恢复点且只动那一个键、存储不可用时不炸、**Esc 从第一帧起有效**（含播放被拒、解码失败两种情形）、音量按钮的点击/滚轮/键盘三条路径与记住的选择、电平表按音量取整 |
| `verify-client-bundle.mjs` | 产物外壳契约、只向加载器要 `react`、**不许出现 `ctx.get(`（必须先剥注释）**、summary 视图回字符串、卡片真渲染并**驱动开关断言写出的 op 与 revision**、被拒时走远端复核并显示原因、四种残缺上下文都不抛 |
| `verify-asset.mjs` | 影片盒子链 `ftyp→moov→…→mdat`、moov 在文件前 1 MiB、H.264+AAC 双轨、从 `mvhd` 读出的片长、字体是 TrueType 且随附 OFL、出处记录与署名链完整、包内 schemastery 在位 |

它证明不了的那一步必须说清楚：**这些都不包含「在真浏览器里看起来怎么样」**。桩 DOM 能证明「Esc 会移除节点」，证明不了「面板在真主题下好不好看」，也证明不了影片在 Chromium 里真的解码出画面。视觉与听感只能靠你看一眼 —— 这是本插件唯一没有自动化覆盖的边界。

诊断：地址加 `?dshpvdiag=1`，左上角会显示 `session=cleared dur=211.9 muted=true vol=1 state=showing` 这样的实时读数，控制台另有一份配置与清理结果。
