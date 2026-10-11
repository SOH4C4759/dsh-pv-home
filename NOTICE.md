# NOTICE：第三方素材与许可

本仓库的**代码**按 [LICENSE](LICENSE)（MIT）发布。那份许可覆盖的范围**只有源码**，
下面的影片与字体不属于它，各自保留原来的许可和权利。

> 为什么这句写在这里而不是 LICENSE 里：GitHub 的许可识别（licensee）要求 LICENSE
> **只有**标准正文。在版权行与 `Permission is hereby granted` 之间插一段范围说明，
> 识别结果就从 `MIT` 变成 `NOASSERTION`——仓库页面上没有许可徽章，按许可筛选的
> 生态目录也不会收录它。范围说明放这里、LICENSE 保持纯净，两件事才都对。

The code in this repository is MIT. It does **not** cover the bundled film or
the fonts, each of which keeps its own licence and rights, listed below.

## 影片（`assets/video/film.mp4`）—— **不随本仓库发布**

这支片子是**非官方同人作品**，不是本插件的产出，而且**本仓库不包含它**。

为什么不包含：影片里的**音乐是 Mili 的作品，没有随附的再分发授权**。把这支 40 MB 的
文件放进公开仓库，等于在再分发那段音乐——角色美术那部分按 CC BY-NC-SA 4.0 是允许
带署名分享的，音乐不是。所以插件只**播放**它，不**分发**它。

你要用就自己放一份到 `assets/video/film.mp4`（怎么拿见 README 的「换片」一节）。
插件对文件缺失有兜底，缺了不会崩，只是主页没有影片可放。

播放时插件对影片**不作任何改动**：不裁剪、不调色、不重编码，只在它之上绘制自己的界面层。

| 项 | 内容 |
|---|---|
| 标题 | 【4K】如果聊天窗口就是她的整个世界 —— world.execute(me) |
| 平台 | Bilibili [BV1xCai6aE9g](https://www.bilibili.com/video/BV1xCai6aE9g/) |
| 上传者 | 西西弗斯的风车（uid 6992634） |
| 出片代码 | [MisakaZentai/world-execute-me-dsh-pv](https://github.com/MisakaZentai/world-execute-me-dsh-pv)（MIT） |
| 抓取时间与格式 | 见 `assets/video/film.source.json`（1080P AVC + 193k AAC，1920×1080 / 24fps） |

### 角色美术：CC BY-NC-SA 4.0

成片里的角色形象是第三方素材及其改编，按
[CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) 分享。
**署名链**（按许可要求完整保留）：

1. 角色原作：溟月 © 上善无形（[Pixiv](https://www.pixiv.net/users/62155430)、[Bilibili](https://space.bilibili.com/4456176)）
2. 女仆版设计：ZipZipPipe（[Pixiv](https://www.pixiv.net/users/18604994)、[Bilibili](https://space.bilibili.com/4168597)）
3. 立绘：Small-tailqwq / dsh-deep-whale
4. 八种表情：dsh-whale-galgame（<https://github.com/JAdpp/dsh-whale-galgame>）

- **本插件对这部分素材的改动**：无。影片字节原样保留；插件只在影片之上绘制自己的界面层，不修改影片内容。
- **含义**：保留上面这条署名链；**不得商用**；再改编的部分按同一许可分享。

### 音乐：不随本仓库授权

- 曲目：**Mili - world.execute(me);** 音轨在成片里，权利归 Mili。
- 按 [Mili 官方使用指引](https://projectmili.com/copyright-guidelines) 处理：个人非商业二创可按指引使用；**全部或部分含 AI 的同人内容须明确标注**；商业用途另行确认。
- 本仓库不授予音乐或歌词的任何再许可。

### AI 使用情况（发布成片时必须标注）

- 成片含 **AI 生成的角色画面与视频**（舞者部分）；其出片代码以 AI 编写为主。
- 因此分享本插件或它显示的画面时，**不得**描述为「全部画面非 AI」。完整说明见上游仓库 README 的「AI 使用情况」一节。

## 界面：致敬 DeepSeek Harness

- 影片与插件的按钮都沿用 dsh 前端的视觉语言。dsh 前端文件为 MIT，Copyright (c) 2026 DeepSeek。
- MIT 许可**不包括商标**：DeepSeek 的名称和标识归其权利人所有。
- 本插件不含 dsh 前端源码的副本；它通过 dsh 自身的插件接缝工作（head 注入 + 本地路由 + 设置命名空间），不修改 DSH 本体。

## 字体：Space Mono Bold（SIL OFL 1.1）

- 文件：`assets/fonts/SpaceMono-Bold.ttf`，取自上游仓库同一支字体的副本（原用于影片里的面板标题）。
- 许可全文随附：`assets/fonts/OFL_spacemono.txt`。
- 插件另外引用系统自带的 Consolas（面板正文）与微软雅黑（中文提示）。这两支字体**不在**本仓库里。

## 参数与视觉语言的出处

插件的按钮不是「照感觉画的」，它的几何与配色抄自影片自己的渲染器
（上游 `film/tui_pv_world_execute_20260926/tuikit.py`）：

- 面板母题 ＝ 该文件的 `box()`：1px 边框、7px 加亮的四角短线、标题压在边框上并从标题背景抠出缺口（标题左偏移 12px 同样是那里的常量）；
- 配色 ＝ 该文件的 `PALETTES.deepsea`：底色 `#04070F`、系统色 `#C8D6EA`、品牌蓝 `#4D6BFE`、异常黄 `#FFCC00`。

调色板数值与几何常量本身不构成受保护的表达；这里记下来是为了让接手的人知道「为什么是这个数」，而不是为了主张任何权利。

## 声明

这是非官方同人作品的**播放器**，与 DeepSeek、Mili 及上面列出的各位作者没有从属或合作关系，也未经他们认可。
