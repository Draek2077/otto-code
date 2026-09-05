import ts from "typescript";
import { posix } from "node:path";
import { MOUNT_CONTRACTS, SKILL_OWNERS } from "./merge-integration-contracts.mjs";

export class AnalysisError extends Error {}

// Same ordered naming rules as rebrand-upstream.pl; never mutate input files.
export function normalizeBrand(value) {
  for (const [from, to] of [
    ["sh.paseo.debug", "ai.ottocode.debug"],
    ["sh.paseo.desktop", "ai.ottocode.desktop"],
    ["sh.paseo", "ai.ottocode"],
    ["@getpaseo", "@otto-code"],
    ["getpaseo/paseo", "Draek2077/otto-code"],
    ["getpaseo", "Draek2077"],
    ["paseo.sh", "otto-code.me"],
    ["PASEO_", "OTTO_"],
    ["Paseo", "Otto"],
    ["paseo", "otto"],
  ])
    value = value.split(from).join(to);
  return value.replace(/\b6767\b/g, "6868").replace(/\r\n/g, "\n");
}

export const isSource = (file) => /\.(?:[cm]?[jt]sx?)$/.test(file) && !/\.d\.[cm]?ts$/.test(file);
export const isTest = (file) =>
  file.startsWith("test-documents/") ||
  /\.(?:test|spec)\.[a-z]+$/.test(file) ||
  /\/(?:fixtures|__fixtures__|__tests__|e2e)\//.test(file);
const suffixes = [
  "",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  "/index.ts",
  "/index.tsx",
  "/index.js",
];

export function resolveModule(specifier, from, files) {
  let base;
  if (specifier.startsWith("@/")) base = "packages/app/src/" + specifier.slice(2);
  else if (specifier.startsWith(".")) base = posix.join(posix.dirname(from), specifier);
  else return null;
  base = normalizeBrand(base);
  const stems = base.endsWith(".js") ? [base.slice(0, -3), base] : [base];
  const generic = stems
    .flatMap((stem) => suffixes.map((suffix) => stem + suffix))
    .find((path) => files.has(path));
  const platform = ["web", "native", "electron", "shared"]
    .flatMap((kind) =>
      stems.flatMap((stem) =>
        [".ts", ".tsx"].flatMap((ext) => [stem + "." + kind + ext, stem + "/index." + kind + ext]),
      ),
    )
    .filter((path) => files.has(path));
  if (generic && platform.length)
    throw new AnalysisError(
      `Ambiguous generic/platform resolution: ${from} -> ${specifier}: ${[generic, ...platform].join(", ")}`,
    );
  if (generic) return generic;
  if (platform.length === 1) return platform[0];
  if (platform.length > 1)
    throw new AnalysisError(
      `Ambiguous platform resolution: ${from} -> ${specifier}: ${platform.join(", ")}`,
    );
  throw new AnalysisError(`Unresolved import: ${from} -> ${specifier}`);
}

function unwrap(node) {
  while (
    node &&
    (ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isSatisfiesExpression(node) ||
      ts.isNonNullExpression(node))
  )
    node = node.expression;
  return node;
}

function callable(node) {
  node = unwrap(node);
  if (
    node &&
    (ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node) ||
      ts.isMethodDeclaration(node))
  )
    return node;
  // Only these reviewed component wrappers are interpreted, never arbitrary HOCs.
  if (
    node &&
    ts.isCallExpression(node) &&
    /^(?:React\.)?(?:memo|forwardRef)$/.test(node.expression.getText())
  )
    return callable(node.arguments[0]);
  return null;
}

function children(node, predicate, into = []) {
  if (predicate(node)) into.push(node);
  ts.forEachChild(node, (child) => {
    children(child, predicate, into);
  });
  return into;
}

// Find executable statements/calls without entering uncalled nested functions.
function executableNodes(body, predicate) {
  const found = [];
  function visit(node) {
    if (node !== body && ts.isFunctionLike(node)) return;
    if (ts.isBlock(node)) {
      for (const statement of node.statements) {
        visit(statement);
        if (ts.isReturnStatement(statement) || ts.isThrowStatement(statement)) break;
      }
      return;
    }
    if (ts.isIfStatement(node)) {
      const test = node.expression.kind;
      if (test !== ts.SyntaxKind.FalseKeyword) visit(node.thenStatement);
      if (node.elseStatement && test !== ts.SyntaxKind.TrueKeyword) visit(node.elseStatement);
      return;
    }
    if (predicate(node)) found.push(node);
    ts.forEachChild(node, visit);
  }
  visit(body);
  return found;
}

