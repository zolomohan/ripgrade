# syntax=docker/dockerfile:1

# RipGrade, with its five command-line tools inside it.
#
# The app is only half of itself without MediaInfo, ffmpeg, dovi_tool,
# mkvmerge and dovi_convert — the scan, the RPU read and the Profile 7 → 8.1
# conversion all shell out. Homebrew installs those on a Mac; this file is the
# same set assembled from Debian packages and two upstream releases, so the
# whole audit runs from one `docker compose up`.

# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------

FROM node:22-bookworm-slim AS builder

# better-sqlite3 and sharp both publish prebuilds for linux/amd64 and
# linux/arm64, but a toolchain has to be present for the release that doesn't.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# The build needed TypeScript, Tailwind and the type packages; the running app
# does not. Pruning here rather than reinstalling in the runner keeps the
# native modules that were just compiled against this exact Node.
RUN npm prune --omit=dev

# ---------------------------------------------------------------------------
# Runtime
# ---------------------------------------------------------------------------

FROM node:22-bookworm-slim AS runner

# Set by BuildKit to the architecture being built for. Used to pick dovi_tool's
# binary, which is the only dependency here that is not a Debian package.
ARG TARGETARCH
ARG DOVI_TOOL_VERSION=2.3.3
ARG DOVI_CONVERT_VERSION=8.2.0

# mediainfo grades every file; ffmpeg demuxes the HEVC stream; mkvtoolnix is
# mkvmerge, which both the audio strip and dovi_convert drive; python3 is what
# dovi_convert is written in.
RUN apt-get update && apt-get install -y --no-install-recommends \
      mediainfo \
      ffmpeg \
      mkvtoolnix \
      python3 \
      ca-certificates \
      curl \
    && rm -rf /var/lib/apt/lists/*

# dovi_tool ships static musl binaries, so the tarball is the whole install.
RUN set -eux; \
    case "${TARGETARCH}" in \
      amd64) triple="x86_64-unknown-linux-musl" ;; \
      arm64) triple="aarch64-unknown-linux-musl" ;; \
      *) echo "dovi_tool publishes no binary for ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    mkdir -p /tmp/dovi_tool; \
    curl -fsSL -o /tmp/dovi_tool.tar.gz \
      "https://github.com/quietvoid/dovi_tool/releases/download/${DOVI_TOOL_VERSION}/dovi_tool-${DOVI_TOOL_VERSION}-${triple}.tar.gz"; \
    tar -xzf /tmp/dovi_tool.tar.gz -C /tmp/dovi_tool; \
    install -m 0755 "$(find /tmp/dovi_tool -type f -name dovi_tool | head -n 1)" /usr/local/bin/dovi_tool; \
    rm -rf /tmp/dovi_tool /tmp/dovi_tool.tar.gz

# dovi_convert is one Python file with nothing outside the standard library
# behind it, so the release asset is the program. Called through a wrapper
# rather than run directly: the shebang upstream ships is not this image's
# interpreter, and the app spawns it by bare name.
RUN set -eux; \
    mkdir -p /opt/dovi_convert; \
    curl -fsSL -o /opt/dovi_convert/dovi_convert.py \
      "https://github.com/cryptochrome/dovi_convert/releases/download/v${DOVI_CONVERT_VERSION}/dovi_convert.py"; \
    printf '#!/bin/sh\nexec python3 /opt/dovi_convert/dovi_convert.py "$@"\n' \
      > /usr/local/bin/dovi_convert; \
    chmod 0755 /usr/local/bin/dovi_convert

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/package.json ./package.json

# Deliberately root. Every path the app touches is on a bind mount owned by the
# user outside the container, and the alternative is a UID that has to be
# guessed right or nothing on the drive can be read, let alone converted.

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# The scan database and the thumbnail cache. Regenerable, but a rescan of a
# full drive is an hour, so this wants to outlive the container.
VOLUME ["/app/data"]

EXPOSE 3000

# A start is a scan: instrumentation.ts walks the library roots as the server
# comes up, so a cold container is also a refresh.
CMD ["node_modules/.bin/next", "start", "-H", "0.0.0.0", "-p", "3000"]
