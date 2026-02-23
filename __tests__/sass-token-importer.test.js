import { it, describe, expect } from '@jest/globals'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as sass from 'sass'
import {
  detectFormat,
  extractTokens,
  resolveAliases,
  convertValue,
  generateScss,
  sassTokenImporter
} from '../sass-token-importer.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE_ROOT = path.join(__dirname, 'fixtures')
const DTCG_DIR = path.join(FIXTURE_ROOT, 'tokens', 'dtcg')
const SD_DIR = path.join(FIXTURE_ROOT, 'tokens', 'style-dictionary')
const INVALID_DIR = path.join(FIXTURE_ROOT, 'tokens', 'invalid')
const SCSS_DIR = path.join(FIXTURE_ROOT, 'scss')

describe('detectFormat', () => {
  it('detects DTCG format when $value is present', () => {
    const data = {
      color: {
        $type: 'color',
        primary: { $value: '#0066cc' }
      }
    }
    expect(detectFormat(data)).toBe('dtcg')
  })

  it('detects Style Dictionary format when value+type siblings are present', () => {
    const data = {
      color: {
        primary: { value: '#0066cc', type: 'color' }
      }
    }
    expect(detectFormat(data)).toBe('style-dictionary')
  })

  it('defaults to dtcg for empty objects', () => {
    expect(detectFormat({})).toBe('dtcg')
  })

  it('detects format in deeply nested structures', () => {
    const dtcg = {
      level1: { level2: { level3: { $value: 'test' } } }
    }
    expect(detectFormat(dtcg)).toBe('dtcg')

    const sd = {
      level1: { level2: { level3: { value: 'test', type: 'string' } } }
    }
    expect(detectFormat(sd)).toBe('style-dictionary')
  })
})

describe('extractTokens', () => {
  it('extracts DTCG tokens with inherited $type', () => {
    const data = {
      color: {
        $type: 'color',
        primary: { $value: '#0066cc' },
        secondary: { $value: '#ff6600' }
      }
    }
    const tokens = extractTokens(data, 'dtcg')
    expect(tokens).toHaveLength(2)
    expect(tokens[0]).toEqual({
      path: ['color', 'primary'],
      type: 'color',
      value: '#0066cc'
    })
    expect(tokens[1]).toEqual({
      path: ['color', 'secondary'],
      type: 'color',
      value: '#ff6600'
    })
  })

  it('extracts DTCG tokens with per-token $type', () => {
    const data = {
      spacing: {
        sm: { $type: 'dimension', $value: '8px' }
      }
    }
    const tokens = extractTokens(data, 'dtcg')
    expect(tokens).toHaveLength(1)
    expect(tokens[0].type).toBe('dimension')
  })

  it('skips $-prefixed metadata keys', () => {
    const data = {
      $description: 'Design tokens',
      color: {
        $type: 'color',
        primary: { $value: '#000', $description: 'Primary color' }
      }
    }
    const tokens = extractTokens(data, 'dtcg')
    expect(tokens).toHaveLength(1)
    expect(tokens[0].path).toEqual(['color', 'primary'])
  })

  it('handles deeply nested token paths', () => {
    const data = {
      typography: {
        $type: 'typography',
        heading: {
          h1: {
            $value: { fontSize: '32px' }
          }
        }
      }
    }
    const tokens = extractTokens(data, 'dtcg')
    expect(tokens[0].path).toEqual(['typography', 'heading', 'h1'])
  })

  it('extracts Style Dictionary tokens', () => {
    const data = {
      color: {
        primary: { value: '#0066cc', type: 'color' },
        secondary: { value: '#ff6600', type: 'color' }
      }
    }
    const tokens = extractTokens(data, 'style-dictionary')
    expect(tokens).toHaveLength(2)
    expect(tokens[0]).toEqual({
      path: ['color', 'primary'],
      type: 'color',
      value: '#0066cc'
    })
  })

  it('normalizes SD type aliases', () => {
    const data = {
      size: {
        sm: { value: '8px', type: 'size' }
      },
      alpha: {
        half: { value: 0.5, type: 'opacity' }
      }
    }
    const tokens = extractTokens(data, 'style-dictionary')
    expect(tokens[0].type).toBe('dimension')
    expect(tokens[1].type).toBe('number')
  })

  it('returns empty array for empty input', () => {
    expect(extractTokens({}, 'dtcg')).toEqual([])
    expect(extractTokens({}, 'style-dictionary')).toEqual([])
  })
})