function collectImports(statement, imports) {
  if (
    !ts.isImportDeclaration(statement) ||
    !statement.importClause ||
    statement.importClause.isTypeOnly
  )
    return;
  const clause = statement.importClause;
  const spec = statement.moduleSpecifier.text;
  if (clause.name) imports.set(clause.name.text, { name: "default", spec });
  if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings))
    imports.set(clause.namedBindings.name.text, { name: "*", spec });
  if (clause.namedBindings && ts.isNamedImports(clause.namedBindings))
    for (const item of clause.namedBindings.elements) {
      if (!item.isTypeOnly)
        imports.set(item.name.text, { name: item.propertyName?.text ?? item.name.text, spec });
    }
}

function defaultExport(module) {
  for (const statement of module.ast.statements) {
    if (
      ts.isFunctionDeclaration(statement) &&
      statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)
    )
      return { file: module.file, name: statement.name?.text ?? "default" };
    if (ts.isExportAssignment(statement) && ts.isIdentifier(statement.expression))
      return { file: module.file, name: statement.expression.text };
  }
  return null;
}

function importBoundary(module, imported, ref, targetFile) {
  const normalizedSpec = normalizeBrand(imported.spec);
  const likelyPath = normalizedSpec.startsWith("@/")
    ? "packages/app/src/" + normalizedSpec.slice(2)
    : posix.join(posix.dirname(module.file), normalizedSpec);
  const sameModule = suffixes.some((suffix) => likelyPath + suffix === targetFile);
  const reviewedBarrel = ref.barrels?.some((barrel) =>
    suffixes.some((suffix) => likelyPath + suffix === barrel),
  );
  const relevant =
    [ref.name, "*", "default"].includes(imported.name) || sameModule || reviewedBarrel;
  return { sameModule, reviewedBarrel, relevant };
}

function parameterBindingNames(parameter) {
  if (ts.isIdentifier(parameter.name)) return [parameter.name.text];
  if (ts.isObjectBindingPattern(parameter.name) || ts.isArrayBindingPattern(parameter.name))
    return parameter.name.elements.filter(ts.isBindingElement).map((item) => item.name.getText());
  return [];
}

function literalValue(node) {
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isStringLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  return undefined;
}

function skipsRightOperand(node) {
  const literal = literalValue(unwrap(node.left));
  if (literal === undefined) return false;
  if (node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) return !literal;
  if (node.operatorToken.kind === ts.SyntaxKind.BarBarToken) return Boolean(literal);
  return literal !== null;
}

function combinedStatus(results) {
  if (results.some((item) => item.status === "error")) return "error";
  if (results.some((item) => item.status === "violation")) return "violation";
  return "pass";
}

export class SourceAnalysis {
  constructor(reader) {
    this.reader = reader;
    this.cache = new Map();
  }

  module(file) {
    file = this.reader.mapPath?.(file) ?? file;
    if (!this.reader.files.has(file)) return null;
    if (this.cache.has(file)) return this.cache.get(file);
    const text = normalizeBrand(this.reader.read(file));
    const ast = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      /\.[jt]sx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    if (ast.parseDiagnostics.length) {
      const diagnostic = ast.parseDiagnostics[0];
      throw new AnalysisError(
        `${file}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`,
      );
    }
    const declarations = new Map();
    const imports = new Map();
    for (const statement of ast.statements) {
      if (ts.isFunctionDeclaration(statement) && statement.name)
        declarations.set(statement.name.text, statement);
      if (ts.isVariableStatement(statement))
        for (const item of statement.declarationList.declarations) {
          if (ts.isIdentifier(item.name)) declarations.set(item.name.text, item.initializer);
        }
      collectImports(statement, imports);
    }
    const result = { ast, file, declarations, imports };
    this.cache.set(file, result);
    return result;
  }

  declaration(ref) {
    const module = this.module(ref.file);
    const fn = module && callable(module.declarations.get(ref.name));
    return fn ? { module, fn } : null;
  }

