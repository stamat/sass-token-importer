import fs from 'node:fs'
import path from 'node:path'
import { URL } from 'node:url'
import { transformCamelCaseToDash } from 'book-of-spells'

const TOKEN_SCHEME = 'token:'

const GENERIC_FONT_FAMILIES = new Set([
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy',
  'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded',
  'math', 'emoji', 'fangsong'
])

const SD_TYPE_ALIASES = {
  size: 'dimension',
  opacity: 'number'
}

/**
 * Sanitize a token name segment for use as a SCSS variable/key name
 * @param {string} name
 * @returns {string}
 */
function sanitizeName(name) {
  return transformCamelCaseToDash(name)
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
}

/**
 * Detect token format: W3C DTCG or Style Dictionary
 * @param {object} data - Parsed JSON token data
 * @returns {'dtcg' | 'style-dictionary'}
 */
export function detectFormat(data) {
  const stack = [data]
  while (stack.length > 0) {
    const node = stack.pop()
    if (node === null || typeof node !== 'object' || Array.isArray(node)) continue
    if ('$value' in node) return 'dtcg'
    if ('value' in node && 'type' in node) return 'style-dictionary'
    for (const key of Object.keys(node)) {
      if (!key.startsWith('$')) {
        stack.push(node[key])
      }
    }
  }
  return 'dtcg'
}

/**
 * Extract flat token entries from a token tree
 * @param {object} data - Parsed JSON token data
 * @param {'dtcg' | 'style-dictionary'} format
 * @returns {Array<{path: string[], type: string, value: *}>}
 */
export function extractTokens(data, format) {
  const tokens = []

  function walk(node, currentPath, inheritedType) {
    if (node === null || typeof node !== 'object' || Array.isArray(node)) return

    if (format === 'dtcg') {
      const groupType = node.$type || inheritedType
      if ('$value' in node) {
        tokens.push({
          path: currentPath,
          type: groupType || 'unknown',
          value: node.$value
        })
        return
      }
      for (const key of Object.keys(node)) {
        if (key.startsWith('$')) continue
        walk(node[key], [...currentPath, key], groupType)
      }
    } else {
      if ('value' in node && 'type' in node) {
        const rawType = node.type
        const type = SD_TYPE_ALIASES[rawType] || rawType
        tokens.push({
          path: currentPath,
          type,
          value: node.value
        })
        return
      }
      for (const key of Object.keys(node)) {
        walk(node[key], [...currentPath, key], inheritedType)
      }
    }
  }

  walk(data, [], undefined)
  return tokens
}

/**
 * Resolve alias references in token values
 * @param {Array<{path: string[], type: string, value: *}>} tokens
 * @returns {Array<{path: string[], type: string, value: *}>}
 */
export function resolveAliases(tokens) {
  const tokenMap = new Map()
  for (const token of tokens) {
    tokenMap.set(token.path.join('.'), token)
  }

  const resolved = new Set()
  const resolving = new Set()

  function resolveValue(value, tokenKey) {
    if (typeof value === 'string') {
      const aliasMatch = value.match(/^\{(.+)\}$/)
      if (aliasMatch) {
        const refPath = aliasMatch[1]
        if (resolving.has(refPath)) {
          throw new Error(`Circular alias reference detected: ${refPath}`)
        }
        const refToken = tokenMap.get(refPath)
        if (!refToken) return value
        resolveToken(refToken)
        return refToken.value
      }
      return value
    }
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const result = {}
      for (const [k, v] of Object.entries(value)) {
        result[k] = resolveValue(v, tokenKey)
      }
      return result
    }
    return value
  }

  function resolveToken(token) {
    const key = token.path.join('.')
    if (resolved.has(key)) return
    resolving.add(key)
    token.value = resolveValue(token.value, key)
    resolving.delete(key)
    resolved.add(key)
  }

  for (const token of tokens) {
    resolveToken(token)
  }

  return tokens
}

/**
 * Convert a token value to a SCSS string representation
 * @param {*} value
 * @param {string} type
 * @returns {string}
 */
export function convertValue(value, type) {
  switch (type) {
    case 'color':
      return convertColor(value)
    case 'dimension':
      return convertDimension(value)
    case 'fontFamily':
      return convertFontFamily(value)
    case 'fontWeight':
      return String(value)
    case 'duration':
      return convertDuration(value)
    case 'cubicBezier':
      return convertCubicBezier(value)
    case 'number':
      return String(value)
    case 'typography':
    case 'shadow':
    case 'border':
      return convertComposite(value, type)
    default:
      return String(value)
  }
}

function convertColor(value) {
  if (typeof value === 'string') return value
  if (typeof value === 'object' && value !== null) {
    const { colorSpace, components, alpha } = value
    if (colorSpace === 'srgb' && Array.isArray(components)) {
      const [r, g, b] = components
      if (alpha !== undefined && alpha < 1) {
        return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${alpha})`
      }
      const toHex = (n) => Math.round(n * 255).toString(16).padStart(2, '0')
      return `#${toHex(r)}${toHex(g)}${toHex(b)}`
    }
    if (colorSpace && Array.isArray(components)) {
      const a = alpha !== undefined && alpha < 1 ? ` / ${alpha}` : ''
      return `color(${colorSpace} ${components.join(' ')}${a})`
    }
  }
  return String(value)
}

function convertDimension(value) {
  if (typeof value === 'string') return value
  if (typeof value === 'object' && value !== null) {
    return `${value.value}${value.unit}`
  }
  return String(value)
}