describe('resolveAliases', () => {
  it('resolves simple alias references', () => {
    const tokens = [
      { path: ['color', 'blue'], type: 'color', value: '#0066cc' },
      { path: ['color', 'primary'], type: 'color', value: '{color.blue}' }
    ]
    const resolved = resolveAliases(tokens)
    expect(resolved[1].value).toBe('#0066cc')
  })

  it('resolves chained aliases', () => {
    const tokens = [
      { path: ['color', 'blue'], type: 'color', value: '#0066cc' },
      { path: ['color', 'primary'], type: 'color', value: '{color.blue}' },
      { path: ['color', 'action'], type: 'color', value: '{color.primary}' }
    ]
    const resolved = resolveAliases(tokens)
    expect(resolved[2].value).toBe('#0066cc')
  })

  it('resolves aliases within composite values', () => {
    const tokens = [
      { path: ['color', 'black'], type: 'color', value: '#000000' },
      { path: ['border', 'default'], type: 'border', value: { color: '{color.black}', width: '1px', style: 'solid' } }
    ]
    const resolved = resolveAliases(tokens)
    expect(resolved[1].value.color).toBe('#000000')
  })

  it('throws on circular references', () => {
    const tokens = [
      { path: ['a'], type: 'color', value: '{b}' },
      { path: ['b'], type: 'color', value: '{a}' }
    ]
    expect(() => resolveAliases(tokens)).toThrow('Circular alias reference')
  })

  it('leaves unresolvable references as-is', () => {
    const tokens = [
      { path: ['color', 'primary'], type: 'color', value: '{nonexistent.token}' }
    ]
    const resolved = resolveAliases(tokens)
    expect(resolved[0].value).toBe('{nonexistent.token}')
  })

  it('does not modify non-alias values', () => {
    const tokens = [
      { path: ['spacing', 'sm'], type: 'dimension', value: '8px' },
      { path: ['count'], type: 'number', value: 42 }
    ]
    const resolved = resolveAliases(tokens)
    expect(resolved[0].value).toBe('8px')
    expect(resolved[1].value).toBe(42)
  })
})

