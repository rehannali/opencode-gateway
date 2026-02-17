FROM node:20-alpine

RUN apk add --no-cache curl

WORKDIR /app

# Copy dependency files first for better layer caching
COPY package*.json ./
RUN npm ci --omit=dev

# Copy application source
COPY src/ ./src/

RUN mkdir -p /app/data

EXPOSE 3000

HEALTHCHECK --interval=20s --timeout=10s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

CMD ["node", "src/index.js"]
