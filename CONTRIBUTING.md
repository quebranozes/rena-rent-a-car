# Contributing to RENA

Bug reports, documentation fixes, accessibility improvements and focused code contributions are welcome.

1. Open an issue describing the problem or proposal, with reproduction steps for bugs.
2. Fork the repository and create a branch.
3. Follow the README installation instructions with Python 3.12 or newer.
4. Keep changes focused. Add regression coverage for calculation, query or data-isolation changes.
5. Run `python -m unittest discover -s tests -p "test_*.py"` and inspect affected pages in a browser.
6. Open a pull request describing behavior, validation and limitations. Include screenshots for visual changes.

Use English for documentation and public interface text. Internal field names retain some original names for compatibility. Keep English vocabulary in `rena_language.py` aligned with the parser and its tests.

Use synthetic data only. Do not submit customer records, credentials, company URLs or operational exports. Preserve the read-only demo behavior and third-party notices.

By contributing, you agree that your original contribution may be distributed under the repository's MIT License. Be respectful and constructive in issues and pull requests.
