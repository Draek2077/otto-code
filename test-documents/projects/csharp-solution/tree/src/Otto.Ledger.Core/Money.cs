namespace Otto.Ledger.Core;

/// <summary>
/// A currency amount held as integer minor units. Money in a floating-point type
/// is a rounding bug waiting for a large enough transaction, so the conversion to
/// decimal happens once, at the formatting boundary.
/// </summary>
public readonly record struct Money(long MinorUnits, string Currency)
{
    public static Money Zero(string currency) => new(0, currency);

    public static Money FromMajorUnits(decimal amount, string currency) =>
        new((long)Math.Round(amount * 100m, MidpointRounding.ToEven), currency);

    public decimal ToMajorUnits() => MinorUnits / 100m;

    public bool IsNegative => MinorUnits < 0;

    public static Money operator +(Money left, Money right)
    {
        AssertSameCurrency(left, right);
        return new Money(left.MinorUnits + right.MinorUnits, left.Currency);
    }

    public static Money operator -(Money left, Money right)
    {
        AssertSameCurrency(left, right);
        return new Money(left.MinorUnits - right.MinorUnits, left.Currency);
    }

    public static Money operator -(Money value) => new(-value.MinorUnits, value.Currency);

    private static void AssertSameCurrency(Money left, Money right)
    {
        if (!string.Equals(left.Currency, right.Currency, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException(
                $"cannot combine {left.Currency} with {right.Currency}");
        }
    }

    public override string ToString() => $"{ToMajorUnits():N2} {Currency.ToUpperInvariant()}";
}
