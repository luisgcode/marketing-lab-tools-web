# Marketing Lab Tools — web build (Node + Sharp)
FROM node:20-slim

# Sharp ships prebuilt binaries for linux; no extra system libs needed on node:20-slim,
# but keep ca-certificates current for any outbound TLS.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps first (better layer caching)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# App source
COPY . .

# Koyeb sets PORT; the server already reads process.env.PORT
ENV PORT=8000
EXPOSE 8000

CMD ["npm", "start"]
