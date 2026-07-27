using Otto.Ledger.Core;

namespace Otto.Ledger.Cli;

internal static class Program
{
    private const string Currency = "USD";

    private static int Main(string[] args)
    {
        try
        {
            var ledger = SeedDemoLedger();

            if (args.Length > 0 && args[0] == "--overdrawn")
            {
                return ReportOverdrawn(ledger);
            }

            PrintTrialBalance(ledger);
            return ledger.IsBalanced ? 0 : 1;
        }
        catch (LedgerException error)
        {
            Console.Error.WriteLine($"error: {error.Message}");
            return 1;
        }
    }

    private static GeneralLedger SeedDemoLedger()
    {
        var ledger = new GeneralLedger();
        ledger.OpenAccount(new Account("cash", "Cash on hand", Currency));
        ledger.OpenAccount(new Account("revenue", "Revenue", Currency));
        ledger.OpenAccount(new Account("rent", "Rent expense", Currency));

        ledger.Post("revenue", "cash", Money.FromMajorUnits(4_200.00m, Currency), "March invoices");
        ledger.Post("cash", "rent", Money.FromMajorUnits(1_750.00m, Currency), "March rent");
        ledger.Post("revenue", "cash", Money.FromMajorUnits(980.50m, Currency), "Support retainer");

        return ledger;
    }

    private static void PrintTrialBalance(GeneralLedger ledger)
    {
        var width = ledger.Accounts.Max(account => account.Name.Length);

        Console.WriteLine("Trial balance");
        Console.WriteLine(new string('-', width + 20));

        foreach (var account in ledger.Accounts.OrderBy(a => a.Id, StringComparer.Ordinal))
        {
            var balance = ledger.BalanceOf(account.Id);
            Console.WriteLine($"{account.Name.PadRight(width)}  {balance,18}");
        }

        Console.WriteLine();
        Console.WriteLine($"entries:  {ledger.Entries.Count}");
        Console.WriteLine($"balanced: {(ledger.IsBalanced ? "yes" : "NO")}");
    }

    private static int ReportOverdrawn(GeneralLedger ledger)
    {
        var overdrawn = ledger.Overdrawn().ToList();
        if (overdrawn.Count == 0)
        {
            Console.WriteLine("no overdrawn accounts");
            return 0;
        }

        foreach (var account in overdrawn)
        {
            Console.WriteLine($"{account.Id}: {ledger.BalanceOf(account.Id)}");
        }

        return 1;
    }
}
