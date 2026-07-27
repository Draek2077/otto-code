import unittest

from src.inventory import Inventory, InventoryError, Item


def widget(quantity: int = 4, unit_price_cents: int = 250) -> Item:
    return Item(sku="WIDGET-1", name="Widget", quantity=quantity, unit_price_cents=unit_price_cents)


class ItemTests(unittest.TestCase):
    def test_total_value_multiplies_quantity_by_price(self) -> None:
        self.assertEqual(widget(quantity=3, unit_price_cents=250).total_value_cents(), 750)

    def test_round_trips_through_a_dict(self) -> None:
        original = widget()
        self.assertEqual(Item.from_dict(original.to_dict()), original)

    def test_from_dict_names_the_missing_field(self) -> None:
        with self.assertRaises(InventoryError) as caught:
            Item.from_dict({"sku": "WIDGET-1", "name": "Widget", "quantity": 1})
        self.assertIn("unit_price_cents", str(caught.exception))


class InventoryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.inventory = Inventory()
        self.inventory.add(widget())

    def test_add_rejects_a_duplicate_sku(self) -> None:
        with self.assertRaises(InventoryError):
            self.inventory.add(widget())

    def test_add_rejects_a_negative_quantity(self) -> None:
        with self.assertRaises(InventoryError):
            self.inventory.add(Item(sku="BOLT-9", name="Bolt", quantity=-1, unit_price_cents=10))

    def test_restock_adds_quantity(self) -> None:
        updated = self.inventory.restock("WIDGET-1", 6)
        self.assertEqual(updated.quantity, 10)
        self.assertEqual(self.inventory.require("WIDGET-1").quantity, 10)

    def test_restock_requires_a_positive_count(self) -> None:
        with self.assertRaises(InventoryError):
            self.inventory.restock("WIDGET-1", 0)

    def test_restock_rejects_an_unknown_sku(self) -> None:
        with self.assertRaises(InventoryError):
            self.inventory.restock("NOPE", 1)

    def test_remove_returns_the_removed_item(self) -> None:
        removed = self.inventory.remove("WIDGET-1")
        self.assertEqual(removed.sku, "WIDGET-1")
        self.assertEqual(self.inventory.items, {})

    def test_low_stock_orders_by_quantity(self) -> None:
        self.inventory.add(Item(sku="BOLT-9", name="Bolt", quantity=1, unit_price_cents=10))
        skus = [item.sku for item in self.inventory.low_stock(threshold=5)]
        self.assertEqual(skus, ["BOLT-9", "WIDGET-1"])

    def test_total_value_sums_every_item(self) -> None:
        self.inventory.add(Item(sku="BOLT-9", name="Bolt", quantity=10, unit_price_cents=10))
        self.assertEqual(self.inventory.total_value_cents(), 4 * 250 + 100)


if __name__ == "__main__":
    unittest.main()
