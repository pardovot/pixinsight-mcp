// The generic process runner: any PixInsight process by class name, with no per process wrappers.

// A JavaScript identifier, the shape of every process class name.
var PROCESS_ID_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

function instantiateProcess(processId) {
   if (!PROCESS_ID_PATTERN.test(processId || ""))
      throw new Error("Invalid process id: " + processId);
   var ProcessClass = GLOBAL_SCOPE[processId];
   if (typeof ProcessClass !== "function")
      throw new Error("Unknown process: " + processId);
   var instance = new ProcessClass();
   if (!(instance instanceof ProcessInstance))
      throw new Error("Not a process: " + processId);
   return instance;
}

// Settable parameters are the instance's non function properties, so methods such as executeOn
// can be neither listed nor set.
function processParameterNames(instance) {
   var names = [];
   for (var name in instance)
      if (typeof instance[name] !== "function")
         names.push(name);
   return names;
}

// executeOn and executeGlobal return false when a process refuses to run, an unlicensed tool
// being the common case. Reporting success would hide a step that did nothing.
function executeProcess(instance, processId, view) {
   var executed = view ? instance.executeOn(view) : instance.executeGlobal();
   if (!executed)
      throw new Error(processId + " failed" + (view ? " on " + view.id : "") +
                      ". Its reason is in the Process Console, a missing license reports only there.");
}

function handleRunProcess(command) {
   var processId = command.parameters.processId;
   var instance = instantiateProcess(processId);
   var known = processParameterNames(instance);
   var settings = command.parameters.settings || {};
   var applied = [];
   for (var name in settings) {
      if (!Object.prototype.hasOwnProperty.call(settings, name))
         continue;
      // An unknown name would become a plain property, and the process would run with its
      // defaults while the setting is reported as applied.
      if (known.indexOf(name) < 0)
         throw new Error("Unknown parameter '" + name + "' for " + processId +
                         ", check get_process_parameters(\"" + processId + "\")");
      instance[name] = settings[name];
      applied.push(name);
   }

   var view = command.targetView ? requireView(command.targetView) : null;
   executeProcess(instance, processId, view);
   return success({ processId: processId, applied: applied },
                  processId + (view ? " executed on " + view.id : " executed globally") +
                  (applied.length ? " [" + applied.join(", ") + "]" : " (defaults)"));
}

function handleGetProcessParameters(command) {
   var processId = command.parameters.processId;
   var instance = instantiateProcess(processId);
   var parameters = {};
   processParameterNames(instance).forEach(function (name) {
      parameters[name] = instance[name];
   });
   return success({ processId: processId, parameters: parameters },
                  processId + ": " + Object.keys(parameters).length + " parameter(s)");
}
