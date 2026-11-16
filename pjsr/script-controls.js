// The controls of a script's dialog for run_script: finding them, describing them and setting them the
// way a user would. Every kind of control is one entry of CONTROL_KINDS.

// How far the search follows properties and children from a dialog, and a control's parents to it.
var CONTROL_SEARCH_DEPTH = 5;
var CONTROL_PARENT_DEPTH = 30;
// Native properties that link to other controls without containing them.
var CONTROL_LINKS = ["parent", "nextSiblingToFocus", "previousSiblingToFocus"];
// Pixels a label may overlap its control and still count as beside it, and how far above a control a
// label may sit.
var LABEL_OVERLAP = 4;
var LABEL_ABOVE = 40;
// Characters of a tooltip kept in a control's description.
var TOOLTIP_LENGTH = 160;
// Mouse handlers that make a control a drawing area, which a headless run cannot use.
var MOUSE_HANDLERS = ["onMousePress", "onMouseRelease", "onMouseMove", "onMouseDoubleClick"];

function isInstanceOf(value, typeName) {
   var type = GLOBAL_SCOPE[typeName];
   return typeof type === "function" && value instanceof type;
}

function hasMouseHandler(control) {
   return MOUSE_HANDLERS.some(function (handler) { return typeof control[handler] === "function"; });
}

// Label text without markup, mnemonic ampersands or a trailing colon.
function cleanLabel(text) {
   return String(text).replace(/<[^>]*>/g, "").replace(/&/g, "").replace(/:\s*$/, "").trim();
}

function callHandler(control, handler, argumentList) {
   if (typeof control[handler] === "function")
      control[handler].apply(control, argumentList || []);
}

function comboItems(control) {
   var items = [];
   for (var i = 0; i < control.numberOfItems; ++i)
      items.push(String(control.itemText(i)));
   return items;
}

function treeNodes(tree) {
   var nodes = [];
   (function collect(parent) {
      for (var i = 0; i < parent.numberOfChildren; ++i) {
         var node = parent.child(i);
         nodes.push(node);
         collect(node);
      }
   })(tree);
   return nodes;
}

function nodeText(node) {
   return String(node.text(0));
}

// A color as #AARRGGBB, the form colorValue reads back.
function colorText(color) {
   return "#" + ("00000000" + (color >>> 0).toString(16)).slice(-8).toUpperCase();
}

function colorValue(value) {
   if (typeof value === "number")
      return value >>> 0;
   // #RRGGBB or #AARRGGBB. Group 1 is the hex digits.
   var match = /^#?([0-9a-f]{6}|[0-9a-f]{8})$/i.exec(String(value));
   if (!match)
      throw new Error("Color " + JSON.stringify(value) + " is not #RRGGBB or #AARRGGBB");
   return parseInt(match[1].length === 6 ? "ff" + match[1] : match[1], 16) >>> 0;
}

