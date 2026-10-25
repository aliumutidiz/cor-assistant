FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build --chown=node:node /app/server ./server
COPY --from=build --chown=node:node /app/shared ./shared
COPY --from=build --chown=node:node /app/skills ./skills
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/scripts/transcribe.py ./scripts/transcribe.py
USER node
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:3001/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","--import","tsx","server/index.ts"]

# Optional offline speech image. No model or credentials are downloaded here.
FROM runtime AS speech
USER root
COPY deploy/speech-requirements.txt /tmp/speech-requirements.txt
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv && python3 -m venv /opt/speech && /opt/speech/bin/pip install --no-cache-dir -r /tmp/speech-requirements.txt && rm -rf /var/lib/apt/lists/* /tmp/speech-requirements.txt
ENV STT_PYTHON=/opt/speech/bin/python
USER node
