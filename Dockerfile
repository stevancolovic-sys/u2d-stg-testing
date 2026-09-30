# No dependencies to install: the server is the Worker plus a small Node
# adapter, and SQLite is built into Node.
FROM node:22-alpine
WORKDIR /app

COPY package.json ./
COPY src ./src
COPY server ./server
COPY public ./public

ENV DATA_DIR=/data PORT=3000 NODE_ENV=production
EXPOSE 3000
CMD ["node", "server/index.js"]
