/**
 * @opentui/solid/jsx-runtime 的 minimal JS 实现。
 *
 * @opentui/solid 仅导出类型声明（.d.ts），无实际运行时 JS。
 * 此文件为 Bun 加载 .jsx 文件时提供所需的 jsx/jsxs/jsxDEV/Fragment 实现。
 */

let reconciler = null;
function getReconciler() {
  if (!reconciler) {
    // dynamic import to avoid circular deps
    reconciler = require("@opentui/solid");
  }
  return reconciler;
}

const Fragment = Symbol("Fragment");

function flattenChildren(children) {
  if (children == null) return [];
  if (Array.isArray(children)) return children.flat(Infinity).filter(c => c != null && c !== false && c !== true);
  return [children];
}

function jsx(type, props, key) {
  const r = getReconciler();

  if (typeof type === "function") {
    // Component
    const compProps = { ...(props || {}) };
    if (key != null) compProps.key = key;
    const compChildren = props?.children;
    if (compChildren !== undefined) {
      delete compProps.children;
    }
    const result = r.createComponent(type, compProps);
    if (result && compChildren !== undefined) {
      for (const child of flattenChildren(compChildren)) {
        if (typeof child === "string" || typeof child === "number") {
          const textNode = r.createTextNode(String(child));
          r.insertNode(result, textNode);
        } else if (child && typeof child === "object") {
          r.insertNode(result, child);
        }
      }
    }
    return result;
  }

  if (type === Fragment) {
    const frag = r.createElement("fragment");
    for (const child of flattenChildren(props?.children)) {
      if (typeof child === "string" || typeof child === "number") {
        const textNode = r.createTextNode(String(child));
        r.insertNode(frag, textNode);
      } else if (child && typeof child === "object") {
        r.insertNode(frag, child);
      }
    }
    return frag;
  }

  // Intrinsic element
  const el = r.createElement(type);
  if (props) {
    for (const [name, value] of Object.entries(props)) {
      if (name === "children") continue;
      if (name === "key") continue;
      r.setProp(el, name, value);
    }
  }
  const kids = flattenChildren(props?.children);
  for (const child of kids) {
    if (typeof child === "string" || typeof child === "number") {
      const textNode = r.createTextNode(String(child));
      r.insertNode(el, textNode);
    } else if (child && typeof child === "object") {
      r.insertNode(el, child);
    }
  }
  return el;
}

function jsxs(type, props, key) {
  // jsxs is same as jsx for static children (SolidJS distinction)
  return jsx(type, props, key);
}

function jsxDEV(type, props, key, _isStaticChildren, _source, _self) {
  return jsx(type, props, key);
}

export { Fragment, jsx, jsxs, jsxDEV };