  exported(file, name, seen = new Set()) {
    const key = file + ":" + name;
    if (seen.has(key)) throw new AnalysisError(`Cyclic re-export: ${key}`);
    seen.add(key);
    const module = this.module(file);
    if (!module) throw new AnalysisError(`Missing imported module: ${file}`);
    if (module.declarations.has(name)) return { file: module.file, name };
    const defaultIdentity = name === "default" && defaultExport(module);
    if (defaultIdentity) return defaultIdentity;
    for (const statement of module.ast.statements) {
      if (!ts.isExportDeclaration(statement) || statement.isTypeOnly) continue;
      if (!statement.exportClause || !ts.isNamedExports(statement.exportClause)) continue;
      const exported = statement.exportClause.elements.find(
        (item) => !item.isTypeOnly && item.name.text === name,
      );
      if (!exported) continue;
      const localName = exported.propertyName?.text ?? exported.name.text;
      if (!statement.moduleSpecifier) {
        const imported = module.imports.get(localName);
        if (!imported) return { file: module.file, name: localName };
        return this.exported(
          resolveModule(imported.spec, module.file, this.reader.files),
          imported.name,
          seen,
        );
      }
      return this.exported(
        resolveModule(statement.moduleSpecifier.text, module.file, this.reader.files),
        localName,
        seen,
      );
    }
    throw new AnalysisError(
      `Unresolved export ${name} in ${file}; star/dynamic re-exports need an explicit reviewed contract`,
    );
  }

  bindings(module, ref) {
    const names = new Set();
    const targetFile = this.reader.mapPath?.(ref.file) ?? ref.file;
    if (module.file === targetFile && module.declarations.has(ref.name)) names.add(ref.name);
    for (const [local, imported] of module.imports) {
      // Restrict parsing to the named boundary. Unrelated app imports are not a
      // request to infer the whole application's dependency graph.
      const { sameModule, reviewedBarrel, relevant } = importBoundary(
        module,
        imported,
        ref,
        targetFile,
      );
      if (!relevant) continue;
      // A reviewed barrel can export many unrelated names. Only resolve an
      // alias if its explicit re-export can lead to this contract's symbol.
      if (reviewedBarrel && imported.name !== ref.name) {
        const barrelPath = resolveModule(imported.spec, module.file, this.reader.files);
        const barrelModule = this.module(barrelPath);
        const relevantExport = barrelModule.ast.statements.some(
          (statement) =>
            ts.isExportDeclaration(statement) &&
            statement.exportClause &&
            ts.isNamedExports(statement.exportClause) &&
            statement.exportClause.elements.some(
              (item) =>
                item.name.text === imported.name &&
                (item.propertyName?.text ?? item.name.text) === ref.name,
            ),
        );
        if (!relevantExport) continue;
      }
      if ((imported.name === "*" || imported.name === "default") && !sameModule) continue;
      const resolved = resolveModule(imported.spec, module.file, this.reader.files);
      if (!resolved) continue;
      const identity = this.exported(resolved, imported.name === "*" ? ref.name : imported.name);
      if (identity.file === targetFile && identity.name === ref.name)
        names.add(imported.name === "*" ? local + "." + ref.name : local);
    }
    return names;
  }

