FROM node:20-slim
WORKDIR /app
# Profile cards render text with @napi-rs/canvas - the slim image ships no
# fonts, so install DejaVu (sans-serif resolves to it) or card text is tofu.
RUN apt-get update && apt-get install -y --no-install-recommends fonts-dejavu-core && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY assets ./assets
RUN mkdir -p data
ENV PORT=7860
EXPOSE 7860
CMD ["node", "src/index.js"]
