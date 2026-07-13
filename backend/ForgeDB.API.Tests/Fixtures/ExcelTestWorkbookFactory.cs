using System.IO.Compression;
using System.Security;
using System.Text;
using Microsoft.AspNetCore.Http;

namespace ForgeDB.API.Tests.Fixtures;

internal static class ExcelTestWorkbookFactory
{
    public static IFormFile Create(params (string Name, string?[][] Rows)[] sheets)
    {
        var stream = new MemoryStream();
        using (var archive = new ZipArchive(stream, ZipArchiveMode.Create, leaveOpen: true))
        {
            Write(archive, "[Content_Types].xml", ContentTypes(sheets.Length));
            Write(archive, "_rels/.rels", RootRelationships);
            Write(archive, "xl/workbook.xml", Workbook(sheets));
            Write(archive, "xl/_rels/workbook.xml.rels", WorkbookRelationships(sheets.Length));
            for (var index = 0; index < sheets.Length; index++)
            {
                Write(archive, $"xl/worksheets/sheet{index + 1}.xml", Worksheet(sheets[index].Rows));
            }
        }
        stream.Position = 0;
        return new FormFile(stream, 0, stream.Length, "file", "sample.xlsx")
        {
            Headers = new HeaderDictionary(),
            ContentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        };
    }

    private static void Write(ZipArchive archive, string path, string content)
    {
        var entry = archive.CreateEntry(path, CompressionLevel.Fastest);
        using var writer = new StreamWriter(entry.Open(), new UTF8Encoding(false));
        writer.Write(content);
    }

    private static string ContentTypes(int sheetCount) => $"""
        <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
        <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
          <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
          <Default Extension="xml" ContentType="application/xml"/>
          <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
          {string.Join(string.Empty, Enumerable.Range(1, sheetCount).Select(index => $"<Override PartName=\"/xl/worksheets/sheet{index}.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/>"))}
        </Types>
        """;

    private const string RootRelationships = """
        <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
        </Relationships>
        """;

    private static string Workbook((string Name, string?[][] Rows)[] sheets) => $"""
        <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
        <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <sheets>{string.Join(string.Empty, sheets.Select((sheet, index) => $"<sheet name=\"{Escape(sheet.Name)}\" sheetId=\"{index + 1}\" r:id=\"rId{index + 1}\"/>"))}</sheets>
        </workbook>
        """;

    private static string WorkbookRelationships(int sheetCount) => $"""
        <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          {string.Join(string.Empty, Enumerable.Range(1, sheetCount).Select(index => $"<Relationship Id=\"rId{index}\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet{index}.xml\"/>"))}
        </Relationships>
        """;

    private static string Worksheet(string?[][] rows)
    {
        var rowXml = rows.Select((row, rowIndex) =>
        {
            var cells = row.Select((value, columnIndex) => value is null
                ? string.Empty
                : $"<c r=\"{ColumnName(columnIndex + 1)}{rowIndex + 1}\" t=\"inlineStr\"><is><t xml:space=\"preserve\">{Escape(value)}</t></is></c>");
            return $"<row r=\"{rowIndex + 1}\">{string.Join(string.Empty, cells)}</row>";
        });

        return $"""
            <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
            <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
              <sheetData>{string.Join(string.Empty, rowXml)}</sheetData>
            </worksheet>
            """;
    }

    private static string ColumnName(int index)
    {
        var result = string.Empty;
        while (index > 0)
        {
            index--;
            result = (char)('A' + index % 26) + result;
            index /= 26;
        }
        return result;
    }

    private static string Escape(string value) => SecurityElement.Escape(value) ?? string.Empty;
}