  mounts(owner, target, provider, propBindings) {
    const declaration = this.declaration(owner);
    if (!declaration) return { missing: `Missing owner ${owner.file}#${owner.name}`, evidence: [] };
    const { module, fn } = declaration;
    const targetNames = this.bindings(module, target);
    const providerNames = provider ? this.bindings(module, provider) : new Set();
    const evidence = [];
    const active = new Set();
    const mentionsTarget = (node) =>
      children(
        node,
        (item) =>
          ts.isIdentifier(item) &&
          [...targetNames].some((name) => name.split(".")[0] === item.text),
      ).length > 0;
    const localFunctions = new Map(module.declarations);

    const walkFunction = (current, ancestors, conditional, outerBindings = new Map()) => {
      if (active.has(current))
        throw new AnalysisError(`Cyclic render composition in ${module.file}#${owner.name}`);
      active.add(current);
      const locals = new Map(outerBindings);
      for (const parameter of current.parameters) {
        const names = parameterBindingNames(parameter);
        for (const name of names)
          if (targetNames.has(name) || providerNames.has(name)) locals.set(name, null);
      }
      if (ts.isBlock(current.body))
        for (const node of executableNodes(current.body, ts.isVariableDeclaration)) {
          if (ts.isIdentifier(node.name) && node.initializer) {
            if (node.parent.flags & ts.NodeFlags.Const)
              locals.set(node.name.text, node.initializer);
            else locals.set(node.name.text, null);
          }
        }
      const returns = ts.isBlock(current.body)
        ? executableNodes(current.body, ts.isReturnStatement)
            .map((node) => node.expression)
            .filter(Boolean)
        : [current.body];
      for (const expression of returns) walk(expression, ancestors, conditional, locals);
      active.delete(current);
    };

    const walk = (expression, ancestors, conditional, locals) => {
      const node = unwrap(expression);
      if (!node) return;
      if (ts.isIdentifier(node)) {
        if (locals.has(node.text)) {
          if (!locals.get(node.text))
            throw new AnalysisError(
              `Mutable render alias ${node.text} in ${module.file}; use an immutable reviewed render expression`,
            );
          if (active.has(node.text))
            throw new AnalysisError(`Cyclic render variable ${node.text} in ${module.file}`);
          active.add(node.text);
          walk(locals.get(node.text), ancestors, conditional, locals);
          active.delete(node.text);
        }
        return;
      }
      if (ts.isJsxExpression(node)) {
        walk(node.expression, ancestors, conditional, locals);
        return;
      }
      if (ts.isJsxFragment(node)) {
        node.children.forEach((child) => walk(child, ancestors, conditional, locals));
        return;
      }
      if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
        const opening = ts.isJsxElement(node) ? node.openingElement : node;
        const tag = opening.tagName.getText(module.ast);
        const props = opening.attributes.properties.filter(ts.isJsxAttribute).map((prop) => ({
          name: prop.name.text,
          value:
            prop.initializer && ts.isJsxExpression(prop.initializer)
              ? prop.initializer.expression
              : prop.initializer,
        }));
        element(tag, props, opening, ancestors, conditional, locals);
        if (ts.isJsxElement(node))
          node.children.forEach((child) => walk(child, [...ancestors, tag], conditional, locals));
        return;
      }
      if (ts.isConditionalExpression(node)) {
        if (node.condition.kind !== ts.SyntaxKind.FalseKeyword)
          walk(node.whenTrue, ancestors, true, locals);
        if (node.condition.kind !== ts.SyntaxKind.TrueKeyword)
          walk(node.whenFalse, ancestors, true, locals);
        return;
      }
      if (
        ts.isBinaryExpression(node) &&
        [
          ts.SyntaxKind.AmpersandAmpersandToken,
          ts.SyntaxKind.BarBarToken,
          ts.SyntaxKind.QuestionQuestionToken,
        ].includes(node.operatorToken.kind)
      ) {
        if (!skipsRightOperand(node)) walk(node.right, ancestors, true, locals);
        walk(node.left, ancestors, true, locals);
        return;
      }
      if (ts.isArrayLiteralExpression(node)) {
        node.elements.forEach((item) => walk(item, ancestors, conditional, locals));
        return;
      }
      if (ts.isCallExpression(node)) walkCall(node, ancestors, conditional, locals);
    };

    const walkCall = (node, ancestors, conditional, locals) => {
      const callee = node.expression.getText(module.ast);
      const reactImport = module.imports.get(callee);
      if (
        callee === "React.createElement" ||
        (reactImport?.spec === "react" && reactImport.name === "createElement")
      ) {
        const tag = node.arguments[0]?.getText(module.ast);
        const props =
          node.arguments[1] && ts.isObjectLiteralExpression(node.arguments[1])
            ? node.arguments[1].properties.map((prop) => ({
                name: prop.name?.getText(module.ast),
                value: ts.isPropertyAssignment(prop) ? prop.initializer : prop.name,
              }))
            : [];
        element(tag, props, node, ancestors, conditional, locals);
        node.arguments
          .slice(2)
          .forEach((child) => walk(child, [...ancestors, tag], conditional, locals));
        return;
      }
      const callback = callable(node.arguments[0]);
      if (
        callback &&
        ((ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "map") ||
          (reactImport?.spec === "react" && reactImport.name === "useMemo"))
      ) {
        walkFunction(callback, ancestors, true, locals);
        return;
      }
      const local = callable(locals.get(callee) ?? localFunctions.get(callee));
      if (local) {
        walkFunction(local, ancestors, conditional, locals);
        return;
      }
      if (mentionsTarget(node))
        throw new AnalysisError(
          `Unsupported render call ${callee} in ${module.file}#${owner.name}`,
        );
    };