// The kinds of control a run can describe and set, in the order they are recognized: a ColorComboBox
// and a ViewList are combo boxes too. NumericControl and ColorComboBox are script code (the pjsr
// includes or the V8 bootstrap), recognized by their parts. A kind with labelled set takes the text of
// a label beside or above it, the others carry their own. describe returns the value and what else
// tells the value apart, set takes the value the way a user would set it, so the script's handlers run.
var CONTROL_KINDS = [
   {
      kind: "numeric",
      matches: function (control) {
         return control instanceof Control && typeof control.setValue === "function" && control.label && control.edit && control.slider;
      },
      label: function (control) { return cleanLabel(control.label.text); },
      describe: function (control) { return { value: control.value, range: [control.lowerBound, control.upperBound] }; },
      set: function (control, value) {
         control.setValue(Number(value));
         callHandler(control, "onValueUpdated", [control.value]);
      }
   },
   {
      kind: "color", labelled: true,
      matches: function (control) { return isInstanceOf(control, "ComboBox") && typeof control.colorForIndex === "function"; },
      // currentColor is a method on the legacy engine and a property on V8.
      describe: function (control) {
         return { value: colorText(typeof control.currentColor === "function" ? control.currentColor() : control.currentColor) };
      },
      set: function (control, value) {
         var color = colorValue(value);
         if (typeof control.currentColor === "function") control.setCurrentColor(color);
         else control.currentColor = color;
         callHandler(control, "onColorSelected", [color]);
      }
   },
   {
      kind: "checkbox",
      matches: function (control) { return isInstanceOf(control, "CheckBox"); },
      label: function (control) { return cleanLabel(control.text); },
      describe: function (control) { return { value: control.checked }; },
      set: function (control, value) {
         control.checked = value === true || value === "true";
         callHandler(control, "onCheck", [control.checked]);
      }
   },
   {
      kind: "radio",
      matches: function (control) { return isInstanceOf(control, "RadioButton"); },
      label: function (control) { return cleanLabel(control.text); },
      describe: function (control) { return { value: control.checked }; },
      set: function (control, value) {
         control.checked = value === true || value === "true";
         callHandler(control, "onCheck", [control.checked]);
      }
   },
   {
      kind: "view", labelled: true,
      matches: function (control) { return isInstanceOf(control, "ViewList"); },
      describe: function (control) {
         return { value: control.currentView && !control.currentView.isNull ? control.currentView.id : null };
      },
      set: function (control, value, name) {
         var view = requireView(value);
         control.currentView = view;
         // A view list ignores a view it does not offer, a preview where it lists main views only.
         if (control.currentView.isNull || control.currentView.id !== view.id)
            throw new Error("View list '" + name + "' does not offer " + view.id);
         callHandler(control, "onViewSelected", [view]);
      }
   },
   {
      kind: "combo", labelled: true,
      matches: function (control) { return isInstanceOf(control, "ComboBox"); },
      describe: function (control) {
         var items = comboItems(control);
         return { value: control.currentItem >= 0 ? items[control.currentItem] : null, items: items };
      },
      // An item by its text, case insensitive, or by its index.
      set: function (control, value, name) {
         var items = comboItems(control).map(function (item) { return item.toLowerCase(); });
         var index = typeof value === "number" ? value : items.indexOf(String(value).toLowerCase());
         if (index < 0 || index >= items.length)
            throw new Error("Combo box '" + name + "' has no item " + JSON.stringify(value));
         control.currentItem = index;
         callHandler(control, "onItemSelected", [index]);
      }
   },
   {
      kind: "spin", labelled: true,
      matches: function (control) { return isInstanceOf(control, "SpinBox"); },
      describe: function (control) { return { value: control.value, range: [control.minValue, control.maxValue] }; },
      set: function (control, value) {
         control.value = Math.round(Number(value));
         callHandler(control, "onValueUpdated", [control.value]);
      }
   },
   {
      kind: "slider", labelled: true,
      matches: function (control) { return isInstanceOf(control, "Slider"); },
      describe: function (control) { return { value: control.value, range: [control.minValue, control.maxValue] }; },
      set: function (control, value) {
         control.value = Math.round(Number(value));
         callHandler(control, "onValueUpdated", [control.value]);
      }
   },
   {
      kind: "edit", labelled: true,
      matches: function (control) { return isInstanceOf(control, "Edit"); },
      describe: function (control) { return { value: String(control.text) }; },
      set: function (control, value) {
         control.text = String(value);
         callHandler(control, "onTextUpdated", [control.text]);
         callHandler(control, "onEditCompleted");
      }
   },
   {
      kind: "tree", labelled: true,
      matches: function (control) { return isInstanceOf(control, "TreeBox"); },
      // The value is the checked items of a list with checkboxes, else the selected ones.
      describe: function (control) {
         var nodes = treeNodes(control);
         var checkable = nodes.some(function (node) { return node.checkable; });
         var chosen = nodes.filter(function (node) { return checkable ? node.checked : node.selected; });
         return { value: chosen.map(nodeText), items: nodes.map(nodeText) };
      },
      // Checks the listed items and unchecks the rest, or selects them in a list without checkboxes.
      set: function (control, value, name) {
         var nodes = treeNodes(control);
         var texts = nodes.map(function (node) { return nodeText(node).toLowerCase(); });
         var wanted = (value instanceof Array ? value : [value]).map(function (item) { return String(item).toLowerCase(); });
         wanted.forEach(function (item) {
            if (texts.indexOf(item) < 0)
               throw new Error("List '" + name + "' has no item " + JSON.stringify(item));
         });
         var checkable = nodes.some(function (node) { return node.checkable; });
         nodes.forEach(function (node, index) {
            var include = wanted.indexOf(texts[index]) >= 0;
            if (!checkable) {
               node.selected = include;
            } else if (node.checkable && node.checked !== include) {
               node.checked = include;
               callHandler(control, "onNodeUpdated", [node, 0]);
            }
         });
         if (!checkable)
            callHandler(control, "onNodeSelectionUpdated");
      }
   },
   {
      kind: "button",
      matches: function (control) { return isInstanceOf(control, "PushButton") || isInstanceOf(control, "ToolButton"); },
      label: function (control) { return cleanLabel(control.text); },
      describe: function () { return {}; }
   },
   {
      kind: "canvas",
      matches: function (control) { return control instanceof Control && hasMouseHandler(control); },
      label: function () { return ""; },
      describe: function () { return {}; }
   }
];

function controlKind(control) {
   for (var i = 0; i < CONTROL_KINDS.length; ++i)
      if (CONTROL_KINDS[i].matches(control))
         return CONTROL_KINDS[i];
   return null;
}

// A control's rectangle in its dialog's coordinates, or null when its parents do not lead there.
function dialogRect(control, dialog) {
   var x = 0, y = 0, node = control;
   for (var depth = 0; node && node !== dialog && depth < CONTROL_PARENT_DEPTH; ++depth) {
      x += node.position.x;
      y += node.position.y;
      node = node.parent;
   }
   return node === dialog ? { x: x, y: y, width: control.width, height: control.height } : null;
}

