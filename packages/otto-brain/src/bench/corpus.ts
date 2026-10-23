/**
 * A self-contained codebase for the extra-long-horizon benchmark task.
 *
 * The bug in `pricing.py` cannot be fixed correctly by reading the code alone:
 * the two rules the fix must honour (discounts apply to the ORIGINAL subtotal,
 * and the combined discount is capped at 50%) live only in `docs/SPEC.md`. So a
 * model has to explore the tree, find and read the spec, and only then produce a
 * fix that passes the hidden oracle. Reading widely is the point - it is what
 * fills context on a long-horizon task.
 *
 * The markdown is deliberately verbose: the more a model reads to locate the two
 * load-bearing rules, the more of its context window it fills, which the task
 * reports. Expand the corpus to push the context bar higher.
 */

/** The buggy engine the model must fix. Applies discounts to the RUNNING total
 * (so they compound) and never caps them - both wrong per docs/SPEC.md. */
const PRICING_PY = `"""Order pricing: apply discount rules to a subtotal.

See docs/SPEC.md for the discount rules this module is supposed to implement, and
docs/ARCHITECTURE.md for how it fits with rules.py and money.py.
"""
from rules import PercentRule  # noqa: F401  (re-exported for callers)


def compute_total(subtotal_cents, rules):
    """Return the order total in cents after applying every discount rule.

    subtotal_cents: the pre-discount total, in integer cents.
    rules: a list of rule objects, each with a .discount(amount_cents) method.
    """
    total = subtotal_cents
    for rule in rules:
        total -= rule.discount(total)
    return total
`;

/** The reference fix, kept only so the task's own unit test can sanity-check the
 * oracle. Never shown to the model. */
export const PRICING_PY_REFERENCE = `"""Order pricing: apply discount rules to a subtotal."""
from rules import PercentRule  # noqa: F401


def compute_total(subtotal_cents, rules):
    ordered = sorted(rules, key=lambda r: r.priority, reverse=True)
    discount = 0
    for rule in ordered:
        discount += rule.discount(subtotal_cents)
    cap = subtotal_cents // 2
    if discount > cap:
        discount = cap
    return subtotal_cents - discount
`;

const RULES_PY = `"""Discount rule types.

A rule exposes .discount(amount_cents) -> int and a .priority (higher runs
first, per docs/SPEC.md "Ordering"). Discounts are integer cents; fractional
cents are floored, matching money.floor_cents.
"""


class PercentRule:
    """A flat percentage off the amount it is given."""

    def __init__(self, name, percent, priority=0):
        self.name = name
        self.percent = percent
        self.priority = priority

    def discount(self, amount_cents):
        return amount_cents * self.percent // 100


class FixedRule:
    """A fixed number of cents off, never more than the amount."""

    def __init__(self, name, cents, priority=0):
        self.name = name
        self.cents = cents
        self.priority = priority

    def discount(self, amount_cents):
        return min(self.cents, amount_cents)
`;

const MONEY_PY = `"""Money helpers. All amounts are integer cents; never use floats for money.

docs/SPEC.md "Rounding" governs how any ratio is turned back into cents.
"""


def to_cents(dollars):
    return int(round(dollars * 100))


def floor_cents(amount_cents):
    return int(amount_cents)


def format_money(amount_cents):
    return "$%d.%02d" % (amount_cents // 100, amount_cents % 100)
`;

const MODELS_PY = `"""Cart and line-item value objects. The pricing engine works on the cart's
subtotal (see cart_subtotal), not on individual lines.
"""


class LineItem:
    def __init__(self, sku, unit_cents, quantity):
        self.sku = sku
        self.unit_cents = unit_cents
        self.quantity = quantity

    def line_total(self):
        return self.unit_cents * self.quantity


class Cart:
    def __init__(self, items=None):
        self.items = items or []

    def add(self, item):
        self.items.append(item)

    def subtotal(self):
        return sum(item.line_total() for item in self.items)


def cart_subtotal(cart):
    return cart.subtotal()
`;

const CATALOG_PY = `"""A tiny in-memory product catalog. Not used by the pricing math, but the
handlers look products up here before building a cart.
"""

CATALOG = {
    "BOOK-01": 1999,
    "MUG-07": 1250,
    "PEN-42": 399,
    "DESK-99": 18900,
}


def price_of(sku):
    return CATALOG.get(sku)


def known_skus():
    return sorted(CATALOG)
`;