describe('convertValue', () => {
  describe('color', () => {
    it('passes through hex strings', () => {
      expect(convertValue('#0066cc', 'color')).toBe('#0066cc')
    })

    it('converts sRGB object to hex', () => {
      const value = { colorSpace: 'srgb', components: [1, 0, 0] }
      expect(convertValue(value, 'color')).toBe('#ff0000')
    })

    it('converts sRGB object with alpha to rgba', () => {
      const value = { colorSpace: 'srgb', components: [1, 0, 0], alpha: 0.5 }
      expect(convertValue(value, 'color')).toBe('rgba(255, 0, 0, 0.5)')
    })

    it('converts non-sRGB colors to color() function', () => {
      const value = { colorSpace: 'display-p3', components: [1, 0, 0] }
      expect(convertValue(value, 'color')).toBe('color(display-p3 1 0 0)')
    })

    it('converts non-sRGB colors with alpha', () => {
      const value = { colorSpace: 'display-p3', components: [1, 0, 0], alpha: 0.5 }
      expect(convertValue(value, 'color')).toBe('color(display-p3 1 0 0 / 0.5)')
    })
  })

  describe('dimension', () => {
    it('passes through string values', () => {
      expect(convertValue('8px', 'dimension')).toBe('8px')
      expect(convertValue('1.5rem', 'dimension')).toBe('1.5rem')
    })

    it('converts object values', () => {
      expect(convertValue({ value: 8, unit: 'px' }, 'dimension')).toBe('8px')
      expect(convertValue({ value: 1.5, unit: 'rem' }, 'dimension')).toBe('1.5rem')
    })
  })

  describe('fontFamily', () => {
    it('converts array with generic family unquoted', () => {
      const value = ['Helvetica', 'Arial', 'sans-serif']
      expect(convertValue(value, 'fontFamily')).toBe('("Helvetica", "Arial", sans-serif)')
    })

    it('quotes all non-generic families', () => {
      const value = ['Inter', 'Roboto']
      expect(convertValue(value, 'fontFamily')).toBe('("Inter", "Roboto")')
    })

    it('passes through strings', () => {
      expect(convertValue('monospace', 'fontFamily')).toBe('monospace')
    })
  })

  describe('fontWeight', () => {
    it('converts numbers to strings', () => {
      expect(convertValue(700, 'fontWeight')).toBe('700')
    })

    it('passes through string values', () => {
      expect(convertValue('bold', 'fontWeight')).toBe('bold')
    })
  })

  describe('duration', () => {
    it('passes through string values', () => {
      expect(convertValue('200ms', 'duration')).toBe('200ms')
    })

    it('converts object values', () => {
      expect(convertValue({ value: 200, unit: 'ms' }, 'duration')).toBe('200ms')
    })
  })

  describe('cubicBezier', () => {
    it('converts array to CSS cubic-bezier function', () => {
      expect(convertValue([0.42, 0, 0.58, 1], 'cubicBezier')).toBe('cubic-bezier(0.42, 0, 0.58, 1)')
    })
  })

  describe('number', () => {
    it('converts to string', () => {
      expect(convertValue(1.5, 'number')).toBe('1.5')
      expect(convertValue(0, 'number')).toBe('0')
    })
  })

  describe('composite types', () => {
    it('converts typography to Sass map', () => {
      const value = {
        fontFamily: ['Helvetica', 'sans-serif'],
        fontSize: '32px',
        fontWeight: 700,
        lineHeight: 1.2
      }
      const result = convertValue(value, 'typography')
      expect(result).toContain('font-family: ("Helvetica", sans-serif)')
      expect(result).toContain('font-size: 32px')
      expect(result).toContain('font-weight: 700')
      expect(result).toContain('line-height: 1.2')
    })

    it('converts shadow to Sass map', () => {
      const value = {
        color: '#00000033',
        offsetX: '0px',
        offsetY: '1px',
        blur: '2px',
        spread: '0px'
      }
      const result = convertValue(value, 'shadow')
      expect(result).toContain('color: #00000033')
      expect(result).toContain('offset-x: 0px')
      expect(result).toContain('offset-y: 1px')
      expect(result).toContain('blur: 2px')
      expect(result).toContain('spread: 0px')
    })

    it('converts border to Sass map', () => {
      const value = { color: '#cccccc', width: '1px', style: 'solid' }
      const result = convertValue(value, 'border')
      expect(result).toContain('color: #cccccc')
      expect(result).toContain('width: 1px')
      expect(result).toContain('style: solid')
    })
  })

  describe('unknown type', () => {
    it('passes through strings', () => {
      expect(convertValue('anything', 'unknown')).toBe('anything')
    })

    it('converts numbers to strings', () => {
      expect(convertValue(42, 'unknown')).toBe('42')
    })
  })
})

