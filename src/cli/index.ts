import { runCli } from './run'

function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return Promise.resolve('')
  return new Promise((resolve) => {
    let d = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (c) => (d += c))
    process.stdin.on('end', () => resolve(d))
    process.stdin.on('error', () => resolve(d))
  })
}

void runCli(process.argv.slice(2), {
  env: process.env,
  out: (s) => process.stdout.write(s),
  err: (s) => process.stderr.write(s),
  readStdin
}).then((code) => { process.exitCode = code })