    const element = (tag, props, node, ancestors, conditional, locals) => {
      if ((targetNames.has(tag) || providerNames.has(tag)) && locals.has(tag))
        throw new AnalysisError(
          `Shadowed integration binding ${tag} in ${module.file}#${owner.name}`,
        );
      if (targetNames.has(tag)) {
        const underProvider = !provider || ancestors.some((parent) => providerNames.has(parent));
        const hasProp =
          !propBindings ||
          Object.entries(propBindings).every(([name, expected]) =>
            matchesOwnerBinding(
              props.find((item) => item.name === name)?.value,
              expected,
              fn,
              locals,
            ),
          );
        if (underProvider && hasProp)
          evidence.push({
            file: module.file,
            line: module.ast.getLineAndCharacterOfPosition(node.getStart()).line + 1,
            owner: owner.name,
            target: target.name,
            conditional,
          });
      } else {
        const local = callable(locals.get(tag) ?? localFunctions.get(tag));
        if (local && mentionsTarget(local)) walkFunction(local, ancestors, conditional, locals);
      }
    };
    walkFunction(fn, [], false);
    return {
      missing: evidence.length
        ? null
        : `${owner.name} -> ${target.name}${provider ? " below " + provider.name : ""}${propBindings ? " with owner bindings " + Object.keys(propBindings).join(", ") : ""}`,
      evidence,
    };
  }
}

function expectedBindingName(expected, fn) {
  let expectedName = expected.local;
  if (expected.parameter) {
    for (const parameter of fn.parameters) {
      if (ts.isIdentifier(parameter.name) && parameter.name.text === expected.parameter)
        expectedName = parameter.name.text;
      if (ts.isObjectBindingPattern(parameter.name)) {
        const binding = parameter.name.elements.find(
          (item) => (item.propertyName?.getText() ?? item.name.getText()) === expected.parameter,
        );
        if (binding && ts.isIdentifier(binding.name)) expectedName = binding.name.text;
      }
    }
  }
  return expectedName;
}

function matchesOwnerBinding(expression, expected, fn, locals, seen = new Set()) {
  const node = unwrap(expression);
  if (!node) return false;
  const expectedName = expectedBindingName(expected, fn);
  if (!expectedName || (expected.local && !locals.get(expectedName))) return false;
  if (expected.member && ts.isPropertyAccessExpression(node) && node.name.text === expected.member)
    return matchesOwnerBinding(
      node.expression,
      { ...expected, member: undefined },
      fn,
      locals,
      seen,
    );
  if (expected.member) return false;
  if (ts.isIdentifier(node) && node.text === expectedName) return true;
  if (ts.isIdentifier(node) && locals.get(node.text)) {
    if (seen.has(node.text)) throw new AnalysisError(`Cyclic prop binding ${node.text}`);
    seen.add(node.text);
    return matchesOwnerBinding(locals.get(node.text), expected, fn, locals, seen);
  }
  return false;
}

function migrationPortsMatch(object, ports) {
  if (!object || !ts.isObjectLiteralExpression(object)) return false;
  if (
    !object.properties.some(
      (prop) => ts.isMethodDeclaration(prop) && prop.name.getText() === "getConnectedClient",
    )
  )
    return false;
  for (const [name, names] of ports) {
    const property = object.properties.find((prop) => prop.name?.getText() === name);
    let value;
    if (property && ts.isPropertyAssignment(property)) value = property.initializer;
    if (property && ts.isShorthandPropertyAssignment(property)) value = property.name;
    if (!value || !names.has(value.getText())) return false;
  }
  return true;
}

