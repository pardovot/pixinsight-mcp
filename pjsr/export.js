// export_container: writes a slice of a view's process history as a ProcessContainer .xpsm, which
// PixInsight turns into a process icon when the file is opened. The scripting API cannot create
// icons (writeIcon only overwrites an existing one), but .xpsm is plain XML.

var XPSM_HEADER =
   '<?xml version="1.0" encoding="UTF-8"?>\n' +
   '<xpsm version="1.0" xmlns="http://www.pixinsight.com/xpsm" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ' +
   'xsi:schemaLocation="http://www.pixinsight.com/xpsm http://pixinsight.com/xpsm/xpsm-1.0.xsd">\n';
var XPSM_INDENT = "   ";

// One `P.<id> = <value>;` assignment of toSource() output. Group 1 is the parameter id, group 2
// the value's source, which may span lines (curve point tables do).
var ASSIGNMENT_PATTERN = /P\.(\w+)\s*=\s*([\s\S]*?);\s*(?=P\.\w+\s*=|$)/g;
// The process class in toSource()'s first line, `var P = new <Class>;`. Group 1 is the class.
var CLASS_PATTERN = /new\s+(\w+)/;
var NUMBER_PATTERN = /^-?[0-9.]+([eE]-?[0-9]+)?$/;
// An enumerated value such as `CurvesTransformation.AkimaSubsplines`, stored by member name.
var ENUM_PATTERN = /^[A-Za-z_]\w*\.[A-Za-z_]\w*$/;
// The opening of a table in toSource() output, `[ // c0, m, c1` with the line break after it.
// Group 1 is the comma separated column ids.
var TABLE_HEADER_PATTERN = /^\[[ \t]*\/\/([^\n]*)\n/;

function escapeXml(text) {
   return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// A table cell: text is the element's content, a number or boolean its value.
function cellXml(columnId, value, indent) {
   if (typeof value === "string")
      return indent + '<td id="' + columnId + '">' + escapeXml(value) + "</td>\n";
   return indent + '<td id="' + columnId + '" value="' + value + '"/>\n';
}

// A table from its toSource() form: a comment naming the columns, then one array per row. Null
// when the source has no such comment, its rows are not JSON (an enumerated or hexadecimal
// cell) or a row does not fit the columns.
function tableXml(id, source, indent) {
   var header = TABLE_HEADER_PATTERN.exec(source);
   if (!header)
      return null;
   var columns = header[1].split(",").map(function (column) { return column.replace(/^\s+|\s+$/g, ""); });
   var rows;
   try {
      rows = JSON.parse("[" + source.substring(header[0].length));
   } catch (parseError) {
      console.warningln("export_container: table " + id + " is not JSON (" + parseError.message + "), left out");
      return null;
   }
   if (!rows.length)
      return indent + '<table id="' + id + '" rows="0"/>\n';
   var rowIndent = indent + XPSM_INDENT;
   var xml = indent + '<table id="' + id + '" rows="' + rows.length + '">\n';
   for (var index = 0; index < rows.length; ++index) {
      var row = rows[index];
      if (!(row instanceof Array) || row.length !== columns.length)
         return null;
      xml += rowIndent + "<tr>\n";
      for (var column = 0; column < columns.length; ++column)
         xml += cellXml(columns[column], row[column], rowIndent + XPSM_INDENT);
      xml += rowIndent + "</tr>\n";
   }
   return xml + indent + "</table>\n";
}

// A parameter from its value in toSource() output, or null for a value this cannot write.
function parameterXml(id, value, indent) {
   if (value === "true" || value === "false" || NUMBER_PATTERN.test(value))
      return indent + '<parameter id="' + id + '" value="' + value + '"/>\n';
   if (ENUM_PATTERN.test(value))
      return indent + '<parameter id="' + id + '" value="' + value.split(".").pop() + '"/>\n';
   if (value.charAt(0) === '"') {
      var text = value.slice(1, -1);
      return text === ""
         ? indent + '<parameter id="' + id + '"></parameter>\n'
         : indent + '<parameter id="' + id + '">' + escapeXml(text) + "</parameter>\n";
   }
   if (value.charAt(0) === "[")
      return tableXml(id, value, indent);
   return null;
}

// The instance as XML. Parameters that could not be written are added to skipped as <Class>.<id>.
function instanceXml(instance, indent, skipped) {
   var source = instance.toSource();
   var className = CLASS_PATTERN.exec(source)[1];
   var body = source.substring(source.indexOf(";") + 1);
   var xml = indent + '<instance class="' + className + '" version="256" enabled="true">\n';
   var match;
   ASSIGNMENT_PATTERN.lastIndex = 0;
   while ((match = ASSIGNMENT_PATTERN.exec(body)) !== null) {
      var parameter = parameterXml(match[1], match[2].replace(/^\s+|\s+$/g, ""), indent + XPSM_INDENT);
      if (parameter === null)
         skipped.push(className + "." + match[1]);
      else
         xml += parameter;
   }
   return xml + indent + "</instance>\n";
}

function handleExportContainer(command) {
   var parameters = command.parameters;
   var outputPath = parameters.outputPath;
   if (!outputPath)
      throw new Error("outputPath is required");
   var iconName = parameters.iconName;
   var view = requireView(parameters.viewId).window.mainView;
   var history = view.processing;
   var total = history ? history.length : 0;
   var firstIndex = Math.max(0, parameters.fromIndex != null ? parameters.fromIndex : 0);
   var endIndex = Math.min(total, parameters.toIndex != null ? parameters.toIndex : total);
   var instances = [];
   for (var index = firstIndex; index < endIndex; ++index)
      instances.push(history.at(index));
   if (!instances.length)
      throw new Error("No history steps in [" + firstIndex + "," + endIndex + ") for " + view.id +
                      " (history has " + total + "). view.processing resets when a file is saved and " +
                      "reopened, and createNewImage outputs start with an empty history, so export while " +
                      "the view is live.");

   var instanceId = iconName + "_inst";
   var xml = XPSM_HEADER + XPSM_INDENT + '<instance class="ProcessContainer" id="' + instanceId + '">\n';
   var processIds = [];
   var skipped = [];
   for (var index = 0; index < instances.length; ++index) {
      xml += instanceXml(instances[index], XPSM_INDENT + XPSM_INDENT, skipped);
      processIds.push(instances[index].processId());
   }
   xml += XPSM_INDENT + "</instance>\n" +
          XPSM_INDENT + '<icon id="' + iconName + '" instance="' + instanceId +
          '" xpos="16" ypos="688" workspace="Workspace01"/>\n</xpsm>\n';

   File.writeTextFile(outputPath, xml);
   return success({ path: outputPath, count: instances.length, processes: processIds,
                    fromIndex: firstIndex, toIndex: endIndex, skipped: skipped },
                  "Wrote container '" + iconName + "' with " + instances.length + " process(es) (" +
                  processIds.join(", ") + ") to " + outputPath +
                  (skipped.length ? ", without " + skipped.join(", ") : ""));
}
