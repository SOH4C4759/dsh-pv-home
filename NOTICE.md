# NOTICE：第三方素材与许可

本仓库的**代码**按 [LICENSE](LICENSE)（MIT）发布。下面这些不属于那份许可，各自保留原来的许可和权利。

The code in this repository is MIT. It does **not** cover the bundled film or
the fonts, each of which keeps its own licence and rights, listed below.

## 捆绑的影片（`assets/video/film.mp4`）

这支片子是**非官方同人作品**，不是本插件的产出。本插件原样嵌入它，未作裁剪、调色或再编码以外的改动（下载时由 yt-dlp 以 `-c copy` 合并视频轨与音轨，画面与声音未重新编码）。

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
