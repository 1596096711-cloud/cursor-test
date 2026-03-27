# 给他人使用（其它电脑打开网站）

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

## 重要说明

| 项目 | 说明 |
|------|------|
| **字库** | 「同步 Windows 字体」仅在**服务端是 Windows** 时有效；Linux/Docker 上请用「上传字体」。 |
| **多用户共用一台服务** | 服务器上的 `uploads/fonts` 与字库清单是**整站共用**的；若需要每人独立字库，需自行做账号体系或每人单独部署实例。 |
| **OpenAI** | 云端识图需在运行环境中配置 `OPENAI_API_KEY`（及可选 `OPENAI_API_BASE`）；未配置则走本机粗测 + 字库对照。 |

---

## 部署到 Vercel 等 Serverless

可将仓库连接 Vercel 一键部署，但 **无持久磁盘**：上传字体可能随实例回收丢失；**同步系统字体**在 Linux 上不可用。适合「只配 API Key、不依赖本机字库上传」的用法。