const README_MD = `# orderkit

A small order-pricing library. An order's total is its cart subtotal with a set
of discount **rules** applied.

## Where things live

- \`pricing.py\` - the engine: \`compute_total(subtotal_cents, rules)\`.
- \`rules.py\` - the rule types (\`PercentRule\`, \`FixedRule\`).
- \`money.py\` - integer-cents money helpers.
- \`models.py\` - \`Cart\` / \`LineItem\`.
- \`catalog.py\` - a demo product catalog.
- \`docs/SPEC.md\` - **the authoritative pricing rules.** If the code and the
  spec disagree, the spec is right and the code is a bug.
- \`docs/ARCHITECTURE.md\` - how the modules fit together.
- \`docs/CHANGELOG.md\` - what changed and when.

## Running the tests

\`python -m unittest test_pricing\`

If a test fails, read \`docs/SPEC.md\` before changing the math - the intended
behaviour is defined there, not inferable from the current code.
`;

const SPEC_MD = `# Pricing specification

This document is authoritative. \`pricing.py\` must implement exactly what is
written here; where the code differs, the code is wrong.

## Inputs

\`compute_total(subtotal_cents, rules)\` receives:

- \`subtotal_cents\`: the pre-discount order total, a non-negative integer in
  cents.
- \`rules\`: a list of discount rules, each exposing \`discount(amount_cents)\`
  and an integer \`priority\`.

It returns the final total in cents, a non-negative integer.

## Rule application

### Ordering

Rules are applied in **descending priority** (highest \`priority\` first). Two
rules with equal priority may be applied in any order; the specification is
written so that the result does not depend on the order of equal-priority rules.

### Base amount - the load-bearing rule

Every rule's discount is computed against the **original subtotal**, NOT against
the running total after earlier rules. Discounts do **not** compound. A 30% rule
and a 40% rule on a $100.00 order remove \`$30.00 + $40.00 = $70.00\`, they do
**not** remove 30% and then 40% of what remains ($58.00 off).

This is the single most common mistake when re-implementing the engine: applying
each discount to the amount left by the previous one. Do not do that.

### Combined cap - the other load-bearing rule

The **sum** of all rule discounts is capped at **50% of the original subtotal**.
Once the accumulated discount reaches half the subtotal, no further discount is
applied. So \`$30.00 + $40.00 = $70.00\` of discount on a $100.00 order is capped
to \`$50.00\`, giving a total of \`$50.00\`, never \`$30.00\`.

The cap is on the *combined* discount, applied after summing every rule, not per
rule.

## Result

\`total = subtotal_cents - min(sum_of_discounts, subtotal_cents // 2)\`

The total is therefore always between 50% and 100% of the subtotal, inclusive,
and is a non-negative integer number of cents.

## Rounding

All arithmetic is in integer cents. A percentage discount floors fractional
cents (integer division), per \`money.floor_cents\`. No banker's rounding is
needed because the cap and the discounts are all integer-cents operations.

## Empty input

With an empty \`rules\` list the total equals the subtotal unchanged.
`;

const ARCHITECTURE_MD = `# Architecture

\`\`\`
catalog.py ──▶ handlers build a Cart (models.py)
                     │
                     ▼
             cart.subtotal()  ── integer cents
                     │
                     ▼
      pricing.compute_total(subtotal, rules) ──▶ final total
                     ▲
                     │
              rules.py (PercentRule, FixedRule)
              money.py (integer-cents helpers)
\`\`\`

## Module responsibilities

- **catalog.py** owns product prices. Nothing downstream mutates it.
- **models.py** turns line items into a subtotal. The pricing engine never sees
  individual lines, only the subtotal - this keeps the discount rules independent
  of how the cart was built.
- **rules.py** defines discount rules. A rule is a pure function of the amount it
  is handed; it does not know about ordering or caps. Those are the *engine's*
  responsibility, defined in docs/SPEC.md, not the rule's.
- **money.py** keeps everything in integer cents. Floats never touch money.
- **pricing.py** is the only place the SPEC's ordering + cap rules are enforced.

## Invariant

Because rules are pure and stateless, the engine must not let one rule's output
feed the next rule's input. Read docs/SPEC.md "Base amount" - each rule sees the
original subtotal. A bug here looks like discounts that are slightly too small
(because they compound) and totals that drop below half the subtotal (because the
cap is missing).
`;

