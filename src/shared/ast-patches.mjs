import { parse } from './acorn.mjs';

export const AST_PATCH_IDS = [
  'user-type-ant', 'bun-standalone-executable', 'growthbook-env-overrides-graph', 'growthbook-config-overrides-graph',
  'computer-use-default', 'ultraplan', 'voice-mode',
  'geo-stego-date', 'remote-settings-off', 'wiggly-dove',
  'agent-teams-graph',
  'computer-use-gate-semantic', 'ultrareview-command',
  'tool-result-pairing-recovery',
];

const anchors = ['external', 'isStandaloneExecutable', 'environmentOverridesParsed',
  'pixelValidation', 'ultraplan', 'tengu_amber_quartz_disabled', 's date is ', 'getEnvironmentOverrides',
  'Remote settings:', 'remote-settings.json', 'tengu_wiggly_dove', 'tengu_amber_flint',
  'isEnabled', 'enabled', 'ultrareview', 'amber_flint', 'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS',
  '[Tool result missing due to internal error]'];
const gate = id => `globalThis.__clawgodPatches?.[${JSON.stringify(id)}]!==!1`;
const literal = (node, value) => node?.type === 'Literal' && node.value === value;
const propertyName = node => node.computed
  ? (node.key?.type === 'Literal' ? node.key.value : undefined)
  : (node.key?.name ?? node.key?.value);
const member = (node, name) => node?.type === 'MemberExpression' &&
  (node.computed ? literal(node.property, name) : node.property.name === name);
const thisMember = (node, name) => member(node, name) && node.object.type === 'ThisExpression';
const boolean = (node, value) => literal(node, value) ||
  (node?.type === 'UnaryExpression' && node.operator === '!' && literal(node.argument, value ? 0 : 1));
const staticText = node => node?.type === 'Literal' && typeof node.value === 'string' ? node.value
  : node?.type === 'TemplateLiteral' && node.expressions.length === 0 ? node.quasis[0].value.cooked : undefined;
const firstPromptText = node => node?.type === 'BinaryExpression' && node.operator === '+'
  ? firstPromptText(node.left) || firstPromptText(node.right)
  : staticText(node) ?? (node?.type === 'TemplateLiteral' ? node.quasis[0].value.cooked : undefined);

const isUndefined = node => node?.type === 'UnaryExpression' && node.operator === 'void' &&
  literal(node.argument, 0);

export const AST_HELPERS = { literal, propertyName, member, boolean, staticText, firstPromptText };

export const parsePatchSource = code => parse(code, {
  ecmaVersion: 'latest', sourceType: 'script', allowHashBang: true,
  allowReturnOutsideFunction: true, allowImportExportEverywhere: true,
});

export function walk(root, visit) {
  const pending = [[root, null]];
  while (pending.length) {
    const [node, parent] = pending.pop();
    if (visit(node, parent) === false) continue;
    for (const value of Object.values(node)) {
      if (value?.type) pending.push([value, node]);
      else if (Array.isArray(value)) {
        for (const child of value) if (child?.type) pending.push([child, node]);
      }
    }
  }
}

function walkScope(root, visit) {
  walk(root, node => {
    visit(node);
    if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node.type)) return false;
  });
}

function pairingScopeResolver(tree, sentinel) {
  const scopes = new WeakMap(), writes = [];
  const names = pattern => {
    const pending = [pattern], result = [];
    while (pending.length) {
      const node = pending.pop();
      if (!node) continue;
      if (node.type === 'Identifier') result.push(node.name);
      if (node.type === 'RestElement') pending.push(node.argument);
      if (node.type === 'AssignmentPattern') pending.push(node.left);
      if (node.type === 'ArrayPattern') pending.push(...node.elements);
      if (node.type === 'ObjectPattern') pending.push(...node.properties.map(p => p.type === 'RestElement' ? p.argument : p.value));
    }
    return result;
  };
  const declare = (scope, pattern, value) => {
    for (const name of names(pattern)) {
      if (!scope.bindings.has(name)) scope.bindings.set(name, []);
      if (value !== null) scope.bindings.get(name).push(value);
    }
  };
  const resolve = (scope, name) => {
    for (; scope; scope = scope.parent) {
      if (scope.bindings.has(name)) return scope.bindings.get(name);
    }
  };
  const pending = [{ node: tree, scope: null }];
  while (pending.length) {
    let { node, scope } = pending.pop();
    const fn = ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node.type);
    const cls = node.type === 'ClassDeclaration' || node.type === 'ClassExpression';
    if (node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') declare(scope, node.id);
    if (fn || cls || ['Program', 'BlockStatement', 'StaticBlock', 'CatchClause', 'ForStatement', 'ForInStatement', 'ForOfStatement', 'SwitchStatement'].includes(node.type)) {
      scope = { parent: scope, bindings: new Map(), vars: scope?.vars };
      if (fn || node.type === 'Program' || node.type === 'StaticBlock') scope.vars = scope;
      scopes.set(node, scope);
    }
    if (fn) {
      if (node.id) declare(scope, node.id);
      for (const param of node.params) declare(scope, param);
    }
    if (cls && node.id) declare(scope, node.id);
    if (node.type === 'CatchClause') declare(scope, node.param);
    if (node.type === 'ImportDeclaration') for (const specifier of node.specifiers) declare(scope, specifier.local);
    if (node.type === 'VariableDeclaration') {
      for (const declaration of node.declarations) {
        const value = declaration.id.type === 'Identifier' ? declaration.init : undefined;
        declare(node.kind === 'var' ? scope.vars : scope, declaration.id, value);
      }
    }
    if (node.type === 'AssignmentExpression' || node.type === 'UpdateExpression') {
      writes.push({ scope, pattern: node.left ?? node.argument,
        value: node.operator === '=' && node.left.type === 'Identifier' ? node.right : undefined });
    }
    if (node.type === 'ForInStatement' || node.type === 'ForOfStatement') {
      const patterns = node.left.type === 'VariableDeclaration' ? node.left.declarations.map(d => d.id) : [node.left];
      for (const pattern of patterns) writes.push({ scope, pattern, value: undefined });
    }
    for (const value of Object.values(node)) {
      if (value?.type) pending.push({ node: value, scope });
      else if (Array.isArray(value)) for (const child of value) if (child?.type) pending.push({ node: child, scope });
    }
  }
  for (const { scope, pattern, value } of writes) {
    for (const name of names(pattern)) resolve(scope, name)?.push(value);
  }
  return (expr, callback, owner) => {
    const history = owner.params[0].name;
    if (resolve(scopes.get(callback).parent, history) !== scopes.get(owner).bindings.get(history)) return false;
    if (literal(expr, sentinel)) return true;
    if (expr?.type !== 'Identifier') return false;
    const values = resolve(scopes.get(callback.body) ?? scopes.get(callback), expr.name);
    return !!values?.length && values.every(value => literal(value, sentinel));
  };
}


