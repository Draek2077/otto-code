/**
 * The output contract, mirroring @otto-code/cli's output layer: command handlers
 * do not print — they return a typed result plus a schema, and a wrapper renders
 * it in the user-selected format (table / json / yaml / quiet). This is what lets
 * every `otto brain` command support `--format`, `--json`, and `--quiet` uniformly.
 */
export type OutputFormat = "table" | "json" | "yaml";

export interface OutputOptions {
  format: OutputFormat;
  quiet: boolean;
  noHeaders: boolean;
  noColor: boolean;
}

export type ColorName =
  | "red"
  | "green"
  | "blue"
  | "yellow"
  | "cyan"
  | "magenta"
  | "white"
  | "gray"
  | "dim"
  | "bold";

export interface ColumnDef<T> {
  header: string;
  field: keyof T | ((item: T) => unknown);
  width?: number;
  align?: "left" | "right";
  color?: (value: unknown, item: T) => ColorName | undefined;
}

export interface OutputSchema<T> {
  idField: keyof T | ((item: T) => string);
  columns: ColumnDef<T>[];
  /** Optional custom human renderer, used for the table format only. */
  renderHuman?: (data: T | T[], options: OutputOptions) => string;
  /** Optional serializer for json/yaml (defaults to the value itself). */
  serialize?: (data: T | T[]) => unknown;
}

export interface SingleResult<T> {
  type: "single";
  data: T;
  schema: OutputSchema<T>;
}

export interface ListResult<T> {
  type: "list";
  data: T[];
  schema: OutputSchema<T>;
}

export type AnyCommandResult<T> = SingleResult<T> | ListResult<T>;

/** A structured, user-facing error. Thrown by handlers; rendered by withOutput. */
export interface CommandErrorShape {
  code: string;
  message: string;
  details?: unknown;
}

export class CommandError extends Error implements CommandErrorShape {
  code: string;
  details?: unknown;

  constructor(shape: CommandErrorShape) {
    super(shape.message);
    this.name = "CommandError";
    this.code = shape.code;
    this.details = shape.details;
  }
}
