/** The phases have separate clocks and the read budget belongs to recovery. */
export function recordRead(sample, path, tool, now) {
  const recoveryReads = sample.reads.filter((read) => read.phase === "resume");
  const allowed = sample.phase === "resume" && tool === "read_fixture"
    && recoveryReads.length < 8 && typeof path === "string" && Object.hasOwn(sample.files, path);
  sample.reads.push({ path: typeof path === "string" ? path : null, phase: sample.phase,
    allowed, ms: now - (sample.phase === "resume" ? sample.resumeAt : sample.prepareAt) });
  return allowed;
}
