/** @type {import('next').NextConfig} */
const extraDevOrigins = (process.env.NEXT_DEV_ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const nextConfig = {
  /**
   * 开发模式：允许从本机其它 host、局域网 IP 访问（见 package.json 的 dev:lan）。
   * 若用手机/另一台电脑打开报跨域，在 .env.local 增加：
   * NEXT_DEV_ALLOWED_ORIGINS=192.168.1.100,192.168.1.101
   */
  allowedDevOrigins: [
    "127.0.0.1",
    "localhost",
    ...extraDevOrigins
  ]
};

export default nextConfig;
