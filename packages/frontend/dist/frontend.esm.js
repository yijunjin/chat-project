// packages/shared/src/index.ts
function isObject(val) {
  return typeof val === "object" && val !== null;
}

// packages/backend/src/index.ts
function test() {
  return 123;
}

// packages/frontend/src/index.ts
console.log(isObject({}));
console.log(test());
//# sourceMappingURL=frontend.esm.js.map
