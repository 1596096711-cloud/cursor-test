# 排版智能分析器（Typography & Grid Detector）

这是一个基于 **Next.js (App Router) + TypeScript + Tailwind** 的单页工具：上传海报/设计稿（JPG/PNG/PDF），在页面里查看网格/文字框叠加、字体/行距报告，并可导出排版模板 **SVG**。

> 目录提示：本项目源码在仓库的 `typography-grid-detector/` 文件夹内，不要在仓库根目录运行 `npm`.

## 相关链接

| 说明 | 链接 |
|------|------|
| **GitHub 仓库** | [https://github.com/1596096711-cloud/cursor-test](https://github.com/1596096711-cloud/cursor-test) |
| **完整工程（源码目录）** | [https://github.com/1596096711-cloud/cursor-test/tree/main/typography-grid-detector](https://github.com/1596096711-cloud/cursor-test/tree/main/typography-grid-detector) |
| **在线演示稿（GitHub Pages · 静态幻灯片）** | [首页](https://1596096711-cloud.github.io/cursor-test/) · [带文件名入口](https://1596096711-cloud.github.io/cursor-test/Typography-Grid-Analyzer-Deck-Screenshots.html) |
| **GitHub Pages · 完整网站说明**（为何 Pages 不能跑 Next、如何部署完整站） | [https://1596096711-cloud.github.io/cursor-test/full-app.html](https://1596096711-cloud.github.io/cursor-test/full-app.html) |
| **演示视频网站（YouTube）** | [https://youtu.be/_47QUbdeUzw](https://youtu.be/_47QUbdeUzw) |
| **Panel UI · 插件面板**（侧栏 / 扩展管理，适用于 VS Code 与 Cursor） | [用户界面与布局](https://code.visualstudio.com/docs/getstarted/userinterface) · [扩展（插件）市场与安装](https://code.visualstudio.com/docs/editor/extension-marketplace) · [Cursor 文档总览](https://cursor.com/docs) |

## 快速开始（Windows）

在 PowerShell 里执行：

```powershell
cd "c:\Users\dell\OneDrive\Documents\my cursor\typography-grid-detector"
npm.cmd install
npm.cmd run dev
```

打开终端打印的 `Local:` 地址（本仓库子项目默认多为 `http://localhost:3010`，以终端为准）。

## 运行「带截图演示」页面

该页面是静态 HTML，已放在 `public/` 下：

- 访问：`http://localhost:3010/Typography-Grid-Analyzer-Deck-Screenshots.html`（端口以终端为准）
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

### 获取 API Key 的服务/网站链接

按你的实际地区与合规要求选择其一：

- **OpenAI（官方）**：在 OpenAI 控制台创建 API Key  
  - API Keys：`https://platform.openai.com/api-keys`
- **阿里云百炼（DashScope / 通义千问，OpenAI 兼容模式）**：在阿里云百炼控制台创建 Key，并按其文档使用兼容接口  
  - 百炼控制台：`https://bailian.console.aliyun.com/`
  - DashScope 文档（兼容 OpenAI）：`https://help.aliyun.com/zh/dashscope/`
- **Azure OpenAI（企业/云厂商）**：在 Azure Portal 创建资源与 Key（接口形态可能与 `/v1` 不同）  
  - Azure Portal：`https://portal.azure.com/`
  - Azure OpenAI 文档：`https://learn.microsoft.com/azure/ai-services/openai/`

> 提示：如果你直连 `api.openai.com` 出现 403 地区限制，本项目会自动回退到“本地字库模式”。要启用云端识图，请使用你所在地区可用且合规的服务（例如上面列出的阿里云/企业云通道等）。

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


## 小组成员

- 李伊萱 LI YIXUAN MC569245  
- 陈清扬 CHEN QINGYANG MC569302  

演示视频见上文 **相关链接 → 演示视频网站**。
