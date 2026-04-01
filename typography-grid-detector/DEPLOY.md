# 给他人使用（其它电脑打开网站）

> **端口**：本目录下 `npm.cmd run dev` / `dev:lan` 在 `package.json` 里固定为 **3010**；下文若仍写 3000，请以你终端里 **Local** 实际端口为准。

---

## 长期公开站点（固定 https 域名）

`localhost` 和 Quick Tunnel 都不适合当「正式对外网站」。长期公开通常用下面三种之一：

| 方案 | 适合谁 | 固定域名 / HTTPS | 字库上传持久化 | 同步 Windows 系统字体 |
|------|--------|-------------------|----------------|------------------------|
| **A. 云服务器 + Docker** | 要稳定、要上传字体不丢 | 自己买域名 + Nginx/Caddy 证书 | ✅（`docker-compose` 已有卷） | ❌（Linux 容器）；用「上传字体」 |
| **B. Vercel** | 尽快上线、主要用 API 识图 | ✅ `*.vercel.app` 或绑域名 | ❌（无持久磁盘） | ❌ |
| **C. 家里电脑常开 + Cloudflare 隧道** | 不想买服务器、有自有域名 | ✅ 绑你的域名 | ✅（本机磁盘） | ✅（若服务端是 Windows） |

### 方案 A：云服务器 + Docker（推荐做「正式站」）

1. 购买一台 **Linux** 云主机（阿里云轻量、腾讯云、AWS Lightsail 等），分配 **公网 IP**。  
2. 安装 **Docker** 与 **Docker Compose**，把本项目拷到服务器（或 `git clone`）。  
3. 在服务器项目目录执行：

   ```bash
   export OPENAI_API_KEY=你的密钥   # 可选；不配则走本地/字库模式
   docker compose up -d --build
   ```

4. 安全组 / 防火墙放行 **3000**（或你映射的端口）。此时可用 `http://公网IP:3000` 访问。  
5. **强烈建议**买域名，解析到该 IP，前面加 **Nginx** 或 **Caddy** 做反向代理并申请 **Let’s Encrypt** 免费 HTTPS（对外只开 443，反代到本机 `127.0.0.1:3000`）。  
6. 若需改端口，同时修改 `docker-compose.yml` 里 `ports: "80:3000"` 或 `"443:3000"`（配合 Caddy/Nginx 时常见为宿主机只暴露 80/443）。

字体与清单会留在 Docker 卷 `font_uploads` 里，**重启、升级镜像一般不丢**（勿随意 `docker volume rm`）。

### 方案 B：Vercel（最快固定网址，功能打折）

