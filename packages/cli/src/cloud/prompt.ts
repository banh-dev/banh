import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';

/** Read from a terminal without echoing the token or retaining it in readline history. */
export async function promptToken(): Promise<string> {
  if (!process.stdin.isTTY) throw new Error('Non-interactive login requires BANH_API_TOKEN.');
  const muted = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  const readline = createInterface({ input: process.stdin, output: muted, terminal: true, historySize: 0 });
  process.stderr.write('Banh API token: ');
  try {
    return await new Promise<string>((resolve, reject) => {
      readline.once('line', resolve);
      readline.once('SIGINT', () => reject(new Error('Login cancelled')));
      readline.once('close', () => reject(new Error('Login cancelled')));
    });
  } finally {
    readline.close();
    muted.end();
    process.stderr.write('\n');
  }
}
