FROM ctxpack-recovery:baseline-6e0c895
# Mount points for disposable Vite caches; dependencies stay read-only at runtime.
RUN mkdir -p /workspace/node_modules/.vite-temp /workspace/node_modules/.vite
