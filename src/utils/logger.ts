/**
 * Enhanced logging utility with styled output and progress bars
 */

import * as readline from 'readline';

export interface LoggerOptions {
  verbose?: boolean;
  enableProgress?: boolean;
}

export class Logger {
  private verbose: boolean;
  private enableProgress: boolean;
  private currentProgressLine: string = '';
  private isProgressActive: boolean = false;

  constructor(options: LoggerOptions = {}) {
    this.verbose = options.verbose || false;
    this.enableProgress = options.enableProgress !== false; // default to true
  }

  /**
   * Styles text with ANSI colors
   */
  private styleText(text: string, color: string): string {
    const colors: { [key: string]: string } = {
      reset: '\x1b[0m',
      bright: '\x1b[1m',
      dim: '\x1b[2m',
      red: '\x1b[31m',
      green: '\x1b[32m',
      yellow: '\x1b[33m',
      blue: '\x1b[34m',
      magenta: '\x1b[35m',
      cyan: '\x1b[36m',
      white: '\x1b[37m',
      gray: '\x1b[90m'
    };
    return `${colors[color] || ''}${text}${colors.reset}`;
  }

  /**
   * Clears the current progress line if active
   */
  private clearProgressLine(): void {
    if (this.isProgressActive && this.currentProgressLine) {
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      this.isProgressActive = false;
      this.currentProgressLine = '';
    }
  }

  /**
   * Logs an informational message
   */
  info(message: string, emoji: string = 'ℹ️'): void {
    this.clearProgressLine();
    console.log(`${emoji} ${this.styleText(message, 'cyan')}`);
  }

  /**
   * Logs a success message
   */
  success(message: string, emoji: string = '✅'): void {
    this.clearProgressLine();
    console.log(`${emoji} ${this.styleText(message, 'green')}`);
  }

  /**
   * Logs a warning message
   */
  warn(message: string, emoji: string = '⚠️'): void {
    this.clearProgressLine();
    console.log(`${emoji} ${this.styleText(message, 'yellow')}`);
  }

  /**
   * Logs an error message
   */
  error(message: string, emoji: string = '❌'): void {
    this.clearProgressLine();
    console.error(`${emoji} ${this.styleText(message, 'red')}`);
  }

  /**
   * Logs a step in the process
   */
  step(message: string, stepNumber?: number, totalSteps?: number): void {
    this.clearProgressLine();
    const stepInfo = stepNumber && totalSteps ? `(${stepNumber}/${totalSteps}) ` : '';
    console.log(`${this.styleText('🔄', 'blue')} ${stepInfo}${this.styleText(message, 'blue')}`);
  }

  /**
   * Shows a progress bar for downloads
   */
  showProgress(
    current: number,
    total: number,
    filename: string,
    currentTime?: number,
    totalTime?: number
  ): void {
    if (!this.enableProgress) return;

    const percentage = Math.min(100, Math.max(0, (current / total) * 100));
    const barLength = 20;
    const filledLength = Math.round((barLength * percentage) / 100);
    const emptyLength = barLength - filledLength;

    const filledBar = '█'.repeat(filledLength);
    const emptyBar = '░'.repeat(emptyLength);
    const bar = `[${this.styleText(filledBar, 'green')}${emptyBar}]`;

    const timeInfo = currentTime && totalTime
      ? ` (${Math.floor(currentTime)}s/${Math.floor(totalTime)}s)`
      : '';

    const speedInfo = currentTime && currentTime > 0 && totalTime
      ? ` ${this.styleText(`(${(currentTime / totalTime * 100).toFixed(1)}% speed)`, 'dim')}`
      : '';

    this.currentProgressLine = `📥 ${bar} ${percentage.toFixed(1)}% ${filename}${timeInfo}${speedInfo}`;

    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
    process.stdout.write(this.currentProgressLine);
    this.isProgressActive = true;
  }

  /**
   * Shows a spinning indicator for ongoing processes
   */
  showSpinner(message: string, position: number = 0): void {
    if (!this.enableProgress) return;

    const spinners = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    const spinner = spinners[position % spinners.length];

    this.currentProgressLine = `${spinner} ${message}`;

    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
    process.stdout.write(this.currentProgressLine);
    this.isProgressActive = true;
  }

  /**
   * Completes the current progress line
   */
  completeProgress(message?: string): void {
    if (!this.isProgressActive) return;

    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);

    if (message) {
      console.log(`✅ ${message}`);
    } else {
      console.log('');
    }

    this.isProgressActive = false;
    this.currentProgressLine = '';
  }

  /**
   * Logs a section header
   */
  section(title: string): void {
    this.clearProgressLine();
    const line = '─'.repeat(title.length + 4);
    console.log(this.styleText(line, 'cyan'));
    console.log(this.styleText(`  ${title}  `, 'bright') + this.styleText(line, 'cyan'));
    console.log(this.styleText(line, 'cyan'));
  }

  /**
   * Logs debug information (only in verbose mode)
   */
  debug(message: string, data?: any): void {
    if (!this.verbose) return;
    this.clearProgressLine();
    console.log(`${this.styleText('🔍 DEBUG:', 'gray')} ${message}`);
    if (data) {
      console.log(this.styleText(JSON.stringify(data, null, 2), 'dim'));
    }
  }

  /**
   * Shows a list of items
   */
  showList(items: string[], title?: string): void {
    this.clearProgressLine();
    if (title) {
      console.log(`${this.styleText(title, 'bright')}`);
    }
    items.forEach((item, index) => {
      const bullet = this.styleText('•', 'cyan');
      console.log(`  ${bullet} ${item}`);
    });
  }

  /**
   * Shows a summary box
   */
  showSummary(title: string, items: { label: string; value: string; emoji?: string }[]): void {
    this.clearProgressLine();

    const maxLabelLength = Math.max(...items.map(item => item.label.length));
    const maxContentLength = Math.max(...items.map(item => item.label.length + item.value.length + 4));
    const boxWidth = Math.max(title.length + 6, maxContentLength + 8, 40);

    const borderTop = this.styleText('┌' + '─'.repeat(boxWidth - 2) + '┐', 'cyan');
    const borderBottom = this.styleText('└' + '─'.repeat(boxWidth - 2) + '┘', 'cyan');

    const titlePadding = Math.max(0, boxWidth - title.length - 4);
    const titleLine = this.styleText(`│ ${this.styleText(title, 'bright')} ${' '.repeat(titlePadding)}│`, 'cyan');

    console.log(borderTop);
    console.log(titleLine);
    console.log(this.styleText('├' + '─'.repeat(boxWidth - 2) + '┤', 'cyan'));

    items.forEach(item => {
      const emoji = item.emoji || '📋';
      const labelText = this.styleText(item.label + ':', 'bright');
      const content = `${emoji} ${labelText} ${item.value}`;
      const padding = Math.max(0, boxWidth - content.length - 4);
      const line = `│ ${content}${' '.repeat(padding)} │`;
      console.log(this.styleText(line, 'cyan'));
    });

    console.log(borderBottom);
  }
}

// Default logger instance
export const logger = new Logger();