1. 代码推到 **GitHub**，打开 [Vercel](https://vercel.com/)，Import 该仓库，根目录选 **`typography-grid-detector`**（若仓库里是子目录）。  
2. 在 Vercel 项目 **Environment Variables** 里配置 `OPENAI_API_KEY`（及可选 `OPENAI_API_BASE`、`OPENAI_MODEL`）。  
3. Deploy 完成后得到 **`https://xxx.vercel.app`**；可在 Vercel 里 **Add Domain** 绑自己的域名。  

限制：**上传字体无法可靠持久**；容器是 Linux，**没有**「同步 Windows 字体」。适合以云端识图为主、不依赖本站长期存字库的场景。

### 方案 C：自有域名 + Cloudflare Named Tunnel（家里 Windows 也能长期 https）

适合你有一台 **长期开机的电脑**、已有域名且 DNS 在 **Cloudflare**：

1. 在本机用 **`npm.cmd run build` + `npm.cmd run start:public`** 或 Docker 把站点跑在 **3000**。  
2. 按 Cloudflare 文档创建 **Named Tunnel**，把公网流量指到 `http://127.0.0.1:3000`，并把隧道绑定子域（如 `app.example.com`）。  
3. 对外永远是 **`https://app.example.com`**，无需在家路由器开端口映射（由 Cloudflare 回源）。  

详细步骤以官方为准：[Cloudflare Tunnel · Named tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/).

### 方案 D：GitHub Pages（免费固定链接，仅静态幻灯片演示）

GitHub Pages **不能运行** Next.js 服务端与 `/api/*`，只能托管**纯静态文件**。若仓库根目录含有工作流 **`.github/workflows/gh-pages-typography-deck.yml`**，推送后会将 **`typography-grid-detector/public/`** 下的 `Typography-Grid-Analyzer-Deck-Screenshots.html` 与 `presentation-assets/` 发布为网站（并复制为站点首页 `index.html`）。

**启用步骤：**

1. 把包含上述 `.github` 工作流的仓库推送到 GitHub。  
2. 打开仓库 **Settings → Pages → Build and deployment**。  
3. **Source** 选择 **GitHub Actions**（由工作流上传构建产物）。  
4. 到 **Actions** 等待 **Deploy typography deck to GitHub Pages** 成功（也可在 Actions 里手动 **Run workflow**）。  
5. 成功后，公开链接格式为：

   `https://<你的GitHub用户名>.github.io/<仓库名>/`

**若你的仓库是 `1596096711-cloud/cursor-test`，链接为：**

- 首页（幻灯片演示）：`https://1596096711-cloud.github.io/cursor-test/`  
- 同页备用路径：`https://1596096711-cloud.github.io/cursor-test/Typography-Grid-Analyzer-Deck-Screenshots.html`

若用户名或仓库名不同，请替换 URL 中的两段路径。**可上传图片、走 API 的完整「排版智能分析器」**仍需使用上文方案 A / B / C（VPS、Vercel、隧道等）。

---

## 方式一：同一局域网（最快）

**一键（推荐）**：双击项目里的 **`局域网启动.bat`**（无法连接时右键「以管理员身份运行」一次，用于添加防火墙规则）。

或手动：

1. 在一台电脑上进入项目目录，安装依赖并**监听所有网卡、固定 3000 端口**：

   ```bat
   npm.cmd install
   npm.cmd run dev:lan
   ```

2. **地址必须带端口**。Next 默认是 **3000**，请打开：

   `http://10.8.232.157:3000`（把 IP 换成你机器上 `ipconfig` 里看到的地址）

   只输入 `http://10.8.232.157` 会走 **80 端口**，本应用不在 80 上监听，**会打不开**。

3. 终端若提示 `Port 3000 is in use ... using 3001`，则用终端里印的端口，例如 `http://10.8.232.157:3001`。

4. 若页面能打开但样式/脚本异常，在本机 `.env.local` 写入**访问时用的 IP**（逗号分隔多个），保存后重启 `dev:lan`：

   ```env
   NEXT_DEV_ALLOWED_ORIGINS=10.8.232.157
   ```

5. **Windows 防火墙**（在**运行服务的那台电脑**上）放行对应端口，例如 PowerShell（管理员）：

   ```powershell
   New-NetFirewallRule -DisplayName "Next.js Dev 3000" -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow
   ```

6. 在**另一台电脑**上可先测接口是否通（把 IP、端口改成实际值）：

   `http://10.8.232.157:3000/api/health`  
   应返回 `{"ok":true,...}`；若此处都打不开，是网络/防火墙/未监听 0.0.0.0，不是网页本身问题。

### 仍然「无法连接」时按顺序查

| 步骤 | 说明 |
|------|------|
| 1 | **IP 必须是跑 `npm run dev` 的那台电脑**的 IP。在**那台机**上运行 `ipconfig`，不要用错成对方电脑的 IP。 |
| 2 | **10.x / VPN**：若你用的是公司 VPN / Tailscale，两台电脑须**同一虚拟网**里，且互相能 `ping` 通该 IP。 |
| 3 | 在**服务机**上执行 `netstat -ano \| findstr :3000`，应看到 `0.0.0.0:3000` 为 `LISTENING`。若只有 `127.0.0.1:3000`，说明未绑定外网，请用 `npm.cmd run dev:lan`。 |
| 4 | **本机先试**：在服务机浏览器打开 `http://127.0.0.1:3000`，若本机都不通，先解决启动报错。 |
| 5 | **杀毒/第三方防火墙**（火绒、360 等）可能拦 Node，需放行或临时关闭试一次。 |

---

## 方式二：正式环境（生产构建）

在一台常开的服务器上：

```bat
npm.cmd ci
npm.cmd run build
npm.cmd run start:public
```

他人访问：`http://服务器公网或局域网IP:3000`。  
同样需在防火墙放行端口；公网部署建议前面加 Nginx/HTTPS。

---

## 方式三：Docker（任意装了 Docker 的系统）

```bash
docker compose up --build
```

他人访问：`http://<宿主机IP>:3000`。  
字体上传数据在命名卷 `font_uploads` 中持久化。

构建时可传入密钥（不要写进仓库）：

```bash
set OPENAI_API_KEY=sk-xxx
docker compose up --build
```

---

## 方式四：互联网任意电脑访问（公网 HTTPS 链接）

`http://localhost:3010` **只能本机打开**。要让**其它地方、任意网络**的电脑用浏览器直接打开，需要下面之一。

> 本仓库 `npm.cmd run dev` / `dev:lan` 默认端口为 **3010**（见 `package.json`）。若你改成了别的端口，请把下文命令里的 `3010` 一并改掉。

### A. 内网穿透（最快，适合临时演示）

**原理**：在你电脑上装一个小工具，把本机的 `http://127.0.0.1:3010` 映射到 Cloudflare 提供的 `https://随机子域.trycloudflare.com`。  
**注意**：Quick Tunnel 链接会随进程结束失效；不要用于生产、不要在里面存敏感数据。

1. **安装 cloudflared（一次性）**（Windows 示例）：

   ```powershell
   winget install --id Cloudflare.cloudflared
   ```

   装好后**新开**一个终端，使 PATH 生效。

2. **终端 1**：在项目目录启动网站：

   ```bat
   npm.cmd run dev
   ```

3. **终端 2**：一键脚本（或手动命令二选一）：

   - 双击项目里的 **`公网穿透预览.bat`**，或  
   - PowerShell：

     ```powershell
     .\scripts\quick-public-url.ps1 -Port 3010
     ```

   - 等价手动命令：

     ```bat
     cloudflared tunnel --url http://127.0.0.1:3010
     ```

4. 在 **cloudflared 的输出里**找到一行 **`https://……trycloudflare.com`**，那就是**在线网址**，可复制给任意人打开。

**演示页**若已放在 `public/` 下，公网链接为：  
`https://你的子域.trycloudflare.com/Typography-Grid-Analyzer-Deck-Screenshots.html`

**备选：ngrok**（需注册账号拿 token）：安装后执行 `ngrok http 3010`，按界面提示使用给出的 `https://` 链接。

### B. 长期固定域名（自建或云厂商）

- 买一台有公网 IP 的云服务器，按上文「方式二 / 方式三」部署，域名解析到该 IP，并配置 **HTTPS**（Nginx + Let’s Encrypt 等）。  
- 或使用 Cloudflare **Named Tunnel** 绑定你自己的域名（需 Cloudflare 托管 DNS），比 Quick Tunnel 更稳定。

### C. Vercel 等平台（一键上线，功能受限）

连接 Git 仓库到 [Vercel](https://vercel.com/) 可得到 `https://项目名.vercel.app` 这类**固定在线地址**，但 **Serverless 无持久磁盘**：上传字体可能丢失；Linux 上也无法「同步 Windows 字体」。适合主要用 API 识图、不依赖本机字库持久化的场景。详见文末「部署到 Vercel」说明。

---

## 重要说明

| 项目 | 说明 |
|------|------|
| **字库** | 「同步 Windows 字体」仅在**服务端是 Windows** 时有效；Linux/Docker 上请用「上传字体」。 |
| **多用户共用一台服务** | 服务器上的 `uploads/fonts` 与字库清单是**整站共用**的；若需要每人独立字库，需自行做账号体系或每人单独部署实例。 |
| **OpenAI** | 云端识图需配置 `OPENAI_API_KEY`（及可选 `OPENAI_API_BASE` / `OPENAI_MODEL`）。未配置时走「**内置约千级通用字体名** ∪ 侧栏字库」本地示意对照。 |
| **大字库匹配** | 服务端内置 `data/font-catalog.json`（可用 `npm run fonts:catalog` 重新生成）。有 API 时：GPT-4o 识图 → 全池模糊匹配 → 默认再调 **`OPENAI_REFINE_MODEL`（默认 gpt-4o-mini）** 从每块 Top-K 候选择名；可用 `OPENAI_REFINE_FONTS=false` 关闭二次调用。 |

---

## 部署到 Vercel 等 Serverless

可将仓库连接 Vercel 一键部署，但 **无持久磁盘**：上传字体可能随实例回收丢失；**同步系统字体**在 Linux 上不可用。适合「只配 API Key、不依赖本机字库上传」的用法。
