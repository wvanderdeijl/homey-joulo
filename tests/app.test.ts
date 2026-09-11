import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

function readJsonConfig<T = Record<string, unknown>>(relativeFilePath: string): T {
  const absolutePath = path.join(__dirname, '..', relativeFilePath);
  expect(fs.existsSync(absolutePath)).toBe(true);
  return JSON.parse(fs.readFileSync(absolutePath, 'utf8')) as T;
}

describe('Homey App Workspace Scaffolding', () => {
  it('should have a valid app.json manifest with required Homey SDK v3 fields', () => {
    interface Manifest {
      id: string;
      version: string;
      compatibility: string;
      sdk: number;
      runtime: string;
      platforms: string[];
      brandColor: string;
      category: string[];
    }

    const manifest = readJsonConfig<Manifest>('.homeycompose/app.json');
    expect(manifest.id).toBe('com.vanderdeijl.homey.joulo');
    expect(manifest.version).toBe('1.0.0');
    expect(manifest.compatibility).toBe('>=12.4.5');
    expect(manifest.sdk).toBe(3);
    expect(manifest.runtime).toBe('nodejs');
    expect(manifest.platforms).toContain('local');
    expect(manifest.brandColor).toBe('#10B981');
    expect(manifest.category).toContain('energy');
  });

  it('should have strict compiler options in tsconfig.json targeting ES2022 and CommonJS', () => {
    interface TsConfig {
      compilerOptions: {
        target: string;
        module: string;
        strict: boolean;
        outDir: string;
      };
    }

    const tsconfig = readJsonConfig<TsConfig>('tsconfig.json');
    expect(tsconfig.compilerOptions.target).toBe('ES2022');
    expect(tsconfig.compilerOptions.module).toBe('CommonJS');
    expect(tsconfig.compilerOptions.strict).toBe(true);
    expect(tsconfig.compilerOptions.outDir).toBe('.homeybuild/');
  });

  it('should have valid changelog matching manifest version', () => {
    interface Changelog {
      [version: string]: {
        en: string;
      };
    }

    const changelog = readJsonConfig<Changelog>('.homeychangelog.json');
    expect(changelog['1.0.0']).toBeDefined();
    expect(changelog['1.0.0']?.en).toBeDefined();
  });
});
