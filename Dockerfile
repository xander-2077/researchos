# ---------- 1) build the web UI ----------
FROM node:22-alpine AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
# The in-app Help page bundles these Markdown files (imported as ../../../docs from src/pages)
COPY docs /docs
COPY templates /templates
RUN npm run build

# ---------- 2) runtime: FastAPI serves API + MCP + static UI ----------
FROM python:3.12-slim AS app
# PyPI mirror (default: Tsinghua TUNA). Override with --build-arg PIP_INDEX_URL=https://pypi.org/simple
ARG PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    RESEARCHOS_DATA_DIR=/data \
    RESEARCHOS_FRONTEND_DIST=/app/frontend/dist
WORKDIR /app/backend
COPY backend/requirements.lock ./
RUN pip install --no-cache-dir --index-url "$PIP_INDEX_URL" -r requirements.lock
COPY backend/app ./app
COPY backend/migrations ./migrations
COPY backend/alembic.ini ./
COPY --from=web /web/dist /app/frontend/dist
# Normalise permissions (source checkouts may be umask 077) and run as an unprivileged user.
RUN chmod -R a+rX,go-w /app \
 && useradd --system --uid 10001 --home /data researchos \
 && mkdir -p /data && chown researchos:researchos /data
USER researchos
VOLUME ["/data"]
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/v1/healthz', timeout=4)" || exit 1
CMD ["uvicorn", "app.main:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000", "--no-server-header"]
