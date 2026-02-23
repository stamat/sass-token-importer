import type { Importer } from 'sass';

export interface TokenEntry {
  path: string[];
  type: string;
  value: unknown;
}

export interface TokenImporterOptions {
  output?: 'variables' | 'map';
  resolveAliases?: boolean;
}

export function detectFormat(data: object): 'dtcg' | 'style-dictionary';
export function extractTokens(data: object, format: 'dtcg' | 'style-dictionary'): TokenEntry[];
export function resolveAliases(tokens: TokenEntry[]): TokenEntry[];
export function convertValue(value: unknown, type: string): string;
export function generateScss(tokens: TokenEntry[], mode: 'variables' | 'map'): string;

export function sassTokenImporter(tokenPaths: string | string[], options?: TokenImporterOptions): Importer<'sync'>;

export default sassTokenImporter;
