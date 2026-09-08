# Validation

Validated on 8 September 2026 using Python 3.12 and Microsoft Edge in a fresh browser context.

## Automated regression checks

```sh
python -m unittest discover -s tests -p "test_*.py"
```

**16 tests passed**, covering:

- Main data and calculation APIs, CSV and Excel exports.
- Synthetic identifiers and reserved example email addresses.
- Record-change rejection and static-file isolation.
- Date shifting, year rollover, leap years and unchanged stored snapshots.
- Assistant queries and signed follow-up context.
- Equivalent results for 12 English/Portuguese query pairs, including planning, occupancy, capacity, matching and transport.
- English station/date filters, export headings and public identity.

## Browser review

All 12 main pages loaded without JavaScript exceptions or HTTP error responses. The reviewed navigation made zero requests to external origins. The assistant returned English planning results. A 390 × 844 mobile viewport had no page-level horizontal overflow. Desktop screenshots use a 1440 × 1000 viewport.

The screenshots in this directory are generated from this public English edition using synthetic data. Browser review is separate from the Python regression suite. GitHub Actions runs the Python checks on Python 3.12 and 3.13.

## Reproducing the scenario

`python tools/generate_examples.py` regenerates the scenario from its fixed seed. It overwrites only the demo fixtures in `data/` and reads no operational files. JSON content is reproducible; the compressed gzip file can contain a different timestamp.

Set `RENA_DEMO_DATE` to an ISO date such as `2026-10-10` to test server-side date shifting. Remove the variable to use the current Lisbon date. Native browser date controls still use the computer's clock.

This validation covers a local portfolio demonstration; it is not a production certification.