export function createPatchContext(tree, code, loadImport = () => undefined) {
  const scopes = new WeakMap(), root = { parent: null, function: true, bindings: new Map() };
  const writes = [], exports = new Map();
  let commonJS;
  const functionNode = node => ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node?.type);
  const names = node => !node ? [] : node.type === 'Identifier' ? [node.name]
    : node.type === 'RestElement' ? names(node.argument)
    : node.type === 'AssignmentPattern' ? names(node.left)
    : node.type === 'ArrayPattern' ? node.elements.flatMap(names)
    : node.type === 'ObjectPattern' ? node.properties.flatMap(property => names(property.value ?? property.argument)) : [];
  const bind = (scope, name, value) => {
    if (scope.bindings.has(name)) scope.bindings.set(name, { unknown: true });
    else scope.bindings.set(name, value);
  };
  const lookup = node => {
    for (let scope = scopes.get(node); scope; scope = scope.parent) {
      if (scope.bindings.has(node.name)) return scope.bindings.get(node.name);
    }
  };
  walk(tree, (node, parent) => {
    let scope = parent ? scopes.get(parent) : root;
    if (node.type === 'FunctionDeclaration' && node.id) bind(scope, node.id.name, { node });
    if (node.type === 'ClassDeclaration' && node.id) bind(scope, node.id.name, { unknown: true });
    if (functionNode(node)) {
      scope = { parent: scope, function: true, bindings: new Map() };
      if (node.type === 'FunctionExpression' && node.id) bind(scope, node.id.name, { node });
      for (const param of node.params) for (const name of names(param)) bind(scope, name, { unknown: true });
    } else if (['BlockStatement', 'CatchClause', 'ForStatement', 'ForInStatement', 'ForOfStatement', 'SwitchStatement', 'ClassExpression'].includes(node.type)) {
      scope = { parent: scope, bindings: new Map() };
      for (const name of names(node.param)) bind(scope, name, { unknown: true });
      if (node.type === 'ClassExpression' && node.id) bind(scope, node.id.name, { unknown: true });
    }
    scopes.set(node, scope);
    if (node.type === 'VariableDeclarator') {
      let target = scope;
      if (parent.kind === 'var') while (!target.function) target = target.parent;
      for (const name of names(node.id)) {
        const property = node.id.type === 'ObjectPattern' && node.id.properties.find(entry =>
          entry.type === 'Property' && entry.value.type === 'Identifier' && entry.value.name === name);
        const key = property && propertyName(property);
        bind(target, name, node.id.type === 'Identifier' ? { node: node.init } :
          typeof key === 'string' ? { object: node.init, key } : { unknown: true });
      }
    }
    if (node.type === 'ImportDeclaration') for (const specifier of node.specifiers) {
      bind(scope, specifier.local.name, { source: node.source.value,
        imported: specifier.type === 'ImportNamespaceSpecifier' ? '*' :
          specifier.type === 'ImportDefaultSpecifier' ? 'default' : specifier.imported.name ?? specifier.imported.value });
    }
    if (node.type === 'AssignmentExpression') {
      writes.push(node.left);
      if (member(node.left, 'exports') && node.left.object.name === 'module') commonJS = { left: node.left, right: node.right };
    }
    if (node.type === 'UpdateExpression') writes.push(node.argument);
  });
  for (const target of writes) {
    let node = target;
    while (node?.type === 'MemberExpression') node = node.object;
    if (node?.type === 'Identifier') { const binding = lookup(node); if (binding) { binding.unknown = true; binding.mutated = true; } }
    else walk(target, child => {
      if (child.type === 'Identifier') { const binding = lookup(child); if (binding) { binding.unknown = true; binding.mutated = true; } }
    });
  }
  commonJS = commonJS && !lookup(commonJS.left.object) ? commonJS.right : undefined;
  for (const statement of tree.body) {
    if (statement.type === 'ExportDefaultDeclaration') exports.set('default', { node: statement.declaration });
    if (statement.type !== 'ExportNamedDeclaration') continue;
    if (statement.declaration?.id) exports.set(statement.declaration.id.name, { node: statement.declaration.id });
    for (const declaration of statement.declaration?.declarations ?? []) {
      if (declaration.id.type === 'Identifier') exports.set(declaration.id.name, { node: declaration.id });
    }
    for (const specifier of statement.specifiers) exports.set(specifier.exported.name ?? specifier.exported.value,
      statement.source ? { source: statement.source.value, imported: specifier.local.name ?? specifier.local.value } : { node: specifier.local });
  }
  const context = {
    code,
    refers(node, name, budget = 32) {
      if (!node || budget <= 0) return false;
      if (member(node, name)) return true;
      if (node.type !== 'Identifier') return false;
      const binding = lookup(node);
      if (!binding || binding.unknown) return false;
      return binding.imported === name || binding.key === name || context.refers(binding.node, name, budget - 1);
    },
    exported(name, seen, budget) {
      if (budget <= 0) return;
      const entry = exports.get(name);
      if (entry?.source) return loadImport(entry.source)?.exported(entry.imported, seen, budget - 1);
      if (entry) return context.resolve(entry.node, seen, budget - 1);
      const value = commonJS && context.resolve(commonJS, seen, budget - 1);
      const field = value?.context?.field(value.node, name, seen, budget - 1);
      return field?.context.resolve(field.node, seen, budget - 1);
    },
    same(left, right, budget = 32) {
      if (!left || !right || budget <= 0) return false;
      if (left.type === 'Identifier' && right.type === 'Identifier') {
        const a = lookup(left), b = lookup(right);
        if (a && a === b && !a.mutated) return true;
      }
      if (left.type === 'Identifier') {
        const binding = lookup(left);
        if (binding && !binding.unknown && binding.node) return context.same(binding.node, right, budget - 1);
      }
      if (right.type === 'Identifier') {
        const binding = lookup(right);
        if (binding && !binding.unknown && binding.node) return context.same(left, binding.node, budget - 1);
      }
      if (left.type === 'MemberExpression' && right.type === 'MemberExpression') {
        const key = value => value.computed ? context.text(value.property) : value.property.name;
        return key(left) !== undefined && key(left) === key(right) && context.same(left.object, right.object, budget - 1);
      }
      return false;
    },
    field(node, name, seen = new Set(), budget = 32) {
      if (budget <= 0 || node?.type !== 'ObjectExpression' || node.properties.some(property =>
        property.type !== 'Property' || property.computed && context.text(property.key, seen, budget - 1) === undefined)) return;
      const properties = node.properties.filter(property =>
        (property.computed ? context.text(property.key, seen, budget - 1) : propertyName(property)) === name);
      if (properties.length !== 1 || properties[0].kind !== 'init') return;
      return { node: properties[0].value, context };
    },
    text(node, seen = new Set(), budget = 32) {
      if (budget <= 0) return;
      const value = context.resolve(node, seen, budget - 1);
      if (!value?.node) return;
      const direct = staticText(value.node);
      if (direct !== undefined) return direct;
      if (value.node.type === 'BinaryExpression' && value.node.operator === '+') {
        const left = value.context.text(value.node.left, new Set(seen), budget - 1);
        const right = value.context.text(value.node.right, new Set(seen), budget - 1);
        if (left !== undefined && right !== undefined) return left + right;
      }
    },
    resolve(node, seen = new Set(), budget = 32) {
      if (!node || budget <= 0) return;
      if (node.type === 'ChainExpression') return context.resolve(node.expression, seen, budget - 1);
      if (node.type === 'Identifier') {
        const binding = lookup(node);
        if (!binding || binding.unknown || seen.has(binding)) return;
        seen = new Set(seen).add(binding);
        if (binding.source) {
          const imported = loadImport(binding.source);
          return binding.imported === '*' ? imported && { namespace: imported } : imported?.exported(binding.imported, seen, budget - 1);
        }
        if (binding.object) {
          const object = context.resolve(binding.object, seen, budget - 1);
          if (object?.namespace) return object.namespace.exported(binding.key, seen, budget - 1);
          const value = object?.context?.field(object.node, binding.key, seen, budget - 1);
          return value?.context.resolve(value.node, seen, budget - 1);
        }
        return context.resolve(binding.node, seen, budget - 1);
      }
      if (node.type === 'MemberExpression') {
        const key = node.computed ? context.text(node.property, new Set(seen), budget - 1) : node.property.name;
        const object = context.resolve(node.object, seen, budget - 1);
        if (object?.namespace) return object.namespace.exported(key, seen, budget - 1);
        const value = object?.context.field(object.node, key, seen, budget - 1);
        return value ? value.context.resolve(value.node, seen, budget - 1) : { node, context };
      }
      if (node.type === 'CallExpression') {
        const requireCall = node.arguments.length === 1 &&
          (node.callee.name === 'require' && !lookup(node.callee) ||
           member(node.callee, 'require') && node.callee.object.type === 'MetaProperty');
        if (requireCall) {
          const specifier = context.text(node.arguments[0], new Set(seen), budget - 1);
          const imported = specifier !== undefined && loadImport(specifier);
          return imported ? { namespace: imported } : undefined;
        }
        const target = context.resolve(node.callee, seen, budget - 1);
        if (!target?.node || !functionNode(target.node) || target.node.async || target.node.generator ||
            target.node.params.length || node.arguments.length) return { node, context };
        const body = target.node.body;
        if (body.type !== 'BlockStatement') return target.context.resolve(body, seen, budget - 1);
        const statements = body.body.filter(statement => !statement.directive && statement.type !== 'EmptyStatement');
        if (statements.at(-1)?.type !== 'ReturnStatement' ||
            statements.slice(0, -1).some(statement => statement.type !== 'VariableDeclaration')) return { node, context };
        return target.context.resolve(statements.at(-1).argument, seen, budget - 1);
      }
      return { node, context };
    },
  };
  return context;
}

