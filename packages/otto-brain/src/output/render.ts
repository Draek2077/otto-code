/**
 * Format renderers for the output layer. chalk lives here and nowhere else -
 * command handlers express color declaratively via ColumnDef.color, and only
 * these renderers turn a result into text. Table output is ANSI-aware so colored
 * cells still align.
 */
import chalk from "chalk";
import { stringify as toYaml } from "yaml";

import type {
  AnyCommandResult,
  ColorName,
  ColumnDef,
  CommandErrorShape,
  OutputOptions,
  OutputSchema,
} from "./types.js";

const ANSI = /\[[0-9;]*m/g;

function stripAnsi(value: string): string {
  return value.replace(ANSI, "");
}

const COLORS: Record<ColorName, (s: string) => string> = {
  red: chalk.red,
  green: chalk.green,
  blue: chalk.blue,
  yellow: chalk.yellow,
  cyan: chalk.cyan,
  magenta: chalk.magenta,
  white: chalk.white,
  gray: chalk.gray,
  dim: chalk.dim,
  bold: chalk.bold,
};

function fieldValue<T>(item: T, column: ColumnDef<T>): unknown {
  return typeof column.field === "function" ? column.field(item) : item[column.field];
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "-";
  return String(value);
}

function padCell(text: string, width: number, align: "left" | "right"): string {
  const visible = stripAnsi(text).length;
  if (visible >= width) return text;
  const pad = " ".repeat(width - visible);
  return align === "right" ? pad + text : text + pad;
}

function renderTable<T>(rows: T[], schema: OutputSchema<T>, options: OutputOptions): string {
  const widths = schema.columns.map((col) => {
    const cells = rows.map((r) => stripAnsi(cellText(fieldValue(r, col))).length);
    return Math.max(col.width ?? 0, col.header.length, ...cells, 0);
  });

  const lines: string[] = [];
  if (!options.noHeaders) {
    const header = schema.columns
      .map((col, i) =>
        padCell(
          options.noColor ? col.header : chalk.bold(col.header),
          widths[i],
          col.align ?? "left",
        ),
      )
      .join("  ");
    lines.push(header);
  }

  for (const row of rows) {
    const cells = schema.columns.map((col, i) => {
      const raw = fieldValue(row, col);
      let text = cellText(raw);
      if (!options.noColor && col.color) {
        const name = col.color(raw, row);
        if (name) text = COLORS[name](text);
      }
      return padCell(text, widths[i], col.align ?? "left");
    });
    lines.push(cells.join("  "));
  }
  return lines.join("\n");
}

export function renderResult<T>(result: AnyCommandResult<T>, options: OutputOptions): string {
  const rows = result.type === "list" ? result.data : [result.data];

  if (options.quiet) {
    const { idField } = result.schema;
    return rows
      .map((r) => (typeof idField === "function" ? idField(r) : String(r[idField])))
      .join("\n");
  }

  if (options.format === "json") {
    const data = result.schema.serialize ? result.schema.serialize(result.data) : result.data;
    return JSON.stringify(data, null, 2);
  }
  if (options.format === "yaml") {
    const data = result.schema.serialize ? result.schema.serialize(result.data) : result.data;
    return toYaml(data).trimEnd();
  }

  if (result.schema.renderHuman) return result.schema.renderHuman(result.data, options);
  return renderTable(rows, result.schema, options);
}

export function renderError(error: CommandErrorShape, options: OutputOptions): string {
  if (options.format === "json") return JSON.stringify({ error }, null, 2);
  if (options.format === "yaml") return toYaml({ error }).trimEnd();
  const prefix = options.noColor ? "Error: " : chalk.red("Error: ");
  const details = error.details ? `\n  ${String(error.details)}` : "";
  return `${prefix}${error.message}${details}`;
}