// The text of the label laid out beside a control, else of the one just above it. Empty when the
// dialog has no layout or no label is placed there. A dialog never shown still has its layout.
function placedLabel(control, labels, dialog) {
   var rect = dialogRect(control, dialog);
   if (rect === null || rect.width === 0)
      return "";
   var middle = rect.y + rect.height / 2;
   var best = "", bestDistance = Infinity;
   labels.forEach(function (label) {
      var place = dialogRect(label, dialog);
      var text = cleanLabel(label.text);
      if (place === null || place.width === 0 || text === "")
         return;
      var beside = place.y <= middle && middle <= place.y + place.height && place.x + place.width <= rect.x + LABEL_OVERLAP;
      var gapAbove = rect.y - (place.y + place.height);
      var above = gapAbove >= -LABEL_OVERLAP && gapAbove <= LABEL_ABOVE && place.x < rect.x + rect.width && rect.x < place.x + place.width;
      // Any label beside the control is nearer than every label above it.
      var distance = beside ? rect.x - (place.x + place.width) : above ? LABEL_ABOVE * 10 + gapAbove : Infinity;
      if (distance < bestDistance) {
         bestDistance = distance;
         best = text;
      }
   });
   return best;
}

// The controls of a dialog as { name, kind, label, control }, found through the properties the script
// assigned and its child controls, in that order. The legacy engine cannot list children, so there a
// control only a local variable holds is not found. A labelled control takes the label placed beside
// or above it, else the label met just before it.
function dialogControls(dialog) {
   var found = [], seen = [], labels = [], lastLabel = "";
   function visit(node, path, depth) {
      if (node === null || typeof node !== "object" || depth > CONTROL_SEARCH_DEPTH || seen.indexOf(node) >= 0)
         return;
      seen.push(node);
      if (isInstanceOf(node, "Label")) {
         labels.push(node);
         lastLabel = cleanLabel(node.text);
         return;
      }
      var kind = node === dialog ? null : controlKind(node);
      if (kind !== null) {
         found.push({ name: path, kind: kind, label: kind.labelled ? lastLabel : kind.label(node), control: node });
         // A NumericControl's label, edit box and slider are its own parts.
         if (kind.kind === "numeric")
            return;
      }
      if (!(node instanceof Control))
         return;
      // Only properties the script assigned: V8 installs most native ones as read only own
      // properties, the legacy engine keeps them on the prototype.
      Object.keys(node).forEach(function (key) {
         var descriptor = Object.getOwnPropertyDescriptor(node, key);
         if (descriptor && descriptor.writable && descriptor.value instanceof Control && CONTROL_LINKS.indexOf(key) < 0)
            visit(descriptor.value, path ? path + "." + key : key, depth + 1);
      });
      var children = node.children || [];
      for (var i = 0; i < children.length; ++i)
         visit(children[i], path + "[" + i + "]", depth + 1);
   }
   visit(dialog, "", 0);
   found.forEach(function (entry) {
      var placed = entry.kind.labelled ? placedLabel(entry.control, labels, dialog) : "";
      if (placed !== "")
         entry.label = placed;
   });
   return found;
}

function describeControl(entry) {
   var described = { name: entry.name, kind: entry.kind.kind, label: entry.label };
   var tip = typeof entry.control.toolTip === "string" ? cleanLabel(entry.control.toolTip).replace(/\s+/g, " ") : "";
   if (tip !== "" && tip !== entry.label)
      described.tip = tip.length > TOOLTIP_LENGTH ? tip.slice(0, TOOLTIP_LENGTH) + "..." : tip;
   try {
      var details = entry.kind.describe(entry.control);
      Object.keys(details).forEach(function (key) { described[key] = details[key]; });
   } catch (error) {
      described.unreadable = String(error.message || error);
   }
   return described;
}

function setControl(entry, value) {
   if (entry.kind.kind === "canvas")
      throw new Error("Control '" + entry.name + "' is a drawing area that needs the mouse, which a headless run cannot use");
   if (!entry.kind.set)
      throw new Error("Control '" + entry.name + "' is a " + entry.kind.kind + ", which takes no value");
   entry.kind.set(entry.control, value, entry.label || entry.name);
}

// The entries a key names: by name, or else by label, case insensitive.
function matchControls(entries, key) {
   var byName = entries.filter(function (entry) { return entry.name === key; });
   if (byName.length)
      return byName;
   var wanted = cleanLabel(key).toLowerCase();
   return entries.filter(function (entry) { return entry.label !== "" && entry.label.toLowerCase() === wanted; });
}

function clickButton(entry) {
   var button = entry.control;
   if (typeof button.onClick === "function") button.onClick.call(button, false);
   else if (typeof button.onPress === "function") button.onPress.call(button);
}
