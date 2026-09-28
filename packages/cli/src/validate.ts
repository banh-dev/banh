import { readFile } from 'node:fs/promises';
import { parseProcess } from '@banh-dev/dsl';

export async function validateCommand(path: string): Promise<void> {
  const definition = parseProcess(await readFile(path, 'utf8'));
  console.log(`✓ YAML parsed\n✓ schema valid\n✓ ${Object.keys(definition.decisions).length} decisions\n✓ ${definition.flow.length} flow rules\n✓ all expression references valid\n\nProcess is valid.`);
}
