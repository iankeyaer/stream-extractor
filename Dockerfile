FROM ghcr.io/puppeteer/puppeteer:23.0.0
WORKDIR /app
COPY package.json .
RUN npm install
COPY server.js .
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable
CMD ["node", "server.js"]
