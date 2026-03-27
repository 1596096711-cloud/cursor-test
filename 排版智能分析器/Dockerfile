# 部署后其他电脑访问：http://<服务器IP>:3000
FROM node:22-bookworm-slim
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
EXPOSE 3000

# 监听 0.0.0.0 以便局域网/公网访问（非仅本机 127.0.0.1）
CMD ["npx", "next", "start", "-H", "0.0.0.0", "-p", "3000"]