function hasGate(node, id) {
  let found = false;
  walk(node, child => {
    if (member(child, id) && member(child.object, '__clawgodPatches') &&
        child.object.object.name === 'globalThis') found = true;
    if (child.type === 'CallExpression' && member(child.callee, 'enablePredicate') &&
        member(child.callee.object, '__clawgodHelpers') &&
        child.callee.object.object.name === 'globalThis' && literal(child.arguments[1], id)) found = true;
  });
  return found;
}

function hasRemoteSettingsContext(node) {
  let found = false;
  walk(node, child => {
    const strings = child.type === 'Literal' && typeof child.value === 'string' ? [child.value]
      : child.type === 'TemplateLiteral' ? child.quasis.map(quasi => quasi.value.cooked ?? '') : [];
    if (strings.some(value => value.includes('Remote settings:') || value.includes('remote-settings.json'))) found = true;
  });
  return found;
}

export function scanAstPatches(code, readTree = () => parsePatchSource(code), readContext) {
  const results = Object.fromEntries(AST_PATCH_IDS.map(id => [id, { matches: [], protected: [], present: false, patched: false }]));
  if (!anchors.some(anchor => code.includes(anchor))) return results;
  const tree = readTree();
  const context = readContext ? readContext() : createPatchContext(tree, code);
  const functionNode = node => ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node?.type);
  const edit = (id, node, replacement, strategy = 'ast') => {
    results[id].matches.push({ start: node.start, end: node.end, replacement, strategy });
  };
  const alreadyPatched = (node, id) => {
    if (!hasGate(node, id)) return false;
    results[id].protected.push([node.start, node.end]);
    return true;
  };
  const injectReturn = (id, fn, value) => {
    if (!['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(fn?.type) || fn.async || fn.generator) return false;
    if (alreadyPatched(fn, id)) return true;
    const body = fn.body;
    const original = code.slice(body.start, body.end);
    if (body.type !== 'BlockStatement') {
      edit(id, body, `(${gate(id)}?${value}:(${original}))`);
      return true;
    }
    let insertion = body.start + 1;
    for (const statement of body.body) {
      if (!statement.directive) break;
      insertion = statement.end;
    }
    const offset = insertion - body.start;
    edit(id, body, `${original.slice(0, offset)};if(${gate(id)})return ${value};${original.slice(offset)}`);
    return true;
  };
  const overridePredicate = (id, value, property) => {
    if (functionNode(value)) return injectReturn(id, value, '!0');
    const replace = (replacement, strategy) => edit(id, property.shorthand ? property : value,
      `${property.shorthand ? 'isEnabled:' : ''}${replacement}`, strategy);
    const resolved = context.resolve(value);
    if (!functionNode(resolved?.node)) {
      const dynamic = node => ['Identifier', 'MemberExpression', 'CallExpression', 'ChainExpression'].includes(node?.type);
      if (!dynamic(value) || resolved?.node && !dynamic(resolved.node)) return false;
      replace(`globalThis.__clawgodHelpers.enablePredicate(${code.slice(value.start, value.end)},${JSON.stringify(id)})`, 'runtime-hook');
      return true;
    }
    if (resolved.node.async || resolved.node.generator) return false;
    replace(`((_original)=>function(){'use strict';if(${gate(id)})return!0;return _original.apply(this,arguments)})(${code.slice(value.start, value.end)})`);
    return true;
  };
  const ownReturns = fn => {
    if (fn.body.type !== 'BlockStatement') return [fn.body];
    const values = [];
    walk(fn.body, child => {
      if (functionNode(child)) return false;
      if (child.type === 'ReturnStatement' && child.argument) values.push(child.argument);
    });
    return values;
  };

  const functions = new Map();
  const wigglyLiterals = new Set(), wigglyHandled = new Set();
  let pairingHandled = false;
  const MISSING_SENTINEL = '[Tool result missing due to internal error]';
  const resolvesToMissingSentinel = code.includes(MISSING_SENTINEL) ? pairingScopeResolver(tree, MISSING_SENTINEL) : () => false;
  walk(tree, node => {
    if (node.type === 'FunctionDeclaration' && node.id?.type === 'Identifier') {
      functions.set(node.id.name, node);
    }
  });
  walk(tree, node => {
    if (node.type === 'ClassDeclaration' || node.type === 'ClassExpression') {
      const members = new Map(node.body.body.map(entry => [propertyName(entry), entry]));
      const reader = members.get('getEnvironmentOverrides');
      const id = 'growthbook-env-overrides-graph';
      if (reader?.value?.body?.type === 'BlockStatement' &&
          members.has('deps') && members.has('hasEnvironmentOverride') && members.has('readConfigOverrides') &&
          members.has('environmentOverridesRaw') && members.has('environmentOverrides')) {
        const body = reader.value.body;
        if (code.slice(body.start, body.end).includes('/*clawgod:growthbook-env-overrides-graph*/')) {
          results[id].patched = true;
          results[id].protected.push([body.start, body.end]);
        } else if (body.body.length === 1 && body.body[0].type === 'ReturnStatement' && literal(body.body[0].argument, null)) {
          results[id].present = true;
          edit(id, body, '{/*clawgod:growthbook-env-overrides-graph*/' +
            'let _raw=this.deps.readEnvironmentOverrides?.();' +
            'if(_raw===this.environmentOverridesRaw)return this.environmentOverrides;' +
            'this.environmentOverridesRaw=_raw;this.environmentOverrides=null;' +
            'if(typeof _raw==="string"&&_raw.trim()){try{let _value=JSON.parse(_raw);' +
            'if(_value&&typeof _value==="object"&&!Array.isArray(_value))this.environmentOverrides=_value}catch{}}' +
            'return this.environmentOverrides}');
        }
        const config = members.get('readConfigOverrides'), configId = 'growthbook-config-overrides-graph';
        const configBody = config?.value?.body;
        if (configBody?.type === 'BlockStatement') {
          if (code.slice(configBody.start, configBody.end).includes('/*clawgod:growthbook-config-overrides-graph*/')) {
            results[configId].patched = true;
            results[configId].protected.push([configBody.start, configBody.end]);
          } else if (configBody.body.length === 1 && configBody.body[0].type === 'ReturnStatement' &&
              (configBody.body[0].argument == null || literal(configBody.body[0].argument, null))) {
            results[configId].present = true;
            edit(configId, configBody,
              '{/*clawgod:growthbook-config-overrides-graph*/return globalThis.__clawgodHelpers?.flagOverrides??null}');
          }
        }
      }
    }
    if (literal(node, 'tengu_wiggly_dove')) wigglyLiterals.add(node.start);
    if (functionNode(node) && node.params.length === 0) {
      const flagArguments = [];
      let teamEnv = false;
      walk(node.body, child => {
        if (child !== node.body && functionNode(child)) return false;
        if (child.type === 'CallExpression' && child.arguments.length) flagArguments.push(child.arguments[0]);
        if (context.refers(child, 'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS')) teamEnv = true;
      });
      const booleanResult = (value, budget = 16) => {
        if (!value || budget <= 0) return false;
        if (boolean(value, true) || boolean(value, false)) return true;
        if (value.type === 'UnaryExpression' && value.operator === '!') return true;
        if (value.type === 'BinaryExpression' && ['===', '!==', '==', '!=', '<', '>', '<=', '>='].includes(value.operator)) return true;
        if (value.type === 'LogicalExpression') return booleanResult(value.right, budget - 1);
        if (value.type === 'ConditionalExpression') return booleanResult(value.consequent, budget - 1) && booleanResult(value.alternate, budget - 1);
        if (value.type === 'CallExpression' && context.text(value.arguments[0]) === 'tengu_amber_flint') {
          return boolean(value.arguments[1], true) || boolean(value.arguments[1], false);
        }
        return false;
      };
      const returns = teamEnv ? ownReturns(node) : [];
      if (teamEnv && returns.length && returns.every(value => booleanResult(value)) &&
          flagArguments.some(argument => context.text(argument) === 'tengu_amber_flint')) {
        const id = 'agent-teams-graph';
        if (alreadyPatched(node, id)) results[id].patched = true;
        else { results[id].present = true; injectReturn(id, node, '!0'); }
      }
    }
    if (node.type === 'Program' || node.type === 'BlockStatement') {
      const flags = node.body.filter(s => s.type === 'VariableDeclaration')
        .flatMap(s => s.declarations).filter(d => literal(d.init, 'tengu_wiggly_dove'));
      for (const flag of flags) {
        const id = 'wiggly-dove';
        const candidates = node.body.filter(fn => {
          if (fn.type !== 'FunctionDeclaration' || fn.params.length || fn.async || fn.generator) return false;
          const statements = fn.body.body.filter(s => !s.directive && s.type !== 'EmptyStatement');
          const guards = statements.slice(0, -1);
          const last = statements.at(-1);
          if (!guards.length || !guards.every(s => s.type === 'IfStatement' && !s.alternate &&
              s.consequent.type === 'ReturnStatement' && boolean(s.consequent.argument, false)) ||
              last?.type !== 'ReturnStatement' || last.argument?.type !== 'CallExpression') return false;
          return flag.id.type === 'Identifier' && guards.some(s => {
            const call = s.test.type === 'UnaryExpression' && s.test.operator === '!' ? s.test.argument : null;
            return call?.type === 'CallExpression' && call.arguments.length === 2 &&
              call.arguments[0].type === 'Identifier' && call.arguments[0].name === flag.id.name &&
              boolean(call.arguments[1], false);
          });
        });
        if (candidates.length !== 1) continue;
        wigglyHandled.add(flag.init.start);
        if (alreadyPatched(candidates[0], id)) results[id].patched = true;
        else injectReturn(id, candidates[0], '!1');
      }
    }

    if (node.type === 'ObjectExpression') {
      const props = node.properties;
      const named = name => props.filter(p => p.type === 'Property' && propertyName(p) === name);
      const names = named('name');
      const command = names.length === 1 ? context.text(names[0].value) : undefined;
      const commandId = command === 'ultraplan' ? 'ultraplan' :
        command === 'ultrareview' && named('isEnabled').length ? 'ultrareview-command' : undefined;
      if (commandId || names.some(p => literal(p.value, 'ultraplan'))) {
        const id = commandId ?? 'ultraplan';
        const enabled = named('isEnabled');
        const patched = enabled.length === 1 && alreadyPatched(enabled[0].value, id);
        if (patched) results[id].patched = true;
        else results[id].present = true;
        if (names.length === 1 && enabled.length === 1 && enabled[0].kind === 'init' &&
            !patched &&
            !props.some(p => p.type === 'SpreadElement' || (p.computed && p.key.type !== 'Literal'))) {
          if (!overridePredicate(id, enabled[0].value, enabled[0])) results[id].skipped = (results[id].skipped ?? 0) + 1;
        } else if (!patched) results[id].skipped = (results[id].skipped ?? 0) + 1;
      }
      const enabled = named('enabled');
      if (named('pixelValidation').length === 1 && enabled.length === 1 &&
          enabled[0].kind === 'init' &&
          !props.some(p => p.type === 'SpreadElement' || (p.computed && p.key.type !== 'Literal'))) {
        const id = 'computer-use-default', value = enabled[0].value;
        if (alreadyPatched(value, id)) results[id].patched = true;
        else {
          results[id].present = true;
          if (['Identifier', 'CallExpression', 'MemberExpression', 'LogicalExpression', 'ConditionalExpression'].includes(value.type) ||
              boolean(value, false) || boolean(value, true)) {
            edit(id, value, `(${gate(id)}?!0:(${code.slice(value.start, value.end)}))`);
          } else results[id].skipped = (results[id].skipped ?? 0) + 1;
        }
      }
    }

    if (functionNode(node) && !node.params.length && !node.async && !node.generator) {
      const id = 'computer-use-gate-semantic';
      let computerConfig = false, inlineConfig = false, candidate = false;
      const enabledResult = expression => {
        if (expression.type === 'ChainExpression') return enabledResult(expression.expression);
        if (expression.type === 'LogicalExpression' && expression.operator === '&&') return enabledResult(expression.right);
        if (expression.type === 'BinaryExpression' &&
            (expression.operator === '===' && boolean(expression.right, true) ||
             expression.operator === '!==' && boolean(expression.right, false))) return enabledResult(expression.left);
        return member(expression, 'enabled') ? expression : undefined;
      };
      if (alreadyPatched(node, id)) results[id].patched = true;
      else for (const value of ownReturns(node)) {
        const child = enabledResult(value);
        if (!child) continue;
        const config = context.resolve(child.object);
        if (config?.context?.field(config.node, 'pixelValidation') && config.context.field(config.node, 'enabled')) {
          results[id].present = true;
          candidate = true;
          if (config.context !== context || config.node.start < node.start || config.node.end > node.end) computerConfig = true;
          else inlineConfig = true;
        }
      }
      if (computerConfig && !inlineConfig) {
        injectReturn(id, node, '!0');
      } else if (candidate) results[id].skipped = (results[id].skipped ?? 0) + 1;
    }

    if (functionNode(node) && node.params.length === 1 &&
        node.params[0].type === 'Identifier' && !node.async && !node.generator) {
      const id = 'geo-stego-date';
      const partsOf = (value, budget = 32) => {
        if (budget <= 0) return [value];
        if (value.type === 'TemplateLiteral') return value.quasis.flatMap((quasi, index) =>
          index < value.expressions.length ? [quasi.value.cooked ?? '', ...partsOf(value.expressions[index], budget - 1)] : [quasi.value.cooked ?? '']);
        if (value.type === 'BinaryExpression' && value.operator === '+') return [...partsOf(value.left, budget - 1), ...partsOf(value.right, budget - 1)];
        const text = context.text(value);
        return [text === undefined ? value : text];
      };
      const fromParameter = (value, budget = 16) => {
        if (!value || budget <= 0) return;
        if (context.same(value, node.params[0])) return node.params[0].name;
        if (value.type === 'MemberExpression') {
          const object = fromParameter(value.object, budget - 1);
          const key = value.computed ? context.text(value.property) : value.property.name;
          if (object && key !== undefined) return `${object}[${JSON.stringify(key)}]`;
        }
      };
      let candidate = false, rewritten = false;
      if (alreadyPatched(node, id)) results[id].patched = true;
      else for (const date of ownReturns(node)) {
        const parts = [];
        for (const part of partsOf(date)) {
          if (typeof part === 'string' && typeof parts.at(-1) === 'string') parts[parts.length - 1] += part;
          else if (part !== '') parts.push(part);
        }
        if (parts.length !== 5 || parts[0] !== 'Today' || parts[2] !== 's date is ' || parts[4] !== '.') continue;
        results[id].present = true;
        candidate = true;
        const formatted = context.resolve(parts[3]);
        if (formatted?.context !== context || formatted.node.type !== 'ConditionalExpression') continue;
        const { consequent, alternate } = formatted.node;
        let raw;
        for (const [candidate, original] of [[consequent, alternate], [alternate, consequent]]) {
          const call = context.resolve(candidate)?.node;
          if (call?.type !== 'CallExpression' || call.arguments.length !== 2) continue;
          const separator = member(call.callee, 'replaceAll') && context.text(call.arguments[0]) === '-' ||
            member(call.callee, 'replace') && call.arguments[0].regex?.pattern === '-' && call.arguments[0].regex.flags === 'g';
          if (separator && context.text(call.arguments[1]) === '/' && context.same(call.callee.object, original)) raw = fromParameter(original);
        }
        if (raw) { rewritten = injectReturn(id, node, `\`Today's date is \${${raw}}.\``); break; }
      }
      if (candidate && !rewritten) results[id].skipped = (results[id].skipped ?? 0) + 1;
    }

    if (node.type === 'FunctionDeclaration' && node.params.length === 0 &&
        !node.async && !node.generator && node.body.body.length === 1 &&
        node.body.body[0].type === 'ReturnStatement') {
      const value = node.body.body[0].argument;
      if (literal(value, 'external')) edit('user-type-ant', value, '"ant"');
      const standalone = expr => expr?.type === 'BinaryExpression' && expr.operator === '===' &&
        member(expr.left, 'isStandaloneExecutable') && expr.left.object.name === 'Bun' && boolean(expr.right, true);
      const typeofBun = expr => expr?.type === 'BinaryExpression' && expr.operator === '<' &&
        expr.left.type === 'UnaryExpression' && expr.left.operator === 'typeof' &&
        expr.left.argument.name === 'Bun' && literal(expr.right, 'u');
      if (standalone(value) || (value?.type === 'LogicalExpression' && value.operator === '&&' &&
          typeofBun(value.left) && standalone(value.right))) edit('bun-standalone-executable', value, '!0');
      if (value?.type === 'UnaryExpression' && value.operator === '!' &&
          value.argument.type === 'CallExpression' && value.argument.callee.type === 'Identifier' &&
          value.argument.arguments.length === 2 && literal(value.argument.arguments[0], 'tengu_amber_quartz_disabled') &&
          boolean(value.argument.arguments[1], false)) {
        edit('voice-mode', value, `(${gate('voice-mode')}?!0:(${code.slice(value.start, value.end)}))`);
      }
    }

    if (node.type === 'FunctionDeclaration' && node.params.length === 0 &&
        !node.async && !node.generator) {
      const statements = node.body.body;
      const cached = statements.find(statement => statement.type === 'VariableDeclaration' &&
        statement.declarations.length === 1 && statement.declarations[0].id.type === 'Identifier' &&
        statement.declarations[0].init?.type === 'CallExpression');
      const cachedName = cached?.declarations[0].id.name;
      const cachedReturn = cachedName && statements.find(statement =>
        statement.type === 'IfStatement' && statement.test.type === 'BinaryExpression' &&
        statement.test.operator === '!==' && statement.test.left.type === 'Identifier' &&
        statement.test.left.name === cachedName && isUndefined(statement.test.right) &&
        statement.consequent.type === 'ReturnStatement' && statement.consequent.argument?.type === 'Identifier' &&
        statement.consequent.argument.name === cachedName);
      const eligibility = statements.filter(statement => statement.type === 'VariableDeclaration')
        .flatMap(statement => statement.declarations).find(declaration => declaration.id.type === 'ObjectPattern' &&
        declaration.init?.type === 'CallExpression' &&
        declaration.init.callee.type === 'Identifier' &&
        declaration.id.properties.some(property => property.type === 'Property' &&
          propertyName(property) === 'eligible'));
      const helper = eligibility && functions.get(eligibility.init.callee.name);
      if (helper && hasRemoteSettingsContext(helper)) {
        const id = 'remote-settings-off';
        if (!cachedReturn) results[id].present = true;
        else {
          results[id].present = false;
          if (alreadyPatched(node, id)) results[id].patched = true;
          else injectReturn(id, node, '!1');
        }
      }
    }

    if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node.type) &&
        node.params.length > 0 && node.params[0].type === 'Identifier') {
      const historyParam = node.params[0].name;
      let isHistoryArray = false;
      walkScope(node.body, inner => {
        if (inner.type === 'MemberExpression' && inner.object?.type === 'Identifier' && inner.object.name === historyParam) {
          if (inner.property?.name === 'length' || inner.computed) isHistoryArray = true;
        }
      });
      if (isHistoryArray) {
        const id = 'tool-result-pairing-recovery';
        if (hasGate(node, id)) {
          results[id].patched = true;
          pairingHandled = true;
        } else {
          walkScope(node.body, inner => {
            if (inner.type === 'CallExpression' && member(inner.callee, 'map') && inner.arguments.length >= 1) {
              const cb = inner.arguments[0];
              if (!['ArrowFunctionExpression', 'FunctionExpression'].includes(cb?.type) || cb.async || cb.generator) return;
              const idParam = cb.params[0];
              if (cb.params.length !== 1 || idParam?.type !== 'Identifier') return;
              const returnObj = cb.body.type === 'ObjectExpression' ? cb.body
                : cb.body.type === 'BlockStatement' && cb.body.body.length === 1 && cb.body.body[0].type === 'ReturnStatement' ? cb.body.body[0].argument
                : null;
              if (returnObj?.type !== 'ObjectExpression') return;
              const props = returnObj.properties.filter(p => p.type === 'Property');
              if (props.length !== 4 || returnObj.properties.length !== 4 ||
                  props.some(p => p.kind !== 'init' || p.method || (p.computed && p.key.type !== 'Literal')) ||
                  new Set(props.map(propertyName)).size !== 4) return;
              const hasType = props.some(p => propertyName(p) === 'type' && literal(p.value, 'tool_result'));
              const hasToolUseId = props.some(p => propertyName(p) === 'tool_use_id' && p.value?.type === 'Identifier' && p.value.name === idParam.name);
              const hasIsError = props.some(p => propertyName(p) === 'is_error' && boolean(p.value, true));
              const contentProp = props.find(p => propertyName(p) === 'content');
              if (hasType && hasToolUseId && hasIsError && contentProp && resolvesToMissingSentinel(contentProp.value, cb, node)) {
                const usedNames = new Set();
                walk(node, n => {
                  if (n.type === 'Identifier') usedNames.add(n.name);
                });
                const freshId = base => {
                  let name = base;
                  let counter = 1;
                  while (usedNames.has(name)) {
                    name = `${base}${counter++}`;
                  }
                  usedNames.add(name);
                  return name;
                };
                const pVar = freshId('_p');
                const mVar = freshId('_m');
                const bVar = freshId('_b');
                const idVar = freshId('_id');
                const contentExpr = code.slice(contentProp.value.start, contentProp.value.end);
                const replacement =
                  `(${idVar})=>{` +
                  `let ${pVar};` +
                  `if(${gate(id)}){` +
                  `for(let ${mVar} of ${historyParam}){` +
                  `if(${mVar}?.message?.content&&Array.isArray(${mVar}.message.content)){` +
                  `for(let ${bVar} of ${mVar}.message.content){` +
                  `if(${bVar}?.type==="tool_result"&&${bVar}.tool_use_id===${idVar}&&${bVar}.content!==${contentExpr}){` +
                  `${pVar}=${bVar};break;` +
                  `}` +
                  `}` +
                  `}` +
                  `if(${pVar})break;` +
                  `}` +
                  `}` +
                  `return ${pVar}?{...${pVar}}:{type:"tool_result",tool_use_id:${idVar},content:${contentExpr},is_error:!0}` +
                  `}`;
                edit(id, cb, replacement);
                pairingHandled = true;
              }
            }
          });
        }
      }
    }

    if ((node.type === 'MethodDefinition' || node.type === 'Property') &&
        propertyName(node) === 'getEnvironmentOverrides' && node.value?.body?.type === 'BlockStatement') {
      const statements = node.value.body.body;
      for (let i = 0; i < statements.length - 1; i++) {
        const statement = statements[i];
        const values = statement.argument?.expressions;
        const next = statements[i + 1];
        if (statement.type !== 'ReturnStatement' || values?.length !== 2) continue;
        const [assignment, result] = values;
        if (assignment.type !== 'AssignmentExpression' || assignment.operator !== '=' ||
            !thisMember(assignment.left, 'environmentOverridesParsed') || !boolean(assignment.right, true) ||
            !thisMember(result, 'environmentOverrides') || next.type !== 'VariableDeclaration') continue;
        const readsOverrides = next.declarations.some(d => d.init?.type === 'CallExpression' &&
          member(d.init.callee, 'readEnvironmentOverrides') && thisMember(d.init.callee.object, 'deps'));
        if (readsOverrides) edit('growthbook-env-overrides-graph', statement,
          `${code.slice(assignment.start, assignment.end)};`);
      }
    }
  });
  if ([...wigglyLiterals].some(start => !wigglyHandled.has(start))) {
    results['wiggly-dove'].present = true;
    results['wiggly-dove'].matches = [];
  }
  if (code.includes('[Tool result missing due to internal error]') && !pairingHandled) {
    results['tool-result-pairing-recovery'].present = true;
    results['tool-result-pairing-recovery'].matches = [];
  }
  return results;
}

export function applyAstEdits(code, edits) {
  const sorted = [...edits].sort((a, b) => a.start - b.start || a.end - b.end);
  const parts = [];
  let cursor = 0;
  let prev;
  for (const edit of sorted) {
    if (edit.start < cursor) {
      const snippet = (e) => JSON.stringify(code.slice(e.start, Math.min(e.end, e.start + 60)));
      const repl = (e) => JSON.stringify((e.replacement ?? '').slice(0, 60));
      throw new Error(
        `Overlapping AST patch edits: previous [${prev.start},${prev.end}) ${snippet(prev)} → ${repl(prev)}; ` +
        `current [${edit.start},${edit.end}) ${snippet(edit)} → ${repl(edit)}`);
    }
    const padding = code[edit.start - 1] === '/' && edit.replacement.startsWith('/*') ? ' ' : '';
    parts.push(code.slice(cursor, edit.start), padding, edit.replacement);
    cursor = edit.end;
    prev = edit;
  }
  parts.push(code.slice(cursor));
  return parts.join('');
}
