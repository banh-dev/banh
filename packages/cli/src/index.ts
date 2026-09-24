#!/usr/bin/env node
import { validateCommand } from './validate.js';
import { runCommand } from './run.js';
import { cloudCommand } from './cloud/commands.js';

const help = `Usage:
  banh validate <workflow.yaml>
  banh run <workflow.yaml> (--input <file> | --text <text>) [options]

  banh login [--api-url <url>]
  banh logout
  banh whoami [--json] [--api-url <url>]
  banh deploy <workflow.yaml> [--json] [--api-url <url>]

Options:
  --json              Emit machine-readable JSON on stdout
  --verbose           Emit execution events on stderr
  --model-dir <dir>    Use an existing local ONNX model bundle
  --cache-dir <dir>    Set the model download cache
  --revision <rev>     Select a model repository revision

Cloud commands default to http://127.0.0.1:3000 until a login is saved.
Environment: BANH_API_URL, BANH_API_TOKEN, BANH_ACCOUNT_ID.

Validation never loads a model. Run downloads model weights on first use.`;
const args = process.argv.slice(2);
try {
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) console.log(help);
  else if (args[0] === 'validate' && args.length === 2) await validateCommand(args[1]!);
  else if (args[0] === 'run') await runCommand(args.slice(1));
  else if (args[0] === 'login' || args[0] === 'logout' || args[0] === 'whoami' || args[0] === 'deploy') await cloudCommand(args[0], args.slice(1));
  else throw new Error(help);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
