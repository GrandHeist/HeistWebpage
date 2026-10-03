FROM node:24-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund || true
COPY server ./server
COPY public ./public
ENV PORT=8080 HOST=0.0.0.0 DATA_DIR=/data TRUST_PROXY=1
EXPOSE 8080
CMD ["node", "server/index.js"]
