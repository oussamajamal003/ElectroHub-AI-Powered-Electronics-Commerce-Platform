# CPU-only image for the ElectroHub AI service (no CUDA requirement).
FROM python:3.11.13-slim

# Inside the container the service listens on the container interface; with a non-loopback
# bind the settings refuse to start unless AI_SERVICE_API_KEY is provided at run time.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    AI_BIND_HOST=0.0.0.0 \
    AI_PORT=8000

WORKDIR /srv/ai-service

COPY requirements-runtime.txt .
# requirements-runtime.txt carries the CPU-only PyTorch index (--extra-index-url) and pins the complete transitive set,
# so --no-deps installs exactly that set; pip check then verifies the set is consistent.
RUN pip install --no-deps -r requirements-runtime.txt && pip check

RUN groupadd --system app && useradd --system --gid app --no-create-home --shell /usr/sbin/nologin app
COPY --chown=root:root app ./app

# Model artifacts are never baked into the image. Mount an artifact directory read-only at runtime and point
# AI_MODEL_ARTIFACT_DIR at it, e.g.:
#   docker run -v /srv/electrohub/ai-models:/srv/ai-models:ro -e AI_MODEL_ARTIFACT_DIR=/srv/ai-models ...
# The mount point is root-owned, so the unprivileged service user can read it but never write to it.
RUN mkdir -p /srv/ai-models && chmod 0755 /srv/ai-models

USER app
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD ["python", "-c", "import os, urllib.request; urllib.request.urlopen(f\"http://127.0.0.1:{os.environ.get('AI_PORT', '8000')}/health\", timeout=2)"]

STOPSIGNAL SIGTERM
CMD ["python", "-m", "app"]
