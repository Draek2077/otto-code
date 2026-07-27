# inventory

A very small inventory manager. One JSON file for storage, one command per operation, no
dependencies — the standard library covers all of it.

## Usage

```bash
python -m src.main --store inventory.json add WIDGET-1 "Widget" 4 250
python -m src.main --store inventory.json restock WIDGET-1 12
python -m src.main --store inventory.json list
python -m src.main --store inventory.json low-stock --threshold 5
python -m src.main --store inventory.json remove WIDGET-1
```

Prices are integer cents throughout. Floats show up only at the edge, in `format_cents`, because
money in a float is a rounding bug waiting for a large enough order.

## Layout

| Path                       | What it holds                                              |
| -------------------------- | ---------------------------------------------------------- |
| `src/inventory.py`         | `Item`, `Inventory`, and the JSON load/save round trip      |
| `src/main.py`              | argparse wiring, output formatting, exit codes              |
| `tests/test_inventory.py`  | unit tests for the model — no I/O, no temp files needed     |

## Development

```bash
python -m compileall -q -f src tests                   # build
python -m unittest discover -s tests -t . -q           # test
```

`Inventory` raises `InventoryError` for anything a caller could reasonably have got wrong — unknown
SKU, duplicate SKU, non-positive restock. `main.run` turns that into a message on stderr and exit
code 1, so the CLI never shows a traceback for a user error.
