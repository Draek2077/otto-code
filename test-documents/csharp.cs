// A self-contained lighthouse register with LINQ queries.
//
// Exercises records, pattern matching, LINQ, nullable reference types,
// string interpolation, local functions and file-scoped namespaces.

using System;
using System.Collections.Generic;
using System.Linq;

namespace FieldNotebook;

public record Lighthouse(string Name, int Established, double HeightMetres, bool Active)
{
    public int Age => DateTime.UtcNow.Year - Established;

    public string Describe() => this switch
    {
        { Active: false } => $"{Name} — dark since it was decommissioned",
        { HeightMetres: > 50 } => $"{Name} — a tower, {HeightMetres} m",
        _ => $"{Name} — a light, {HeightMetres} m"
    };
}

public static class Register
{
    private static readonly IReadOnlyList<Lighthouse> All = new List<Lighthouse>
    {
        new("Eddystone", 1698, 49.0, true),
        new("Fastnet", 1904, 54.0, true),
        new("Rubjerg Knude", 1900, 23.0, false),
        new("Bell Rock", 1810, 35.3, true),
        new("La Jument", 1911, 47.0, true),
    };

    public static void Main()
    {
        var oldestFirst = All
            .Where(light => light.Active)
            .OrderBy(light => light.Established)
            .ThenByDescending(light => light.HeightMetres)
            .ToList();

        Console.WriteLine($"{oldestFirst.Count} active lights, oldest first:\n");

        foreach (var light in oldestFirst)
        {
            Console.WriteLine($"  {light.Established}  {light.Describe()} ({light.Age} years)");
        }

        var averageHeight = All.Average(light => light.HeightMetres);
        Console.WriteLine($"\nMean height: {averageHeight:F1} m");

        var tallest = All.MaxBy(light => light.HeightMetres);
        Console.WriteLine($"Tallest: {tallest?.Name ?? "none recorded"}");

        static string Century(int year) => $"{(year / 100) + 1}th";

        var byCentury = All.GroupBy(light => Century(light.Established));
        foreach (var group in byCentury.OrderBy(g => g.Key))
        {
            Console.WriteLine($"{group.Key} century: {string.Join(", ", group.Select(l => l.Name))}");
        }
    }
}