function convertFontFamily(value) {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    const parts = value.map((f) => {
      if (GENERIC_FONT_FAMILIES.has(f)) return f
      return `"${f}"`
    })
    return `(${parts.join(', ')})`
  }
  return String(value)
}

function convertDuration(value) {
  if (typeof value === 'string') return value
  if (typeof value === 'object' && value !== null) {
    return `${value.value}${value.unit}`
  }
  return String(value)
}

function convertCubicBezier(value) {
  if (Array.isArray(value)) {
    return `cubic-bezier(${value.join(', ')})`
  }
  return String(value)
}

function convertComposite(value, type) {
  if (typeof value !== 'object' || value === null) return String(value)
  const entries = Object.entries(value).map(([k, v]) => {
    const key = transformCamelCaseToDash(k)
    const subType = inferSubType(k, type)
    const converted = convertValue(v, subType)
    return `  ${key}: ${converted},`
  })
  return `(\n${entries.join('\n')}\n)`
}

function inferSubType(key, parentType) {
  const keyLower = key.toLowerCase()
  if (keyLower.includes('color') || keyLower === 'color') return 'color'
  if (keyLower.includes('family') || keyLower === 'fontfamily') return 'fontFamily'
  if (keyLower.includes('weight') || keyLower === 'fontweight') return 'fontWeight'
  if (keyLower.includes('size') || keyLower.includes('width') ||
      keyLower.includes('height') || keyLower.includes('spacing') ||
      keyLower.includes('offset') || keyLower.includes('blur') ||
      keyLower.includes('spread')) return 'dimension'
  if (keyLower === 'lineheight') return 'number'
  if (keyLower === 'style') return 'unknown'
  return 'unknown'
}

/**
 * Generate SCSS content from extracted tokens
 * @param {Array<{path: string[], type: string, value: *}>} tokens
 * @param {'variables' | 'map'} mode
 * @returns {string}
 */
export function generateScss(tokens, mode) {
  if (tokens.length === 0) return ''

  if (mode === 'map') {
    return generateScssMap(tokens)
  }
  return generateScssVariables(tokens)
}

function generateScssVariables(tokens) {
  const lines = []
  for (const token of tokens) {
    const name = token.path.map(sanitizeName).join('-')
    const value = convertValue(token.value, token.type)
    lines.push(`$${name}: ${value};`)
  }
  return lines.join('\n') + '\n'
}

function generateScssMap(tokens) {
  const tree = {}

  for (const token of tokens) {
    let node = tree
    for (let i = 0; i < token.path.length - 1; i++) {
      const key = sanitizeName(token.path[i])
      if (!(key in node)) node[key] = {}
      node = node[key]
    }
    const leafKey = sanitizeName(token.path[token.path.length - 1])
    node[leafKey] = { __token: token }
  }

  const lines = []
  for (const [topKey, subtree] of Object.entries(tree)) {
    if (subtree.__token) {
      const token = subtree.__token
      const value = convertValue(token.value, token.type)
      lines.push(`$${topKey}: ${value};`)
    } else {
      const mapContent = renderMapNode(subtree, 1)
      lines.push(`$${topKey}: ${mapContent};`)
    }
  }

  return lines.join('\n\n') + '\n'
}

function renderMapNode(node, depth) {
  const indent = '  '.repeat(depth)
  const entries = []

  for (const [key, child] of Object.entries(node)) {
    if (child.__token) {
      const token = child.__token
      const value = convertValue(token.value, token.type)
      entries.push(`${indent}${key}: ${value},`)
    } else {
      const nested = renderMapNode(child, depth + 1)
      entries.push(`${indent}${key}: ${nested},`)
    }
  }

  const outerIndent = '  '.repeat(depth - 1)
  return `(\n${entries.join('\n')}\n${outerIndent})`
}

/**
 * Create a Dart Sass Importer for JSON design tokens
 * @param {string | string[]} tokenPaths - Directory or directories containing token JSON files
 * @param {{ output?: 'variables' | 'map', resolveAliases?: boolean }} [options]
 * @returns {import('sass').Importer<'sync'>}
 */
export function sassTokenImporter(tokenPaths, options) {
  const paths = Array.isArray(tokenPaths) ? tokenPaths : [tokenPaths]
  const resolvedPaths = paths.map((p) => path.resolve(p))
  const mode = (options && options.output) || 'variables'
  const shouldResolveAliases = options && options.resolveAliases !== undefined ? options.resolveAliases : true
  const cache = new Map()

  return {
    canonicalize(url) {
      let lookupName = url

      if (url.startsWith(TOKEN_SCHEME)) {
        const rest = url.slice(TOKEN_SCHEME.length)
        if (rest.startsWith('/')) return new URL(url)
        lookupName = rest
      }

      for (const tokenDir of resolvedPaths) {
        const jsonPath = path.join(tokenDir, `${lookupName}.json`)
        if (fs.existsSync(jsonPath)) {
          const absolute = path.resolve(jsonPath)
          return new URL(`${TOKEN_SCHEME}${absolute}`)
        }
      }

      return null
    },

    load(canonicalUrl) {
      const filePath = canonicalUrl.toString().slice(TOKEN_SCHEME.length)

      if (cache.has(filePath)) {
        return cache.get(filePath)
      }

      const json = fs.readFileSync(filePath, 'utf-8')
      const data = JSON.parse(json)

      const format = detectFormat(data)
      let tokens = extractTokens(data, format)

      if (shouldResolveAliases) {
        tokens = resolveAliases(tokens)
      }

      const contents = generateScss(tokens, mode)

      const result = { contents, syntax: 'scss' }
      cache.set(filePath, result)
      return result
    }
  }
}

export default sassTokenImporter
