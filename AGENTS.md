# AGENTS.md — 接手维护这份代码要守的规则

给下一个改它的人（或 AI）。每条下面都写了**为什么**，因为这些都是踩出来的，不是风格偏好。

## 架构一页

```
Host 半侧（entry.js）                         浏览器
─────────────────────────────                ─────────────────────────────
Config（schemastery，8 个 volatile 字段）─┐
webserver/index-inject ──────────────────┼──> <head> 两行：
  row1: globalThis.__DSH_PV_HOME_CFG__   │      1) 配置全局
  row2: src/home-screen.js（原文注入）    │      2) 主页脚本
                                          │         ├─ localStorage.removeItem('dsh.sessions.current')
路由 /plugins/dsh-pv-home/…              │         └─ 建覆盖层：<video> + 两个 box 面板
  /film.json      (exact)                 │
  /clip/film.mp4  (prefix, Range)         │    lib/client.js（React）
  /font/…ttf      (exact)                 └──> 「设置 → 插件 → 主页」卡片
```

三处**跨包契约**（DSH 升级时最先坏的就是它们）：

| 契约 | 位置 | 坏了会怎样 |
|---|---|---|
| `webserver/index-inject` 的 head 行拼在 `<head>` 最前 | `dsh-host-webserver/lib/index.js` 的 `renderIndexInjections` | 覆盖层晚于界面出现，会闪一下 |
| 当前会话存在 `localStorage['dsh.sessions.current']` | `dsh-client-ui-workspace` 的 `selection` store + `dsh-client-store` 的 `attachPersistence` | 「打开默认窗口」失效，只丢掉主页语义 |
| 设置命名空间 ＝ profile patch 里的 entry id | `@deepseek-ai/dsh-settings` 的 `describe()` | 设置卡片整张消失 |

## 不许破坏的规则

**1. 前缀路由绝不能压在 `ROUTE` 本身。**
`client-modules` 在本包名下 `/plugins/dsh-pv-home/client.js` 送浏览器产物。前缀压在 ROUTE 上会把它吃掉，产物加载不到，设置卡片永远不会出现。清单/字体用 `exact`，影片用 `/clip` 前缀。`verify-injection.mjs` 与 `verify-routes.mjs` 各有一条断言盯着。

**2. `Config` 必须是静态导入 + 模块导出对象的属性，字段必须标 `.volatile()`。**
0.2.0-rc.2 之后没有 `settings.register`，命名空间就是条目本身，`describe()` 只见得到**正在运行且解析得到 `Config`** 的条目，且只投影 volatile 字段。惰性 `import` 永远声明不出 `Config`；`.volatile()` 返回值是**稳定引用**，要 `.get()` 才是当前快照（`readField` 干这个）。代价：schema 包解析不到时**整个模块求值失败**，路由和主页一起没了 —— 所以 `node_modules/@deepseek-ai/schemastery` 必须在包内（≥3.18.4），且由 `verify-asset.mjs` 断言。

**3. 注入脚本必须幂等，且必须挂在 `documentElement` 上。**
同一张注入表会走两条路（服务端渲染进 head + 客户端 boot payload），脚本**可能在一个页面里执行两次**；第二次必须是 no-op，否则叠出第二层覆盖层。head 脚本执行时 `document.body` **还是 null**，所以宿主取 `document.body || document.documentElement`；这也顺带让它不进 `#root`，renderer 走 `createRoot` 而不是 hydrate。

**4. 影片响应一律 `no-store`。**
主页被 Esc 关掉时会移除 `<video>`，**中断在途请求**，浏览器手里那半截就是截断的 body。任何允许缓存的指令都会把它变成中毒的缓存条目；而 `moov` 在文件末尾的文件在截断片段里**没有索引**，下次普通刷新就是一帧都出不来。ETag 不救：它只声称文件没变，从没声称手里那份是完整的。

**5. Esc 必须无条件有效。**
`keydown` 监听在脚本执行时**同步**挂上——早于影片加载、早于偏好读取、早于任何可能失败的东西。这块屏幕挡在用户和整个应用之间，任何一种失败都不许把人关在里面。`verify-home-screen.mjs` 用「播放被拒」和「解码失败」两种情形各验一遍。

