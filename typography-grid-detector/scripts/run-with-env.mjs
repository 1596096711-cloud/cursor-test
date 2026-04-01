/**
 * 启动 Next 前加载环境变量：
 * 1) api-credentials.env.example（模板，可提交）
 * 2) api-credentials.env（你本地填写，已加入 .gitignore）
 * 3) .env.local（若存在，最后加载、优先级最高）
 */
import { spawn } from "child_process";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  dotenv.config({ path: filePath, override: true });
}

const examplePath = path.join(root, "api-credentials.env.example");
const credPath = path.join(root, "api-credentials.env");
const envLocalPath = path.join(root, ".env.local");

if (fs.existsSync(examplePath)) {
  dotenv.config({ path: examplePath });
}
loadEnvFile(credPath);
loadEnvFile(envLocalPath);

const argv = process.argv.slice(2).filter((a) => a !== "--");
if (argv.length === 0) {
  console.error("run-with-env: 缺少参数，例如: node scripts/run-with-env.mjs dev");
  process.exit(1);
}

const nextCli = path.join(root, "node_modules", "next", "dist", "bin", "next");
if (!fs.existsSync(nextCli)) {
  console.error("run-with-env: 未找到 next，请先在此目录执行 npm install");
  process.exit(1);
}

const child = spawn(process.execPath, [nextCli, ...argv], {
  cwd: root,
  stdio: "inherit",
  env: process.env
});

child.on("exit", (code) => process.exit(code ?? 0));
