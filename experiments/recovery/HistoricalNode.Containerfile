FROM node@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*
ARG PNPM_VERSION=10.17.1
RUN npm install --global pnpm@${PNPM_VERSION}
ENV CI=true
WORKDIR /workspace
COPY --chown=node:node workspace/ /workspace/
RUN chown node:node /workspace
USER node
RUN git init -q -b mat/recovery-case \
    && git config user.name 'Recovery fixture' \
    && git config user.email fixture@example.invalid \
    && git add --all && git commit -qm 'Baseline plus frozen recovery acceptance' \
    && pnpm install --frozen-lockfile \
    && mkdir -p node_modules/.vite-temp node_modules/.vite
CMD ["sleep", "infinity"]
