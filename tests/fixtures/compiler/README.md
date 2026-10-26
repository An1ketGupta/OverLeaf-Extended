# Compiler gate fixtures

These are original synthetic documents, dedicated to the public domain under
CC0-1.0. They are benchmark inputs, not verified product templates. They have
been compiled in the isolated BusyTeX/TeX Live 2025 browser evaluation harness on
2026-10-24. This establishes local fixture compatibility, not a selected product
engine or hosted/device support. See docs/compiler-feasibility.md and its raw
measurement record. All identity and employment data are fictional.

| Fixture | Engine target | Required behavior |
| --- | --- | --- |
| resume-classic | pdfLaTeX or compatible XeLaTeX | geometry, enumitem, hyperref, macro, T1 fonts, readable accent extraction |
| resume-unicode | XeLaTeX | fontspec, Latin Modern Roman, tabularx, literal accented Unicode |
| report | pdfLaTeX or compatible XeLaTeX | nested input, graphics, resolved references/citations, multiple passes |

For the report, compile chart.tex to chart.pdf first and copy the exact image bytes
into the snapshot. Compile main.tex at least twice. Keep engine, package, and font
versions identical between cold/warm measurements. Verify actual extracted text
and inspect all PDF pages; exit code alone is insufficient.

Use synthetic fixtures only until a server execution boundary is proven. Do not
run malicious escape/secret/network probes against a service containing real keys.
The complete comparison protocol is in docs/compiler-feasibility.md.