describe('generateScss', () => {
  const tokens = [
    { path: ['color', 'primary'], type: 'color', value: '#0066cc' },
    { path: ['color', 'secondary'], type: 'color', value: '#ff6600' },
    { path: ['spacing', 'sm'], type: 'dimension', value: '8px' },
    { path: ['spacing', 'md'], type: 'dimension', value: '16px' }
  ]

  describe('variables mode', () => {
    it('generates flat SCSS variables', () => {
      const scss = generateScss(tokens, 'variables')
      expect(scss).toContain('$color-primary: #0066cc;')
      expect(scss).toContain('$color-secondary: #ff6600;')
      expect(scss).toContain('$spacing-sm: 8px;')
      expect(scss).toContain('$spacing-md: 16px;')
    })

    it('handles composite tokens as inline maps', () => {
      const typoTokens = [
        {
          path: ['typography', 'body'],
          type: 'typography',
          value: { fontFamily: ['Georgia', 'serif'], fontSize: '16px', fontWeight: 400, lineHeight: 1.5 }
        }
      ]
      const scss = generateScss(typoTokens, 'variables')
      expect(scss).toContain('$typography-body:')
      expect(scss).toContain('font-family:')
      expect(scss).toContain('font-size: 16px')
    })
  })

  describe('map mode', () => {
    it('generates nested Sass maps grouped by top-level key', () => {
      const scss = generateScss(tokens, 'map')
      expect(scss).toContain('$color: (')
      expect(scss).toContain('primary: #0066cc,')
      expect(scss).toContain('secondary: #ff6600,')
      expect(scss).toContain('$spacing: (')
      expect(scss).toContain('sm: 8px,')
      expect(scss).toContain('md: 16px,')
    })

    it('handles deeply nested paths', () => {
      const deep = [
        { path: ['typography', 'heading', 'h1'], type: 'dimension', value: '32px' },
        { path: ['typography', 'heading', 'h2'], type: 'dimension', value: '24px' }
      ]
      const scss = generateScss(deep, 'map')
      expect(scss).toContain('$typography: (')
      expect(scss).toContain('heading: (')
      expect(scss).toContain('h1: 32px,')
      expect(scss).toContain('h2: 24px,')
    })
  })

  it('returns empty string for empty tokens', () => {
    expect(generateScss([], 'variables')).toBe('')
    expect(generateScss([], 'map')).toBe('')
  })
})

describe('sassTokenImporter', () => {
  describe('canonicalize', () => {
    it('resolves a token: prefixed import', () => {
      const importer = sassTokenImporter(DTCG_DIR)
      const result = importer.canonicalize('token:colors')
      expect(result).toBeInstanceOf(URL)
      expect(result.toString()).toContain('token:')
      expect(result.toString()).toContain('colors.json')
    })

    it('returns null for non-existent files', () => {
      const importer = sassTokenImporter(DTCG_DIR)
      const result = importer.canonicalize('token:nonexistent')
      expect(result).toBeNull()
    })

    it('searches multiple directories', () => {
      const importer = sassTokenImporter([DTCG_DIR, SD_DIR])
      const dtcgResult = importer.canonicalize('token:spacing')
      const sdResult = importer.canonicalize('token:colors')
      expect(dtcgResult).not.toBeNull()
      expect(sdResult).not.toBeNull()
    })

    it('passes through already-canonical token: URLs with absolute paths', () => {
      const importer = sassTokenImporter(DTCG_DIR)
      const url = 'token:/some/path/file.json'
      const result = importer.canonicalize(url)
      expect(result.toString()).toBe(url)
    })

    it('resolves bare imports without token: prefix', () => {
      const importer = sassTokenImporter(DTCG_DIR)
      const result = importer.canonicalize('colors')
      expect(result).toBeInstanceOf(URL)
      expect(result.toString()).toContain('colors.json')
    })

    it('returns null for bare non-existent files', () => {
      const importer = sassTokenImporter(DTCG_DIR)
      const result = importer.canonicalize('nonexistent')
      expect(result).toBeNull()
    })
  })

  describe('load', () => {
    it('loads and converts DTCG tokens to SCSS variables', () => {
      const importer = sassTokenImporter(DTCG_DIR)
      const canonical = importer.canonicalize('token:colors')
      const result = importer.load(canonical)
      expect(result.syntax).toBe('scss')
      expect(result.contents).toContain('$color-primary: #0066cc;')
      expect(result.contents).toContain('$color-secondary: #ff6600;')
    })

    it('loads and converts to Sass maps', () => {
      const importer = sassTokenImporter(DTCG_DIR, { output: 'map' })
      const canonical = importer.canonicalize('token:colors')
      const result = importer.load(canonical)
      expect(result.syntax).toBe('scss')
      expect(result.contents).toContain('$color: (')
      expect(result.contents).toContain('primary: #0066cc,')
    })

    it('resolves aliases by default', () => {
      const importer = sassTokenImporter(DTCG_DIR)
      const canonical = importer.canonicalize('token:aliases')
      const result = importer.load(canonical)
      expect(result.contents).toContain('$color-primary: #0066cc;')
      expect(result.contents).toContain('$color-action: #0066cc;')
    })

    it('skips alias resolution when disabled', () => {
      const importer = sassTokenImporter(DTCG_DIR, { resolveAliases: false })
      const canonical = importer.canonicalize('token:aliases')
      const result = importer.load(canonical)
      expect(result.contents).toContain('{color.base.blue}')
    })

    it('loads Style Dictionary format', () => {
      const importer = sassTokenImporter(SD_DIR)
      const canonical = importer.canonicalize('token:colors')
      const result = importer.load(canonical)
      expect(result.contents).toContain('$color-primary: #0066cc;')
    })

    it('returns empty SCSS for empty JSON', () => {
      const importer = sassTokenImporter(INVALID_DIR)
      const canonical = importer.canonicalize('token:empty')
      const result = importer.load(canonical)
      expect(result.contents).toBe('')
      expect(result.syntax).toBe('scss')
    })

    it('throws on malformed JSON', () => {
      const importer = sassTokenImporter(INVALID_DIR)
      const canonical = importer.canonicalize('token:malformed')
      expect(() => importer.load(canonical)).toThrow()
    })

    it('caches results for the same file', () => {
      const importer = sassTokenImporter(DTCG_DIR)
      const canonical = importer.canonicalize('token:colors')
      const first = importer.load(canonical)
      const second = importer.load(canonical)
      expect(first).toBe(second)
    })
  })
})

