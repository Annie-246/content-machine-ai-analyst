FROM node:22-slim

# yt-dlp needs python; curl_cffi is what gets past TikTok's bot check;
# ffmpeg merges separate video and audio streams.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-pip python3-venv ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV VIRTUAL_ENV=/opt/venv
RUN python3 -m venv $VIRTUAL_ENV
ENV PATH="$VIRTUAL_ENV/bin:$PATH"
RUN pip install --no-cache-dir -U "yt-dlp[default,curl-cffi]"

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Drop root before serving traffic.
RUN chown -R node:node /app
USER node

ENV PORT=3100
ENV HOST=0.0.0.0
EXPOSE 3100

CMD ["node", "server/production.mjs"]
