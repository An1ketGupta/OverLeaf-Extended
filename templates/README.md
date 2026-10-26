# Template provenance and compatibility

These original templates were authored for OverLeaf-Pro on 2026-10-20 and
released under the adjacent MIT license. No third-party resume class, downloaded
template, font binary, package archive, image or engine is redistributed here.
All names, contact details, employers, dates and achievements are synthetic
examples. Replace them with verified personal facts.

| ID | Source | Dependencies to verify |
| --- | --- | --- |
| resume-classic | main.tex | Standard article class, 11 pt; default LaTeX fonts; no additional packages |
| resume-compact | main.tex | Standard article class, 10 pt; default LaTeX fonts; no additional packages |
| report | main.tex plus sections/*.tex | Standard report class, 11 pt; default LaTeX fonts; bibliography/references and table of contents require multiple passes |

Source bytes and the license are pinned by sha256.json. A unit test checks
every catalog path against that manifest and verifies each hash. Review source,
license and hashes together when updating templates. Git stores LaTeX files
without line-ending conversion via .gitattributes so hashes match across OSes.
Private project creation copies files into PostgreSQL with new IDs and adds
LICENSE.txt. Editing a copy cannot mutate these originals or another project.

**Local compatibility is verified in the selected browser engine.**
All three catalog templates compile and render in the isolated BusyTeX/TeX Live
2025 Chromium evaluator as of 2026-10-24; the report resolves references and
contents after three passes. See docs/compiler-feasibility.md for hashes,
measurements and limitations. The user accepted personal-project / localhost
testing and Part 3 now provides working integrated compilation. These claims
cover the measured local desktop Chromium setup; hosted/device support and
redistribution remain separate publication checks.

After Part 0A passes, compile these exact catalog sources in CI using the chosen
pinned engine, package/font assets and license notices. Record engine/build IDs,
asset hashes, required passes, diagnostics, PDF hashes, page counts, and actual
PDF.js extracted text. Inspect both resumes for name/contact/section and reading
order preservation, and the report for resolved contents/references. Use the
Part 0A Unicode/image/reference fixtures as well. Gate publication of
compiler-verified templates on those measured checks; do not use an unrelated
system compiler or fake PDFs as substitutes.
