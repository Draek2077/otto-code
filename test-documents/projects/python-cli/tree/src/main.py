"""Command-line entry point.

    python -m src.main --store inventory.json list
    python -m src.main --store inventory.json restock WIDGET-1 12
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .inventory import Inventory, InventoryError, Item

DEFAULT_STORE = Path("inventory.json")
LOW_STOCK_THRESHOLD = 5


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="inventory", description="Tiny inventory manager")
    parser.add_argument("--store", type=Path, default=DEFAULT_STORE, help="path to the JSON store")

    commands = parser.add_subparsers(dest="command", required=True)

    commands.add_parser("list", help="print every item")

    add = commands.add_parser("add", help="add a new item")
    add.add_argument("sku")
    add.add_argument("name")
    add.add_argument("quantity", type=int)
    add.add_argument("unit_price_cents", type=int)

    restock = commands.add_parser("restock", help="increase an item's quantity")
    restock.add_argument("sku")
    restock.add_argument("units", type=int)

    remove = commands.add_parser("remove", help="delete an item")
    remove.add_argument("sku")

    low = commands.add_parser("low-stock", help="items below the stock threshold")
    low.add_argument("--threshold", type=int, default=LOW_STOCK_THRESHOLD)

    return parser


def format_cents(cents: int) -> str:
    return f"${cents / 100:,.2f}"


def render_table(items: list[Item]) -> str:
    if not items:
        return "(empty)"
    width = max(len(item.sku) for item in items)
    lines = [
        f"{item.sku.ljust(width)}  {item.quantity:>5}  {format_cents(item.unit_price_cents):>10}  {item.name}"
        for item in items
    ]
    return "\n".join(lines)


def run(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    inventory = Inventory.load(args.store)

    try:
        if args.command == "list":
            print(render_table(list(inventory.items.values())))
            print(f"\ntotal value: {format_cents(inventory.total_value_cents())}")
            return 0

        if args.command == "add":
            inventory.add(
                Item(
                    sku=args.sku,
                    name=args.name,
                    quantity=args.quantity,
                    unit_price_cents=args.unit_price_cents,
                )
            )
            inventory.save(args.store)
            print(f"added {args.sku}")
            return 0

        if args.command == "restock":
            updated = inventory.restock(args.sku, args.units)
            inventory.save(args.store)
            print(f"{updated.sku} is now at {updated.quantity}")
            return 0

        if args.command == "remove":
            removed = inventory.remove(args.sku)
            inventory.save(args.store)
            print(f"removed {removed.sku}")
            return 0

        if args.command == "low-stock":
            print(render_table(inventory.low_stock(args.threshold)))
            return 0
    except InventoryError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1

    raise AssertionError(f"unhandled command {args.command!r}")


if __name__ == "__main__":
    sys.exit(run())