const CHANGELOG_MD = `# Changelog

## Unreleased

- Nothing yet.

## v3.0

- **Spec:** clarified that the 50% combined cap applies to the *sum* of
  discounts, not per rule. No code change was landed for this - see the open bug
  where large discounts still drive totals below 50%.

## v2.0

- Added the **50% combined discount cap** to docs/SPEC.md. Previously discounts
  were uncapped. The engine was supposed to be updated to enforce it.
- Added \`FixedRule\`.

## v1.1

- Established that discounts apply to the **original subtotal**, so multiple
  rules do not compound. Documented under docs/SPEC.md "Base amount".

## v1.0

- Initial engine: \`compute_total\`, \`PercentRule\`, integer-cents money.
`;

const HANDLERS_PY = `"""Request handlers. Build a cart from SKUs, then price it. These are here so
the module graph looks like a real service; the pricing math lives in pricing.py.
"""
from catalog import price_of
from models import Cart, LineItem
from pricing import compute_total


def price_order(skus_with_qty, rules):
    cart = Cart()
    for sku, qty in skus_with_qty:
        unit = price_of(sku)
        if unit is None:
            raise KeyError("unknown sku: %s" % sku)
        cart.add(LineItem(sku, unit, qty))
    return compute_total(cart.subtotal(), rules)
`;

/** The hidden oracle - never shown to the model, written only at test time. Its
 * expectations encode docs/SPEC.md exactly. */
export const EXTRA_HIDDEN_TEST = `import unittest

from pricing import compute_total
from rules import PercentRule, FixedRule


class TestPricing(unittest.TestCase):
    def test_empty_rules(self):
        self.assertEqual(compute_total(10000, []), 10000)

    def test_single_percent(self):
        self.assertEqual(compute_total(10000, [PercentRule("a", 20)]), 8000)

    def test_two_rules_do_not_compound(self):
        # 30% + 40% of the ORIGINAL 10000 = 3000 + 4000 = 7000, capped at 5000.
        rules = [PercentRule("a", 30), PercentRule("b", 40)]
        self.assertEqual(compute_total(10000, rules), 5000)

    def test_combined_cap(self):
        # A single 60% rule is capped at 50%.
        self.assertEqual(compute_total(10000, [PercentRule("big", 60)]), 5000)

    def test_under_cap(self):
        # 10% + 15% = 2500 discount, below the cap.
        rules = [PercentRule("a", 10), PercentRule("b", 15)]
        self.assertEqual(compute_total(10000, rules), 7500)

    def test_fixed_and_percent_capped(self):
        # 4000 fixed + 30% (3000) = 7000, capped at 5000.
        rules = [FixedRule("f", 4000), PercentRule("p", 30)]
        self.assertEqual(compute_total(10000, rules), 5000)


if __name__ == "__main__":
    unittest.main()
`;

/**
 * The files the model can see and explore. Python modules are the working copy it
 * edits; markdown is read-only reference. The hidden test is intentionally NOT
 * here.
 */
export const EXTRA_CORPUS: Record<string, string> = {
  "README.md": README_MD,
  "docs/SPEC.md": SPEC_MD,
  "docs/ARCHITECTURE.md": ARCHITECTURE_MD,
  "docs/CHANGELOG.md": CHANGELOG_MD,
  "pricing.py": PRICING_PY,
  "rules.py": RULES_PY,
  "money.py": MONEY_PY,
  "models.py": MODELS_PY,
  "catalog.py": CATALOG_PY,
  "handlers.py": HANDLERS_PY,
};

/** The Python modules that make up the runnable working copy (no docs). */
export const EXTRA_PY_FILES = [
  "pricing.py",
  "rules.py",
  "money.py",
  "models.py",
  "catalog.py",
  "handlers.py",
];

/** The one file the model is meant to fix. */
export const EXTRA_TARGET_FILE = "pricing.py";
