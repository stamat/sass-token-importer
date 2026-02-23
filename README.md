# sass-token-importer

A custom [`Importer`](https://sass-lang.com/documentation/js-api/interfaces/importer/) for Dart Sass that imports JSON design tokens and converts them to SCSS variables or maps at compile time.

Supports both [W3C Design Token Community Group (DTCG)](https://design-tokens.github.io/community-group/format/) and [Style Dictionary](https://amzn.github.io/style-dictionary/) token formats, auto-detected.

## Why?

The existing packages for this (`node-sass-json-importer`, `dart-sass-json-importer`) are dead or stuck on the legacy node-sass API. This uses the modern Dart Sass `Importer` interface — `canonicalize()` + `load()` — and generates SCSS on the fly.

## Install

```bash
npm install sass-token-importer
```

## Usage

Given a token file `tokens/colors.json`:

```json
{
  "color": {
    "$type": "color",
    "primary": { "$value": "#0066cc" },
    "secondary": { "$value": "#ff6600" }
  }
}
```

### Flat variables (default)

```js
import { compile } from "sass";
import { sassTokenImporter } from "sass-token-importer";

const result = compile("main.scss", {
  importers: [sassTokenImporter("tokens/")],
});
```

```scss
@use "token:colors" as c;

.btn {
  color: c.$color-primary; // #0066cc
}
```

Generated SCSS:

```scss
$color-primary: #0066cc;
$color-secondary: #ff6600;
```

### Sass maps

```js
compile("main.scss", {
  importers: [sassTokenImporter("tokens/", { output: "map" })],
});
```

```scss
@use "sass:map";
@use "token:colors" as c;

.btn {
  color: map.get(c.$color, primary); // #0066cc
}
```

Generated SCSS:

```scss
$color: (
  primary: #0066cc,
  secondary: #ff6600,
);
```

### Multiple directories

```js
compile("main.scss", {
  importers: [sassTokenImporter(["tokens/", "other/tokens/"])],
});
```

### Disable alias resolution

```js
compile("main.scss", {
  importers: [
    sassTokenImporter("tokens/", { resolveAliases: false }),
  ],
});
```

## The `token:` prefix

Use `@use "token:colors"` instead of `@use "colors"` to explicitly target the token importer. This avoids ambiguity when you have both a `colors.json` token file and a `colors.scss` file in your project.

Without the prefix, `@use "colors"` works too — Sass tries importers in the order they're registered. But the prefix makes the intent clear and prevents collisions.

## Token formats

The importer auto-detects the format by scanning for `$value` (DTCG) or `value` + `type` siblings (Style Dictionary).

### W3C DTCG

```json
{
  "spacing": {
    "$type": "dimension",
    "sm": { "$value": "8px" },
    "md": { "$value": "16px" }
  }
}
```

- `$type` is inherited from parent groups
- `$`-prefixed metadata keys (`$description`, etc.) are skipped
- Alias references like `"{color.primary}"` are resolved

### Style Dictionary

```json
{
  "spacing": {
    "sm": { "value": "8px", "type": "dimension" },
    "md": { "value": "16px", "type": "dimension" }
  }
}
```

- Type aliases are normalized: `size` → `dimension`, `opacity` → `number`

## Supported token types

| Type | Input | SCSS Output |
|------|-------|-------------|
| `color` | `"#0066cc"` | `#0066cc` |
| `color` | `{ colorSpace, components, alpha }` | hex, `rgba()`, or `color()` |
| `dimension` | `"8px"` or `{ value: 8, unit: "px" }` | `8px` |
| `fontFamily` | `["Helvetica", "Arial", "sans-serif"]` | `("Helvetica", "Arial", sans-serif)` |
| `fontWeight` | `700` or `"bold"` | `700` / `bold` |
| `duration` | `"200ms"` or `{ value: 200, unit: "ms" }` | `200ms` |
| `cubicBezier` | `[0.42, 0, 0.58, 1]` | `cubic-bezier(0.42, 0, 0.58, 1)` |
| `typography` | composite object | Sass map |
| `shadow` | composite object | Sass map |
| `border` | composite object | Sass map |

Generic font families (`sans-serif`, `monospace`, etc.) stay unquoted. Composite types always produce Sass maps with kebab-case keys.

## Aliases

DTCG alias references are resolved by default:

```json
{
  "color": {
    "$type": "color",
    "base": { "blue": { "$value": "#0066cc" } },
    "primary": { "$value": "{color.base.blue}" },
    "action": { "$value": "{color.primary}" }
  }
}
```

Chained aliases are resolved in topological order. Circular references throw an error. Aliases inside composite sub-values are resolved recursively. Disable with `{ resolveAliases: false }`.

## API

### `sassTokenImporter(tokenPaths, options?)`

Returns a Dart Sass [`Importer<'sync'>`](https://sass-lang.com/documentation/js-api/interfaces/importer/) object.

- **`tokenPaths`** `string | string[]` — Directory or directories containing `.json` token files.
- **`options.output`** `'variables' | 'map'` — Output mode. Default: `'variables'`.
- **`options.resolveAliases`** `boolean` — Resolve `{path.to.token}` alias references. Default: `true`.

### Resolution

`@use "token:colors"` → the importer strips the `token:` prefix, searches each token directory for `colors.json`, and returns `{ contents, syntax: 'scss' }` with the generated SCSS. Results are cached per file path for the lifetime of the importer instance.

## Works with sass-path-resolver

This importer coexists with [`sass-path-resolver`](https://github.com/stamat/sass-path-resolver) or any other importer in the same `importers` array:

```js
import { sassPathResolver } from "sass-path-resolver";
import { sassTokenImporter } from "sass-token-importer";

compile("main.scss", {
  importers: [
    sassTokenImporter("tokens/"),
    sassPathResolver("node_modules"),
  ],
});
```

## License

MIT