describe('Integration with Dart Sass', () => {
  it('compiles SCSS with token variables', () => {
    const result = sass.compile(path.join(SCSS_DIR, 'entry-variables.scss'), {
      importers: [sassTokenImporter(DTCG_DIR)]
    })
    expect(result.css).toContain('color: #0066cc')
    expect(result.css).toContain('padding: 8px 16px')
  })

  it('compiles SCSS with token maps', () => {
    const result = sass.compile(path.join(SCSS_DIR, 'entry-maps.scss'), {
      importers: [sassTokenImporter(DTCG_DIR, { output: 'map' })]
    })
    expect(result.css).toContain('color: #0066cc')
    expect(result.css).toContain('padding: 8px 16px')
  })

  it('compiles with compileString', () => {
    const scss = '@use "token:colors" as c;\n.test { color: c.$color-primary; }'
    const result = sass.compileString(scss, {
      importers: [sassTokenImporter(DTCG_DIR)]
    })
    expect(result.css).toContain('color: #0066cc')
  })

  it('handles typography composite tokens', () => {
    const scss = [
      '@use "sass:map";',
      '@use "token:typography" as t;',
      '.heading { font-size: map.get(t.$typography-heading-h1, font-size); }'
    ].join('\n')
    const result = sass.compileString(scss, {
      importers: [sassTokenImporter(DTCG_DIR)]
    })
    expect(result.css).toContain('font-size: 32px')
  })

  it('handles shadow and border composite tokens', () => {
    const scss = [
      '@use "sass:map";',
      '@use "token:shadows" as s;',
      '.box {',
      '  border-width: map.get(s.$border-thin, width);',
      '}'
    ].join('\n')
    const result = sass.compileString(scss, {
      importers: [sassTokenImporter(DTCG_DIR)]
    })
    expect(result.css).toContain('border-width: 1px')
  })

  it('works with multiple token directories', () => {
    const scss = [
      '@use "token:colors" as c;',
      '@use "token:spacing" as s;',
      '.test { color: c.$color-primary; margin: s.$spacing-sm; }'
    ].join('\n')
    const result = sass.compileString(scss, {
      importers: [sassTokenImporter([DTCG_DIR, SD_DIR])]
    })
    expect(result.css).toContain('color: #0066cc')
  })

  it('coexists with other importers', () => {
    const scss = '@use "token:colors" as c;\n.test { color: c.$color-primary; }'
    const result = sass.compileString(scss, {
      importers: [
        sassTokenImporter(DTCG_DIR),
        { canonicalize() { return null }, load() { return null } }
      ]
    })
    expect(result.css).toContain('color: #0066cc')
  })

  it('throws on non-existent token import', () => {
    const scss = '@use "token:nonexistent";'
    expect(() => {
      sass.compileString(scss, {
        importers: [sassTokenImporter(DTCG_DIR)]
      })
    }).toThrow()
  })
})
