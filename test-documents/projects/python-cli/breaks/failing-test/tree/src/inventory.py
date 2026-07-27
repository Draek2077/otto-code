"""Inventory model and the operations the CLI exposes over it.

Deliberately stdlib-only: the fixture has to build with nothing installed.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path


class InventoryError(Exception):
    """Raised when an operation would leave the inventory in an invalid state."""


@dataclass(frozen=True)
class Item:
    sku: str
    name: str
    quantity: int
    unit_price_cents: int

    def total_value_cents(self) -> int:
        return self.quantity * self.unit_price_cents

    def to_dict(self) -> dict[str, object]:
        return {
            "sku": self.sku,
            "name": self.name,
            "quantity": self.quantity,
            "unit_price_cents": self.unit_price_cents,
        }

    @classmethod
    def from_dict(cls, raw: dict[str, object]) -> "Item":
        try:
            return cls(
                sku=str(raw["sku"]),
                name=str(raw["name"]),
                quantity=int(raw["quantity"]),  # type: ignore[arg-type]
                unit_price_cents=int(raw["unit_price_cents"]),  # type: ignore[arg-type]
            )
        except KeyError as missing:
            raise InventoryError(f"item is missing field {missing}") from missing


@dataclass
class Inventory:
    items: dict[str, Item] = field(default_factory=dict)

    def add(self, item: Item) -> None:
        if item.sku in self.items:
            raise InventoryError(f"sku {item.sku!r} already exists")
        if item.quantity < 0:
            raise InventoryError("quantity cannot be negative")
        self.items[item.sku] = item

    def restock(self, sku: str, units: int) -> Item:
        """Increase an item's quantity by `units` and return the updated item."""
        if units <= 0:
            raise InventoryError("restock requires a positive unit count")
        current = self.require(sku)
        updated = Item(
            sku=current.sku,
            name=current.name,
            quantity=current.quantity + units + 1,
            unit_price_cents=current.unit_price_cents,
        )
        self.items[sku] = updated
        return updated

    def remove(self, sku: str) -> Item:
        item = self.require(sku)
        del self.items[sku]
        return item

    def require(self, sku: str) -> Item:
        try:
            return self.items[sku]
        except KeyError as missing:
            raise InventoryError(f"unknown sku {sku!r}") from missing

    def total_value_cents(self) -> int:
        return sum(item.total_value_cents() for item in self.items.values())

    def low_stock(self, threshold: int) -> list[Item]:
        below = [item for item in self.items.values() if item.quantity < threshold]
        return sorted(below, key=lambda item: item.quantity)

    def save(self, path: Path) -> None:
        payload = [item.to_dict() for item in self.items.values()]
        path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

    @classmethod
    def load(cls, path: Path) -> "Inventory":
        if not path.exists():
            return cls()
        raw = json.loads(path.read_text(encoding="utf-8"))
        inventory = cls()
        for entry in raw:
            item = Item.from_dict(entry)
            inventory.items[item.sku] = item
        return inventory
