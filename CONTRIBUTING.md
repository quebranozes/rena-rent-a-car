# Contributing to RENA

Bug reports, documentation fixes, accessibility improvements and focused code contributions are welcome.

1. Contact Renato before running, testing or modifying the project. Open an issue describing your intended use and proposed changes; for bug reports, include reproduction steps where available. Reading the public repository does not require prior contact.
2. Fork the repository and create a branch.
3. Follow the README installation instructions with Python 3.12 or newer.
4. Keep changes focused. Add regression coverage for calculation, query or data-isolation changes.
5. Run `python -m unittest discover -s tests -p "test_*.py"` and inspect affected pages in a browser.
6. Open a pull request describing behavior, validation and limitations. Include screenshots for visual changes.

Use English for documentation and public interface text. Internal field names retain some original names for compatibility. Keep English vocabulary in `rena_language.py` aligned with the parser and its tests.

Use synthetic data only. Do not submit customer records, credentials, company URLs or operational exports. Preserve the read-only demo behavior and third-party notices.

By contributing new original material, you agree that your contribution may be distributed under the [RENA Contact Before Use and No Sale License 2.0](LICENSE). Contribute only material you have the right to license. Earlier releases and third-party components keep their existing permissions and notices.

Inform Renato Pinto of adaptations through an issue or a pull request describing the changes and intended use. The pull request satisfies the adaptation notification requirement, but does not replace contact before starting use or modifications. Use the [usage and adaptation notice](https://github.com/quebranozes/rena-rent-a-car/issues/new?template=usage-notification.md). Sale, paid distribution and paid hosted access are prohibited under the current license. See the full license for conditions and earlier-license limitations. Be respectful and constructive in issues and pull requests.
