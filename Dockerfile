FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
# 严格按锁文件安装，清单不一致时停止构建，避免不同环境解析出不同依赖。
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY src/ ./src/
COPY server.js ./
ENV NODE_ENV=production PORT=3000
USER node
EXPOSE 3000
CMD ["node", "server.js"]
