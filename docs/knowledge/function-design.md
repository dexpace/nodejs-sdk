# function-design

## Rules
- The 70-line cap applies equally to top-level function declarations, methods, and arrow callbacks.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/05-functions.md:57-57` · high · sha:51c21236bb1b</sub>
- If the honest one-sentence summary of a function needs the word "and," the function should be split into two functions.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/05-functions.md:56-56` · high · sha:51c21236bb1b</sub>
- Each function must operate at one level of abstraction, either orchestrating named steps or performing primitive work, never mixing the two.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/05-functions.md:63-72` · high · sha:51c21236bb1b</sub>
- When a high-level function body contains a tight loop or bit-twiddling fragment, extract that fragment into a named helper function.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/05-functions.md:68-68` · high · sha:51c21236bb1b</sub>
- Functions must place guard clauses for exceptional cases first with early returns, keeping the happy path flush left at the lowest indentation.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/05-functions.md:74-91` · high · sha:51c21236bb1b</sub>
- An `if`/`else` pair should usually be inverted into a guard clause with an early return rather than nested branching.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/05-functions.md:78-78` · high · sha:51c21236bb1b</sub>
- Functions must be ordered top-down in a file so that each function appears above the functions it calls (the step-down rule).
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/05-functions.md:93-103` · high · sha:51c21236bb1b</sub>
- Use top-level named `function` declarations rather than `const fn = () => {}` for functions that must read top-down, since function declarations are hoisted and const arrows are not.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/05-functions.md:97-97` · high · sha:51c21236bb1b</sub>
- Arrow functions are reserved for inline callbacks (e.g. `items.map(toRow)`), which never need to read top-down.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/05-functions.md:99-99` · high · sha:51c21236bb1b</sub>
- A function must take an options object when it has 3 or more parameters, or whenever it takes any boolean parameter regardless of total parameter count.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/05-functions.md:105-114` · high · sha:51c21236bb1b</sub>
- Functions are pure by default (same input, same output, no observable effect); side effects are pushed to a thin shell at the edges that calls a pure core.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/05-functions.md:148-164` · high · sha:51c21236bb1b</sub>
- Boolean control-flag parameters that fork a function's body into two paths are forbidden; split such a function into two separately named functions instead.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/05-functions.md:166-174` · high · sha:51c21236bb1b</sub>
- Function overloads are used only when the return type genuinely varies with the shape of the input; otherwise a union parameter or generic is used instead of overloads.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/05-functions.md:176-184` · high · sha:51c21236bb1b</sub>
- Every exported function must have an explicit return type annotation rather than relying on inference at the module boundary.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/05-functions.md:186-194` · high · sha:51c21236bb1b</sub>
- Statements within a function should be grouped into paragraphs by thought (e.g. guards, then computation, then postconditions, then return) separated by blank lines.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/05-functions.md:196-204` · high · sha:51c21236bb1b</sub>

## Constraints
- Functions are capped at 70 lines (blank lines counted, comments excluded), enforced by lint, though the target is 10–30 lines.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/05-functions.md:51-61` · high · sha:51c21236bb1b</sub>
- Function nesting depth is capped by ESLint `max-depth: ['error', 3]`, with a target of 2 or fewer.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/05-functions.md:91-91` · high · sha:51c21236bb1b</sub>
- Positional parameters are capped by ESLint `max-params: ['error', 3]`.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/05-functions.md:114-114` · high · sha:51c21236bb1b</sub>

## Conclusions
- The control-flag ban (5.9) differs from the options-object rule (5.5): 5.5 permits a configuration boolean inside an options object, while 5.9 forbids a behavior-forking boolean entirely, even inside an options object.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/05-functions.md:170-170` · high · sha:51c21236bb1b</sub>

## Reference
- The 70-line function cap is enforced via ESLint `max-lines-per-function: ['error', {max: 70, skipComments: true, skipBlankLines: false}]`.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/05-functions.md:61-61` · high · sha:51c21236bb1b</sub>
- Named function declarations survive in stack traces more reliably across tooling than an anonymous arrow function assigned to a const.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/05-functions.md:98-98` · high · sha:51c21236bb1b</sub>
- The step-down rule is enforced via ESLint `func-style: ['error', 'declaration', {allowArrowFunctions: true}]`.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/05-functions.md:103-103` · high · sha:51c21236bb1b</sub>
- The overload-avoidance rule is enforced by ESLint `@typescript-eslint/unified-signatures`, which collapses overloads that a union parameter would cover.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/05-functions.md:184-184` · high · sha:51c21236bb1b</sub>
- Explicit return types on exported functions are enforced via ESLint `@typescript-eslint/explicit-module-boundary-types`.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/05-functions.md:194-194` · high · sha:51c21236bb1b</sub>

## Conflicts

## Superseded
