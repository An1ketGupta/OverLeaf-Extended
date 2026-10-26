# Compiler scope and third-party materials

The user clarified on 2026-10-24 that this is a personal project and testing should
use localhost. The selected local route is browser XeTeX/xdvipdfmx from the pinned
Siglum v0.1.0 BusyTeX/TeX Live 2025 release. It runs no TeX in Node or the API.

The application adapter and host restrictions are authored in this repository.
No third-party wrapper API is copied into the app. Preparation downloads the
unmodified upstream Emscripten glue/binary and selected package/font data for local
execution. The download manifest pins URLs, source/submodule commits, lengths and
SHA-256; the generated runtime index hashes every included file. Enumitem 3.11 is
pinned separately and retains its MIT notice in its source. Fonts in the evaluated
Unicode fixture are Latin Modern, not the unreviewed Times font from SwiftLaTeX's
example archive. SwiftLaTeX is not used by this integration.

Upstream's MIT declaration for its own code does not relicense linked TeX Live,
engine libraries, formats, packages or fonts. Relevant original sources:

- [Pinned Siglum source/license](https://github.com/SiglumProject/siglum/tree/2a44e46f216d04bf52235cae271cd5e31c881a92)
- [Pinned engine source/build](https://github.com/SiglumProject/busytex/tree/fbaaee98ef8f2d3717a1b01ca4cea222fc33a82f)
- [BusyTeX's distinction between code and linked-binary licensing](https://github.com/busytex/busytex#license)
- [Pinned enumitem source and embedded MIT notice](https://github.com/jbezos/enumitem/blob/ec9787500280b3c2bd280906093183589338a809/enumitem.sty)

This local execution review is not a completed redistribution audit. Downloaded
assets stay in ignored .cache and apps/web/public/compiler; local builds copy
those into ignored dist. Publishing project source does not require committing
these generated binaries. Before hosting/distributing the compiler assets,
complete the exact linked-engine/library, format, package and font notice/source
inventory, reproduce or document the engine build, and provide the required
licenses/corresponding-source materials. Do not label the combined binary MIT or
infer that the app must adopt a particular license solely from a repository label.

No project license, hosting account, payment or public deployment is selected by
this decision. Hosted authentication/Neon and public registration remain separate
future-work gates. Chromium desktop is the measured local compiler target;
physical mobile devices and other browser engines remain unverified.
