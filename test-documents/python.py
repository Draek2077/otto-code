"""A self-contained sieve and a small meditation on prime gaps.

Exercises docstrings, type hints, dataclasses, f-strings, comprehensions,
decorators, context managers and the walrus operator.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from functools import lru_cache
from itertools import pairwise


@dataclass(frozen=True, slots=True)
class Gap:
    """The distance between two consecutive primes."""

    lower: int
    upper: int
    tags: list[str] = field(default_factory=list)

    @property
    def size(self) -> int:
        return self.upper - self.lower

    def __str__(self) -> str:
        return f"{self.lower} → {self.upper} (gap {self.size})"


@lru_cache(maxsize=8)
def sieve(limit: int) -> tuple[int, ...]:
    """Every prime below `limit`, by elimination."""
    flags = bytearray([1]) * limit
    flags[0:2] = b"\x00\x00"
    for candidate in range(2, int(limit**0.5) + 1):
        if flags[candidate]:
            flags[candidate * candidate :: candidate] = bytearray(
                len(range(candidate * candidate, limit, candidate))
            )
    return tuple(index for index, is_prime in enumerate(flags) if is_prime)


def widest_gaps(limit: int = 10_000, top: int = 5) -> list[Gap]:
    gaps = [Gap(lower, upper) for lower, upper in pairwise(sieve(limit))]
    return sorted(gaps, key=lambda gap: gap.size, reverse=True)[:top]


def main() -> None:
    primes = sieve(10_000)
    print(f"{len(primes)} primes below 10,000; the last is {primes[-1]}")

    for rank, gap in enumerate(widest_gaps(), start=1):
        marker = "★" if gap.size >= 34 else " "
        print(f"{marker} {rank}. {gap}")

    if (twins := [(a, b) for a, b in pairwise(primes) if b - a == 2]) :
        print(f"{len(twins)} twin pairs, the largest being {twins[-1]}")


if __name__ == "__main__":
    main()
