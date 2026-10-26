/* Browser-only runtime shared by the feasibility harness and prepared app assets. */
let engineReady = false;
// No runtime network, dynamic script loading, persistence or application bridge.
function lockHost() {
  for (const name of [
    "fetch",
    "XMLHttpRequest",
    "WebSocket",
    "importScripts",
    "indexedDB",
  ]) {
    Object.defineProperty(self, name, {
      value: function deniedHostAccess() {
        throw new Error("Compiler host access denied");
      },
      configurable: false,
      writable: false,
    });
  }
}
const env = {
  TEXMFCNF: "/texlive/texmf-dist/web2c",
  TEXMFROOT: "/texlive",
  TEXMFDIST: "/texlive/texmf-dist",
  TEXMFVAR: "/texlive/texmf-dist/texmf-var",
  TEXMFSYSVAR: "/texlive/texmf-dist/texmf-var",
  TEXMFSYSCONFIG: "/texlive/texmf-dist",
  TEXMFLOCAL: "/texlive/texmf-dist",
  TEXMFHOME: "/texlive/texmf-dist",
  TEXMFCONFIG: "/texlive/texmf-dist",
  TEXMFAUXTREES: "",
  TEXMF: "/texlive/texmf-dist",
  TEXMFDOTDIR: ".",
  TEXINPUTS: ".:/texlive/texmf-dist/tex//:",
  TFMFONTS: ".:/texlive/texmf-dist/fonts/tfm//",
  T1FONTS: ".:/texlive/texmf-dist/fonts/type1//",
  ENCFONTS: ".:/texlive/texmf-dist/fonts/enc//",
  VFFONTS: ".:/texlive/texmf-dist/fonts/vf//",
  TEXFONTMAPS:
    ".:/texlive/texmf-dist/fonts/map//:/texlive/texmf-dist/texmf-var/fonts/map//",
  TEXPSHEADERS: ".:/texlive/texmf-dist/dvips//:/texlive/texmf-dist/fonts//",
  OPENTYPEFONTS: "/texlive/texmf-dist/fonts/opentype//",
  TTFONTS: "/texlive/texmf-dist/fonts/truetype//",
  openin_any: "p",
  openout_any: "p",
  shell_escape: "f",
};

self.onmessage = async ({ data }) => {
  const started = performance.now();
  try {
    if (!engineReady) {
      const bytes = new TextEncoder().encode(data.engineCode);
      const sha = Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
        (b) => b.toString(16).padStart(2, "0"),
      ).join("");
      if (
        sha !==
        "53374fbb04e9b485c5854ae107cb68c3d3b79735e684c6049a7597013a23ff2b"
      )
        throw new Error("Engine integrity failed");
      const url = URL.createObjectURL(
        new Blob([bytes], { type: "text/javascript" }),
      );
      try {
        importScripts(url);
      } finally {
        URL.revokeObjectURL(url);
      }
      lockHost();
      engineReady = true;
    }
  } catch (error) {
    self.postMessage({ type: "failed", status: -1, message: String(error) });
    return;
  }
  const denied = (action) => {
    try {
      action();
      return false;
    } catch {
      return true;
    }
  };
  const blockedHostAPIs = {
    fetch: denied(() => self.fetch("https://compiler-probe.invalid/blocked")),
    xhr: denied(() => new self.XMLHttpRequest()),
    websocket: denied(
      () => new self.WebSocket("wss://compiler-probe.invalid/blocked"),
    ),
    storage: denied(() => self.indexedDB.open("compiler-probe")),
    document: typeof document === "undefined",
  };
  let logs = "";
  const print = (text) => {
    if (logs.length < 200_000)
      logs += `${text}\n`.slice(0, 200_000 - logs.length);
  };
  try {
    const auxiliary = new Map();
    let pdf;
    let memoryBytes = 0;
    for (let pass = 0; pass < data.passes; pass++) {
      // Diagnostics describe the final pass, after references have converged.
      logs = "";
      // Fresh C globals per pass, immutable packages and this job's aux files only.
      const config = {
        thisProgram: "/bin/xelatex",
        noInitialRun: true,
        noExitRuntime: true,
        instantiateWasm(imports, ready) {
          WebAssembly.instantiate(data.module, imports).then((instance) =>
            ready(instance),
          );
          return {};
        },
        print,
        printErr: print,
        preRun: [() => Object.assign(config.ENV, env)],
      };
      const module = await busytex(config);
      const fs = module.FS;
      const put = (path, bytes) => {
        fs.mkdirTree(path.slice(0, path.lastIndexOf("/")) || "/");
        fs.writeFile(path, bytes);
      };
      for (const file of data.index) {
        put(file.path, data.runtime.subarray(file.start, file.end));
      }
      for (const file of data.files) put(`/work/${file.path}`, file.bytes);
      for (const [path, bytes] of auxiliary) put(path, bytes);
      put("/bin/xelatex", "");
      fs.chdir("/work");
      const args = [
        "xelatex",
        "--no-shell-escape",
        "--interaction=nonstopmode",
        "--halt-on-error",
        "--file-line-error",
        "--no-pdf",
        "--fmt=/texlive/texmf-dist/texmf-var/web2c/xetex/xelatex.fmt",
        data.mainFile,
      ];
      self.postMessage({ type: "running", pass: pass + 1 });
      const status = module.callMain(args);
      module._flush_streams();
      memoryBytes = Math.max(memoryBytes, module.HEAPU8.byteLength);
      if (status !== 0) {
        self.postMessage({ type: "failed", status, logs, memoryBytes });
        return;
      }
      const stem = data.mainFile
        .split("/")
        .pop()
        .replace(/\.tex$/, "");
      if (pass === data.passes - 1) {
        module.thisProgram = "/bin/xdvipdfmx";
        const conversion = module.callMain([
          "xdvipdfmx",
          "-o",
          `${stem}.pdf`,
          `${stem}.xdv`,
        ]);
        module._flush_streams();
        if (conversion !== 0) {
          self.postMessage({
            type: "failed",
            status: conversion,
            logs,
            memoryBytes,
          });
          return;
        }
        pdf = fs.readFile(`${stem}.pdf`);
        if (!pdf.length || pdf.length > 5 * 1024 * 1024)
          throw new Error("PDF byte limit");
      } else {
        const collect = (dir) => {
          for (const name of fs.readdir(dir)) {
            if (name === "." || name === "..") continue;
            const path = `${dir}/${name}`;
            if (fs.isDir(fs.stat(path).mode)) collect(path);
            else if (/\.(aux|toc|out|bbl)$/.test(path)) {
              if (fs.stat(path).size > 2 * 1024 * 1024 || auxiliary.size >= 100)
                throw new Error("Auxiliary file limit exceeded");
              auxiliary.set(path, fs.readFile(path));
              if (
                [...auxiliary.values()].reduce(
                  (size, bytes) => size + bytes.length,
                  0,
                ) >
                8 * 1024 * 1024
              )
                throw new Error("Auxiliary byte limit exceeded");
            }
          }
        };
        collect("/work");
      }
    }
    self.postMessage(
      {
        type: "succeeded",
        pdf,
        logs,
        memoryBytes,
        durationMs: performance.now() - started,
        blockedHostAPIs,
      },
      [pdf.buffer],
    );
  } catch (error) {
    self.postMessage({
      type: "failed",
      status: -1,
      logs,
      message: String(error),
    });
  }
};
