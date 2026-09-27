#!/usr/bin/env node
import { validateCommand } from './validate.js';
import { runCommand } from './run.js';
import { cloudCommand } from './cloud/commands.js';

const help = `Usage:
  banh validate <workflow.yaml>
  banh run <workflow.yaml> (--input <file> | --text <text>) [options]

  banh login [--api-url <url>] [--no-browser]
  banh logout
  banh whoami [--json] [--api-url <url>]
  banh deploy <workflow.yaml> [--json] [--api-url <url>]
  banh invoke <workflow> (--input <json-file> | --text <text>) [--json] [--api-url <url>]

  banh runs <workflow> [--limit <1-100>] [--offset <0-10000>] [--json] [--api-url <url>]
  banh inspect <run-id> [--json] [--api-url <url>]

  banh billing [status | checkout <starter|pro> | plan <starter|pro> | portal] [--json] [--api-url <url>]

Options:
  --json              Emit machine-readable JSON on stdout
  --verbose           Emit execution events on stderr
  --provider <name>   native (default) or http
  --model <name>      laya (default), kev, or jev; native supports laya
  --model-id <id>     Exact HTTP server model ID or checkpoint
  --base-url <url>    TypeSafe-compatible HTTP server base URL
  --timeout-ms <ms>   HTTP request timeout (default: 60000)
  --model-dir <dir>    Use an existing local ONNX model bundle
  --cache-dir <dir>    Set the model download cache
  --revision <rev>     Select a model repository revision

Cloud commands default to http://127.0.0.1:3000 until a login is saved.
Environment: BANH_API_URL, BANH_API_TOKEN, BANH_ACCOUNT_ID.

Inference environment: BANH_PROVIDER, BANH_MODEL, BANH_INFERENCE_BASE_URL,
BANH_INFERENCE_TOKEN (required for Jev), BANH_INFERENCE_TIMEOUT_MS,
BANH_INFERENCE_MODEL_ID.
Validation never loads a model. Native run downloads model weights on first use.`;
const args = process.argv.slice(2);
try {
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) console.log(help);
  else if (args[0] === 'validate' && args.length === 2) await validateCommand(args[1]!);
  else if (args[0] === 'run') await runCommand(args.slice(1));
  else if (args[0] === 'login' || args[0] === 'logout' || args[0] === 'whoami' || args[0] === 'deploy' || args[0] === 'invoke' || args[0] === 'runs' || args[0] === 'inspect' || args[0] === 'billing') await cloudCommand(args[0], args.slice(1));
  else throw new Error(help);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
