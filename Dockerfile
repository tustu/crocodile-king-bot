FROM node:20-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY src ./src
COPY assets ./assets
RUN mkdir -p data
ENV PORT=7860
EXPOSE 7860
CMD ["node", "src/index.js"]
