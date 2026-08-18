/**
 * Minimal readline-backed console for the interactive setup wizard. Keeps all
 * IO here so the wizard's decision logic stays free of stream plumbing and can
 * be driven by a scripted fake console in tests.
 * @module @aitechmei/dsh-feishu
 */

import * as readline from 'node:readline'
import * as process from 'node:process'

/** Raised when the user interrupts the wizard (Ctrl+C). */
export class CancelledError extends Error {
  constructor() {
    super('Setup cancelled')
    this.name = 'CancelledError'
  }
}

/** An option presented by {@link ConsoleIO.select}. */
export interface SelectOption<T> {
  label: string
  value: T
}

/** Stream-based console primitives the wizard uses to interact. */
export interface ConsoleIO {
  /** Ask a free-form question and return the trimmed reply. */
  prompt(question: string): Promise<string>
  /** Present numbered choices; returns the selected value. */
  select<T>(question: string, options: SelectOption<T>[], defaultValue?: T): Promise<T>
  /** Ask a yes/no question; returns the boolean answer. */
  yesno(question: string, defaultValue?: boolean): Promise<boolean>
}

/** Build a console from (optionally injected) streams. */
export function createConsole(
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stdout,
): ConsoleIO {
  const rl = readline.createInterface({ input, output })
  const promptOnce = (question: string): Promise<string> =>
    new Promise((resolve, reject) => {
      rl.question(question, (answer) => resolve(answer))
      rl.once('close', () => reject(new CancelledError()))
    })

  return {
    prompt: async (question) => await promptOnce(question).then((answer) => answer.trim()),
    select: async (question, options, defaultValue) => {
      output.write(question + '\n')
      options.forEach((option, index) => {
        output.write(`  ${index + 1}) ${option.label}\n`)
      })
      const hint = defaultValue !== undefined
        ? `\n[1-${options.length}, default ${options.findIndex((o) => o.value === defaultValue) + 1}]: `
        : ` [1-${options.length}]: `
      for (;;) {
        const raw = await promptOnce(hint)
        if (raw.length === 0 && defaultValue !== undefined) return defaultValue
        const index = Number.parseInt(raw, 10)
        if (Number.isInteger(index) && index >= 1 && index <= options.length) {
          return options[index - 1].value
        }
        output.write('  Please choose a valid option.\n')
      }
    },
    yesno: async (question, defaultValue) => {
      const hint = defaultValue === true ? ' [Y/n]' : defaultValue === false ? ' [y/N]' : ' [y/n]'
      for (;;) {
        const answer = (await promptOnce(question + hint + ': ')).toLowerCase()
        if (answer === 'y' || answer === 'yes') return true
        if (answer === 'n' || answer === 'no') return false
        if (answer === '' && defaultValue !== undefined) return defaultValue
        output.write('  Please answer y or n.\n')
      }
    },
  }
}
