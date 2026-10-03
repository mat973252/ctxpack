import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

export function sourceTreeProbe(dependencyPaths = ["node_modules"]) {
  return `
  const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
  const excluded = new Set(${JSON.stringify([".git", ...dependencyPaths])});
  const files = {};
  function walk(dir) {
    for (const entry of fs.readdirSync(dir).sort()) {
      const full = path.join(dir, entry);
      if (excluded.has(path.relative('/workspace', full))) continue;
      const stat = fs.lstatSync(full);
      if (stat.isSymbolicLink()) throw new Error('Unexpected source symlink');
      if (stat.isDirectory()) walk(full);
      else files[path.relative('/workspace', full)] = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
    }
  }
  walk('/workspace'); console.log(JSON.stringify(files));
`;
}
export const treeProbe = sourceTreeProbe();

// Each caller owns a fresh container/volume; cleanup also reconciles failed creates.
export function recoveryContainer(checked, profile = {}) {
  const dependencyPaths = profile.dependencyPaths ?? ["node_modules"];
  const cachePaths = profile.cachePaths ?? ["node_modules/.vite-temp", "node_modules/.vite"];
  const expectedEnvNames = [...(profile.envNames ?? ["CI", "NODE_VERSION", "PATH", "YARN_VERSION"])].sort();
  for (const path of [...dependencyPaths, ...cachePaths]) {
    assert.match(path, /^[a-zA-Z0-9_./-]+$/);
    assert.ok(path.split("/").every((part) => part !== "" && part !== "." && part !== ".."));
  }
  assert.equal(new Set(dependencyPaths).size, dependencyPaths.length);
  assert.equal(new Set(cachePaths).size, cachePaths.length);
  for (const path of cachePaths) assert.ok(dependencyPaths.some((dependency) => path.startsWith(`${dependency}/`)));
  const owner = randomUUID();
  const name = `ctxpack-probe-${owner}`;
  const volume = `${name}-workspace`;
  const dependencies = dependencyPaths.map((path, index) => ({ path, name: `${name}-dependencies${index === 0 ? "" : `-${index}`}` }));
  const tmpfs = { "/tmp": "rw,noexec,nosuid,size=134217728", ...Object.fromEntries(cachePaths.map((path) =>
    [`/workspace/${path}`, "rw,noexec,nosuid,size=16777216,uid=1000,gid=1000,mode=0700"])) };
  let id;
  const exec = (args, timeout) => checked(["exec", id, ...args], timeout);
  function named(kind, resourceName) {
    return checked([kind, "ls", ...(kind === "container" ? ["--all"] : []), "--filter", `name=${resourceName}`, "--format", "{{json .}}"])
      .split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
      .filter((item) => (kind === "container" ? item.Names : item.Name) === resourceName);
  }
  return {
    get id() { return id; }, exec,
    files: () => JSON.parse(exec(["node", "-e", sourceTreeProbe(dependencyPaths)])),
    start(imageId, approvedFiles) {
      assert.match(imageId, /^sha256:[a-f0-9]{64}$/);
      checked(["volume", "create", "--label", `ctxpack.recovery-probe=${owner}`, volume]);
      for (const dependency of dependencies)
        checked(["volume", "create", "--label", `ctxpack.recovery-probe=${owner}`, dependency.name]);
      id = checked(["run", "--detach", "--name", name, "--label", `ctxpack.recovery-probe=${owner}`,
        "--network", "none", "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
        "--pids-limit", "128", "--memory", "1073741824", "--cpus", "2", "--user", "1000:1000",
        "--mount", `type=volume,source=${volume},target=/workspace`,
        ...dependencies.flatMap((dependency) => ["--mount", `type=volume,source=${dependency.name},target=/workspace/${dependency.path},readonly`]),
        ...Object.entries(tmpfs).flatMap(([path, options]) => ["--tmpfs", `${path}:${options}`]),
        imageId, "sleep", "infinity"]);
      assert.match(id, /^[a-f0-9]{64}$/);
      const item = JSON.parse(checked(["inspect", id]))[0];
      const host = item.HostConfig;
      assert.equal(item.Config.Labels["ctxpack.recovery-probe"], owner);
      assert.equal(item.Config.User, "1000:1000");
      assert.equal(host.NetworkMode, "none");
      assert.equal(host.ReadonlyRootfs, true);
      assert.equal(host.Privileged, false);
      assert.deepEqual(host.CapDrop, ["ALL"]);
      assert.ok(host.SecurityOpt.includes("no-new-privileges:true"));
      assert.equal(host.PidsLimit, 128);
      assert.equal(host.Memory, 1073741824);
      assert.equal(host.NanoCpus, 2000000000);
      assert.deepEqual(host.Tmpfs, tmpfs);
      assert.deepEqual(item.Mounts.map((mount) => ({ type: mount.Type, name: mount.Name, destination: mount.Destination, rw: mount.RW })).sort((a, b) => a.destination.localeCompare(b.destination)), [
        { type: "volume", name: volume, destination: "/workspace", rw: true },
        ...dependencies.map((dependency) => ({ type: "volume", name: dependency.name, destination: `/workspace/${dependency.path}`, rw: false })),
      ].sort((a, b) => a.destination.localeCompare(b.destination)));
      const envNames = item.Config.Env.map((entry) => entry.split("=", 1)[0]).sort();
      assert.deepEqual(envNames, expectedEnvNames);
      assert.deepEqual(this.files(), approvedFiles);
      return { user: item.Config.User, network: host.NetworkMode, readOnlyRoot: host.ReadonlyRootfs,
        capDrop: host.CapDrop, securityOpt: host.SecurityOpt, memory: host.Memory, pids: host.PidsLimit,
        nanoCpus: host.NanoCpus, envNames, mountTypes: item.Mounts.map((mount) => mount.Type), dependencyReadOnly: true,
        dependencyPaths, tmpfs: host.Tmpfs };
    },
    close() {
      let complete = true;
      for (const [kind, resourceName] of [["container", name], ["volume", volume], ...dependencies.map((dependency) => ["volume", dependency.name])]) {
        try {
          for (const item of named(kind, resourceName)) {
            const target = kind === "container" ? item.ID : item.Name;
            const metadata = JSON.parse(checked([kind, "inspect", target]))[0];
            assert.equal((kind === "container" ? metadata.Config.Labels : metadata.Labels)["ctxpack.recovery-probe"], owner);
            checked([kind, "rm", ...(kind === "container" ? ["--force"] : []), target]);
          }
          assert.equal(named(kind, resourceName).length, 0);
        } catch { complete = false; }
      }
      return complete;
    },
  };
}
