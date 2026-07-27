namespace Otto.Ledger.Core;

public enum EntryKind
{
    Debit,
    Credit,
}

public sealed record Entry(string AccountId, EntryKind Kind, Money Amount, string Memo)
{
    /// <summary>Signed contribution of this entry to its account's balance.</summary>
    public Money SignedAmount => Kind == EntryKind.Credit ? Amount : -Amount;
}

public sealed class LedgerException : Exception
{
    public LedgerException(string message) : base(message) { }
}

public sealed class Account
{
    public Account(string id, string name, string currency)
    {
        if (string.IsNullOrWhiteSpace(id))
        {
            throw new LedgerException("account id cannot be blank");
        }

        Id = id;
        Name = name;
        Currency = currency;
    }

    public string Id { get; }

    public string Name { get; }

    public string Currency { get; }
}

/// <summary>
/// A double-entry general ledger. Every posting carries a matching debit and credit, which
/// is what makes <see cref="IsBalanced"/> a real invariant rather than a hope.
/// </summary>
public sealed class GeneralLedger
{
    private readonly Dictionary<string, Account> _accounts = new(StringComparer.Ordinal);
    private readonly List<Entry> _entries = new();

    public IReadOnlyCollection<Account> Accounts => _accounts.Values;

    public IReadOnlyList<Entry> Entries => _entries;

    public void OpenAccount(Account account)
    {
        if (!_accounts.TryAdd(account.Id, account))
        {
            throw new LedgerException($"account '{account.Id}' already exists");
        }
    }

    public Account Require(string accountId) =>
        _accounts.TryGetValue(accountId, out var account)
            ? account
            : throw new LedgerException($"unknown account '{accountId}'");

    /// <summary>Posts a transfer as a debit on <paramref name="fromId"/> and a credit on <paramref name="toId"/>.</summary>
    public void Post(string fromId, string toId, Money amount, string memo)
    {
        if (amount.MinorUnits <= 0)
        {
            throw new LedgerException("a posting must be for a positive amount");
        }

        var from = Require(fromId);
        var to = Require(toId);
        if (!string.Equals(from.Currency, to.Currency, StringComparison.OrdinalIgnoreCase))
        {
            throw new LedgerException(
                $"cannot post {from.Currency} to a {to.Currency} account");
        }

        _entries.Add(new Entry(fromId, EntryKind.Debit, amount, memo));
        _entries.Add(new Entry(toId, EntryKind.Credit, amount, memo));
    }

    public Money BalanceOf(string accountId)
    {
        var account = Require(accountId);
        return _entries
            .Where(entry => entry.AccountId == accountId)
            .Aggregate(Money.Zero(account.Currency), (total, entry) => total + entry.SignedAmount);
    }

    /// <summary>True when every currency's debits and credits cancel out.</summary>
    public bool IsBalanced =>
        _entries
            .GroupBy(entry => entry.Amount.Currency, StringComparer.OrdinalIgnoreCase)
            .All(group => group.Sum(entry => entry.SignedAmount.MinorUnits) == 0);

    public IEnumerable<Account> Overdrawn() =>
        _accounts.Values.Where(account => BalanceOf(account.Id).IsNegative);
}