function skillEdges(analysis, owners) {
  const results = [];
  const check = (id, owner, verify) => {
    try {
      const declaration = analysis.declaration(owner);
      const missing = !declaration || !verify(declaration);
      results.push({
        id,
        status: missing ? "violation" : "pass",
        owner,
        detail: missing
          ? "Missing required executable skill handoff"
          : "Required structural handoff retained",
      });
    } catch (error) {
      results.push({ id, status: "error", owner, detail: error.message });
    }
  };
  const calls = (node) => executableNodes(node, ts.isCallExpression);
  const callName = (call) => call.expression.getText();
  const methodCall = (body, receiver, method) =>
    calls(body).some(
      (call) =>
        ts.isPropertyAccessExpression(call.expression) &&
        call.expression.expression.getText() === receiver &&
        call.expression.name.text === method,
    );
  const variables = (body) => executableNodes(body, ts.isVariableDeclaration);

  check("skills-migration-controller", owners.migration, ({ module, fn }) => {
    const bindings = analysis.bindings(module, owners.controller);
    const ports = Object.entries(owners.ports).map(([name, ref]) => [
      name,
      analysis.bindings(module, ref),
    ]);
    const effects = calls(fn.body).filter(
      (call) =>
        module.imports.get(callName(call))?.spec === "react" &&
        module.imports.get(callName(call))?.name === "useEffect",
    );
    for (const effect of effects) {
      const callback = callable(effect.arguments[0]);
      if (!callback) continue;
      for (const call of calls(callback.body)) {
        if (bindings.has(callName(call)) && migrationPortsMatch(call.arguments[0], ports))
          return true;
      }
    }
    return false;
  });
  check("skills-daemon-startup", owners.bootstrap, ({ module, fn }) => {
    const bindings = analysis.bindings(module, owners.startup);
    const service = variables(fn.body).find(
      (item) =>
        ts.isIdentifier(item.name) &&
        item.initializer &&
        ts.isCallExpression(item.initializer) &&
        bindings.has(callName(item.initializer)),
    );
    if (!service || !methodCall(fn.body, service.name.text, "autoUpdate")) return false;
    const stop = variables(fn.body).find((item) => item.name.getText() === "stop");
    const stopFn = stop && callable(stop.initializer);
    const exposesStop = executableNodes(fn.body, ts.isReturnStatement).some(
      (item) =>
        item.expression &&
        ts.isObjectLiteralExpression(item.expression) &&
        item.expression.properties.some(
          (prop) =>
            prop.name?.getText() === "stop" &&
            (ts.isShorthandPropertyAssignment(prop) ||
              (ts.isPropertyAssignment(prop) && prop.initializer.getText() === "stop")),
        ),
    );
    return exposesStop && stopFn && methodCall(stopFn.body, service.name.text, "dispose");
  });
  check("skills-maintenance-release", owners.startup, ({ fn }) => {
    const bodyCalls = calls(fn.body);
    const listener = bodyCalls.find(
      (call) =>
        ts.isPropertyAccessExpression(call.expression) &&
        call.expression.name.text === "onChange" &&
        call.expression.expression.getText() === fn.parameters[0].name.getText(),
    );
    const callback = listener && callable(listener.arguments[0]);
    if (!callback) return false;
    const returned = executableNodes(fn.body, ts.isReturnStatement).find(
      (item) => item.expression && ts.isObjectLiteralExpression(item.expression),
    );
    const update = returned?.expression.properties.find(
      (item) => item.name?.getText() === "autoUpdate",
    );
    if (!update || !ts.isMethodDeclaration(update)) return false;
    const pending = calls(update.body).find(
      (call) =>
        ts.isPropertyAccessExpression(call.expression) && call.expression.name.text === "then",
    );
    const continuation = pending && callable(pending.arguments[0]);
    if (!continuation) return false;
    const readyName = pending.expression.expression.getText();
    const ready = variables(fn.body).find((item) => item.name.getText() === readyName);
    const promise =
      ready &&
      children(ready, ts.isNewExpression).find((node) => node.expression.getText() === "Promise");
    const executor = promise && callable(promise.arguments?.[0]);
    if (!executor) return false;
    const release = executableNodes(executor.body, ts.isBinaryExpression).find(
      (node) =>
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        node.right.getText() === executor.parameters[0]?.name.getText(),
    );
    if (!release || !calls(callback.body).some((call) => callName(call) === release.left.getText()))
      return false;
    const skills = variables(fn.body).find(
      (item) =>
        item.initializer &&
        ts.isCallExpression(item.initializer) &&
        callName(item.initializer) === "createOrchestrationSkills",
    );
    return skills && methodCall(continuation.body, skills.name.getText(), "autoUpdate");
  });
  return results;
}

export function analyzeIntegrations(
  reader,
  { mounts = MOUNT_CONTRACTS, skills = SKILL_OWNERS } = {},
) {
  const analysis = new SourceAnalysis(reader);
  const results = mounts.map((contract) => {
    const edges = contract.edges.map(([owner, target, provider, prop]) => {
      try {
        const result = analysis.mounts(owner, target, provider, prop);
        return {
          owner,
          target,
          status: result.missing ? "violation" : "pass",
          detail: result.missing ?? "Returned mount retained",
          evidence: result.evidence,
        };
      } catch (error) {
        return { owner, target, status: "error", detail: error.message, evidence: [] };
      }
    });
    return {
      id: contract.id,
      status: combinedStatus(edges),
      edges,
    };
  });
  if (skills) results.push(...skillEdges(analysis, skills));
  return {
    results,
    parsedModules: [...analysis.cache.keys()].sort(),
    limitations: [
      "Named structural owner chains only; runtime conditions are not evaluated.",
      "No proof of persistence timing, host identity, effect cleanup or supported-platform behavior; retain behavioral smoke tests.",
      "Unrelated dependencies, dynamic composition and arbitrary call graphs are not analyzed.",
    ],
  };
}
