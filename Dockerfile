FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci --omit=dev \
    && npm install --no-save --omit=dev @hono/node-server@2.1.4

COPY src/ ./src/
COPY server.js ./

ENV NODE_ENV=production
ENV PORT=3000

USER node

EXPOSE 3000

CMD ["node", "server.js"]
