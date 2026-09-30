import * as pty from 'node-pty'
import type { PtyFactory } from './ptyManager'

export const nodePtyFactory: PtyFactory = (file, args, opts) =>
  pty.spawn(file, args, { name: 'xterm-256color', cwd: opts.cwd, cols: opts.cols, rows: opts.rows, env: opts.env, useConpty: true })
