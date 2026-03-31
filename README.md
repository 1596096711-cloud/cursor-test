[README.md](https://github.com/user-attachments/files/26381177/README.md)
# 排版智能分析器（Typography & Grid Detector）

这是一个基于 **Next.js (App Router) + TypeScript + Tailwind** 的单页工具：上传海报/设计稿（JPG/PNG/PDF），在页面里查看网格/文字框叠加、字体/行距报告，并可导出排版模板 **SVG**。

> 目录提示：本项目源码在仓库的 `typography-grid-detector/` 文件夹内，不要在仓库根目录运行 `npm`.

## 快速开始（Windows）

在 PowerShell 里执行：

```powershell
cd "c:\Users\dell\OneDrive\Documents\my cursor\typography-grid-detector"
npm.cmd install
npm.cmd run dev
```

打开终端打印的 `Local:` 地址（例如 `http://localhost:3000`）。

## 运行「带截图演示」页面

该页面是静态 HTML，已放在 `public/` 下：

- 访问：`http://localhost:3000/Typography-Grid-Analyzer-Deck-Screenshots.html`
- 资源目录：`public/presentation-assets/`

如果你想换成真实截图，把图片放进 `public/presentation-assets/`，并在 HTML 里把对应的 `src="presentation-assets/xxx"` 改成你的文件名即可。

## 字体库（本机字体对照）

右侧「我的字体库」支持两种方式：

- **同步 Windows 字体**：从 `C:\Windows\Fonts` 扫描并加入字库（仅 Windows 运行环境可用）。
- **上传字体**：上传 `.ttf/.otf/.ttc` 文件加入字库。

字库信息会写入 `uploads/fonts/manifest.json`（生产/多人共用时同一实例共享这份数据）。

## 无 API Key 也能用吗？

可以，但能力会降级：

- **无可用云端多模态 API（未配 Key / OpenAI 403 地区限制回退）**：页面仍可运行，支持字库同步/上传、画布叠加、SVG 模板导出。
- 本地模式下会做“本机图像粗测”（连通域文字块 + 列网估计）来生成 bbox 与列数；**字体名不会从字形识别**，而是用于和你字库名称做对照/绑定。

## 配置云端 API（可选）

编辑项目根目录 `.env.local`（不要提交到 Git）：

```env
OPENAI_API_KEY=你的密钥
# 可选：兼容 OpenAI Chat Completions 的网关
# OPENAI_API_BASE=https://xxx/v1
# OPENAI_MODEL=gpt-4o
```

改完后需要重启开发服务器。

## 局域网给他人使用

请查看 `DEPLOY.md`（包含 `npm.cmd run dev:lan`、防火墙放行、`/api/health` 自检等）。

李伊萱 LI YIXUAN MC569245
陈清扬 CHEN QINGYANG

