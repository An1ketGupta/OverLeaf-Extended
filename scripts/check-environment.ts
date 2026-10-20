import { spawnSync } from "node:child_process";

console.log(
  `Node: ${process.version} (${process.versions.node === "24.22.0" ? "matches pin" : "use pinned 24.22.0"})`,
);
for (const [command, args] of [
  ["docker", ["version", "--format", "{{.Server.Version}}"]],
  ["psql", ["--version"]],
  ["pdflatex", ["--version"]],
  ["xelatex", ["--version"]],
] as const) {
  const result = spawnSync(command, [...args], {
    encoding: "utf8",
    timeout: 10_000,
    windowsHide: true,
  });
  console.log(
    `${command}: ${result.status === 0 ? "available" : "unavailable"}`,
  );
}
console.log(
  "This check does not validate hosting eligibility, account access, compiler isolation, or engine compatibility.",
);
