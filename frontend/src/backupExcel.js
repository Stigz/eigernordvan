const excelSheetNameLimit = 31;

const safeExcelSheetName = (name, usedNames) => {
  const cleaned = String(name || "Sheet")
    .replace(/[\\/?*:[\]]/g, " ")
    .trim()
    .slice(0, excelSheetNameLimit) || "Sheet";
  let candidate = cleaned;
  let index = 2;

  while (usedNames.has(candidate)) {
    const suffix = ` ${index}`;
    candidate = `${cleaned.slice(0, excelSheetNameLimit - suffix.length)}${suffix}`;
    index += 1;
  }

  usedNames.add(candidate);
  return candidate;
};

const flattenForExcel = (value) => {
  if (value === null || value === undefined) {
    return "";
  }
  if (Array.isArray(value) || typeof value === "object") {
    return JSON.stringify(value);
  }
  return value;
};

const buildExcelRows = (items) => {
  if (!Array.isArray(items) || items.length === 0) {
    return [{ notice: "No rows exported for this table." }];
  }

  return items.map((item) =>
    Object.fromEntries(
      Object.entries(item || {}).map(([key, value]) => [key, flattenForExcel(value)]),
    ),
  );
};

const escapeXml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const cellTypeAndValue = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return { type: "Number", value };
  }
  if (typeof value === "boolean") {
    return { type: "String", value: value ? "true" : "false" };
  }
  return { type: "String", value: value ?? "" };
};

const rowsToWorksheetXml = (rows) => {
  const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const headerRow = `<Row>${columns
    .map((column) => `<Cell><Data ss:Type="String">${escapeXml(column)}</Data></Cell>`)
    .join("")}</Row>`;
  const dataRows = rows
    .map(
      (row) =>
        `<Row>${columns
          .map((column) => {
            const { type, value } = cellTypeAndValue(row[column]);
            return `<Cell><Data ss:Type="${type}">${escapeXml(value)}</Data></Cell>`;
          })
          .join("")}</Row>`,
    )
    .join("");

  return `<Table>${headerRow}${dataRows}</Table>`;
};

const getBackupSheets = (payload) => {
  const tables = payload?.tables && typeof payload.tables === "object" ? payload.tables : {};
  const tableEntries = Object.entries(tables);

  if (tableEntries.length > 0) {
    return tableEntries
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([label, tableExport]) => ({ name: label, rows: buildExcelRows(tableExport?.items) }));
  }

  return [
    { name: "trips", rows: buildExcelRows(payload?.trips) },
    { name: "fuel", rows: buildExcelRows(payload?.fuel) },
    { name: "bookings", rows: buildExcelRows(payload?.bookings) },
    { name: "work", rows: buildExcelRows([payload?.work || {}]) },
    { name: "costs", rows: buildExcelRows(payload?.costs?.entries) },
  ];
};

export const buildBackupExcelFile = (payload) => {
  const usedNames = new Set();
  const generatedAt = payload?.generated_at || new Date().toISOString();
  const metaRows = [
    { field: "schema_version", value: payload?.schema_version || "" },
    { field: "generated_at", value: generatedAt },
  ];
  const sheets = [{ name: "backup_meta", rows: metaRows }, ...getBackupSheets(payload)];
  const worksheets = sheets
    .map(({ name, rows }) => {
      const sheetName = safeExcelSheetName(name, usedNames);
      return `<Worksheet ss:Name="${escapeXml(sheetName)}">${rowsToWorksheetXml(rows)}</Worksheet>`;
    })
    .join("");
  const xml = `<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet" xmlns:html="http://www.w3.org/TR/REC-html40">${worksheets}</Workbook>`;
  const timestamp = generatedAt.replace(/[:.]/g, "-");

  return {
    blob: new Blob([xml], { type: "application/vnd.ms-excel;charset=utf-8" }),
    fileName: `van-backup-${timestamp}.xls`,
    generatedAt,
  };
};

export const downloadBackupExcelFile = (payload) => {
  const { blob, fileName, generatedAt } = buildBackupExcelFile(payload);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);

  return { fileName, generatedAt };
};
