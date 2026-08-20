import { IDENTIFIER_PATTERN } from "./tooling";

export type CsvRow = Record<string, string>;

export function parseCsv(input: string): CsvRow[] {
  const records: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];

    if (inQuotes) {
      if (character === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += character;
      }

      continue;
    }

    if (character === '"') {
      if (field !== "") {
        throw new Error("CSV quote must begin at the start of a field");
      }

      inQuotes = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field);
      records.push(row);
      row = [];
      field = "";
    } else if (character === "\r") {
      if (input[index + 1] !== "\n") {
        row.push(field);
        records.push(row);
        row = [];
        field = "";
      }
    } else {
      field += character;
    }
  }

  if (inQuotes) {
    throw new Error("CSV contains an unterminated quoted field");
  }

  if (field !== "" || row.length > 0) {
    row.push(field);
    records.push(row);
  }

  if (records.length === 0) {
    return [];
  }

  const [header, ...data] = records;

  if (
    !header ||
    header.length === 0 ||
    header.some((column) => column === "")
  ) {
    throw new Error("CSV must contain a nonempty header row");
  }

  if (new Set(header).size !== header.length) {
    throw new Error("CSV header contains duplicate columns");
  }

  for (const column of header) {
    if (!IDENTIFIER_PATTERN.test(column)) {
      throw new Error(`CSV header contains an invalid column name "${column}"`);
    }
  }

  return data
    .filter((values) => values.length > 1 || values[0] !== "")
    .map((values, rowIndex) => {
      if (values.length !== header.length) {
        throw new Error(
          `CSV row ${rowIndex + 2} has ${values.length} values, expected ${header.length}`,
        );
      }

      return Object.fromEntries(
        header.map((column, columnIndex) => [
          column,
          values[columnIndex] ?? "",
        ]),
      );
    });
}