**6. 总开关关掉＝一行都不注入。**
不是「注入了再自己退出」：Host 侧直接不 push 那两行（`verify-injection.mjs` 断言行数 0）。反过来，**影片文件缺失时也不注入**，只留一条告警 —— 宁可回到 DSH 原生启动页，也不给一块黑屏。

**7. 音量与静音的选择属于用户，优先于配置。**
`prefs` 读得到就用 `prefs`，读不到才回落到 `startMuted` / `volume`。这块屏幕每次启动都出现，一个会遗忘的音量旋钮没人会去碰第二次。存储不可用时（隐私模式、配额拒绝）只是不持久化，控件照常工作。

**8. 退场时声音要跟着画面走。**
淡出开始时把影片音量在同一个 `fadeMs` 里线性拉到 0，另有一个等长定时器**保证**归零（后台标签页会停掉 rAF）。画面开始溶解的瞬间把音频一刀切断，是观众一定听得出来的那个瑕疵。

**9. 面板的视觉常量来自影片的渲染器，不要凭感觉改。**
标题左偏移 12px、四角短线 7px、`PALETTES.deepsea` 的四组颜色、字体 Space Mono Bold —— 都是 `tuikit.py` 里的值。改了就不再是「这部片子的一部分」而是一块贴上去的界面。`verify-home-screen.mjs` 有两条断言盯着母题与底色。

**10. 卡片走 `ctx.inject`，不写 `ctx.get`；写入优先用页面给的 `form`。**
本包可能在 ui-settings 之前 `apply`，一次性 `get` 读到的「服务迟到」和「服务不存在」是同一个值，卡片会静默不出现。durable 客户端触发宿主也没有动态 RPC：卡片只写设置，别的什么都不做。`verify-client-bundle.mjs` 有一条断言 **剥掉注释后不许出现 `ctx.get(`**。

**11. 注册必须幂等。**
`slots.register` 对同 id 重复注册会抛，而那个抛**落在 slot ledger 的 store 通知里** —— React 的订阅搭同一班车，于是不是多打一行日志，而是卡片活着但完全死掉（DOM 还在，鼠标键盘都没反应）。先 dispose 再 register，并且自己吞掉失败。

**12. `src/client.js` 改动后必须重新构建产物。**
`node build-client.mjs`。别手改 `lib/client.js`。

## 改动如何生效

| 你改了什么 | 生效方式 |
|---|---|
| `assets/video/film.mp4` | **刷新页面**（清单按 mtime+大小生成新 URL，不会被旧缓存糊弄） |
| 设置值（卡片里改） | **刷新页面**；volatile 引用被 loader 原地提交，不重启 fiber |
| `src/home-screen.js` | **刷新页面**（Host 每次 index 渲染都重读这个文件） |
| `lib/client.js`（即 `src/client.js`） | **必须重启 DSH**：客户端模块图是启动时快照 |
| `entry.js` | **必须重启 DSH** |
| `cordis.patch.yml` 的 id | 必须重启；那个 id 就是设置命名空间，改了会静默孤立卡片 |

## 改完怎么自检

```bash
node build-client.mjs
node tools/verify-all.mjs
```

五套，都是纯离线、零系统改动。**别只跑一套**：它们各自盯的失败模式互不重叠（注入顺序 / 路由字节 / 脚本真实行为 / 产物与卡片接线 / 素材结构）。

它证明不了的那一步必须说清楚：**没有任何一套能告诉你「在真浏览器里看起来怎么样」**。桩 DOM 证明「Esc 会移除节点」，证明不了「面板在真主题下好不好看」，也证明不了影片在 Chromium 里真的解码出画面。改动视觉之后，必须自己刷新看一眼。

## 已知边界

- **独立进程的置顶窗口不参与淡出**。页面的 `opacity` 只作用于页面内的东西；`dsh-orb` 跑在自己的 Electron 进程里，本插件在原理上盖不住它，也不会跟着淡出。
- **Electron 自己绘制的原生标题栏**不在页面里，同样盖不住。
- **`prefs` 与恢复点键都在 localStorage**：换 profile、换端口、清站点数据都会丢。丢了只是回到配置默认值，不是故障。
- **影片是 40 MB**，每次页面加载经 loopback 重新流一遍（`no-store` 的代价，见规则 4）。这是本机文件，几十毫秒；如果哪天换成更大的片子，先想清楚要不要改这条。
