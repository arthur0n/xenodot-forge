// Pre-commit: lint + format only the staged files. eslint runs with
// --max-warnings 0 so any Tier A warning fails the commit; --fix auto-resolves
// what it can. HTML is intentionally left out so index.html's hand-tuned
// markup isn't reflowed.
export default {
  "**/*.js": ["eslint --max-warnings 0 --fix", "prettier --write"],
  "**/*.{json,md,css}": ["prettier --write"],
};
