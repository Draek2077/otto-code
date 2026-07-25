<?php

/**
 * A self-contained roman numeral converter, both directions.
 *
 * Exercises namespaces, typed properties, enums, match expressions,
 * heredocs, arrow functions and attributes.
 */

declare(strict_types=1);

namespace FieldNotebook;

enum Notation: string
{
    case Roman = 'roman';
    case Arabic = 'arabic';

    public function label(): string
    {
        return match ($this) {
            Notation::Roman => 'Roman numerals',
            Notation::Arabic => 'Arabic numerals',
        };
    }
}

final class Numeral
{
    /** @var array<string, int> */
    private const VALUES = [
        'M' => 1000, 'CM' => 900, 'D' => 500, 'CD' => 400,
        'C' => 100,  'XC' => 90,  'L' => 50,  'XL' => 40,
        'X' => 10,   'IX' => 9,   'V' => 5,   'IV' => 4,
        'I' => 1,
    ];

    public function __construct(private readonly int $value)
    {
        if ($value < 1 || $value > 3999) {
            throw new \InvalidArgumentException("Out of range: {$value}");
        }
    }

    public function toRoman(): string
    {
        $remaining = $this->value;
        $out = '';

        foreach (self::VALUES as $symbol => $amount) {
            while ($remaining >= $amount) {
                $out .= $symbol;
                $remaining -= $amount;
            }
        }

        return $out;
    }

    public static function fromRoman(string $roman): self
    {
        $total = 0;
        $offset = 0;
        $roman = strtoupper(trim($roman));

        while ($offset < strlen($roman)) {
            $pair = substr($roman, $offset, 2);
            $single = substr($roman, $offset, 1);

            if (isset(self::VALUES[$pair])) {
                $total += self::VALUES[$pair];
                $offset += 2;
            } else {
                $total += self::VALUES[$single] ?? 0;
                $offset += 1;
            }
        }

        return new self($total);
    }

    public function __toString(): string
    {
        return $this->toRoman();
    }
}

$years = [1698, 1810, 1904, 2026];
$rendered = array_map(fn(int $year): string => (new Numeral($year))->toRoman(), $years);

echo <<<REPORT
    {$years[0]} => {$rendered[0]}
    {$years[1]} => {$rendered[1]}
    {$years[2]} => {$rendered[2]}
    {$years[3]} => {$rendered[3]}

    Round trip: MMXXVI =>
    REPORT;

echo Numeral::fromRoman('MMXXVI')->toRoman(), PHP_EOL;
echo Notation::Roman->label(), PHP_EOL;
