/**
 * Utility for loading and managing clip detection prompts
 */

import * as fs from 'fs';
import * as path from 'path';
import { LogLevel } from '../types';
import { logIfEnabled } from './validators';

export interface PromptTemplate {
  name: string;
  template: string;
  filePath: string;
  description?: string;
}

export interface PromptVariables {
  CHUNK_DURATION_MINUTE: string;
  START_TIME: string;
  END_TIME: string;
  TRANSCRIPT_CONTENT: string;
}

export class PromptLoader {
  private promptsDir: string;
  private prompts: Map<string, PromptTemplate> = new Map();

  constructor(promptsDir: string = './prompts') {
    this.promptsDir = promptsDir;
  }

  /**
   * Loads all available prompts from the prompts directory
   * @param verbose Whether to log verbose output
   * @returns Promise resolving to loaded prompts
   */
  async loadPrompts(verbose: boolean = false): Promise<Map<string, PromptTemplate>> {
    this.prompts.clear();

    if (!fs.existsSync(this.promptsDir)) {
      logIfEnabled(LogLevel.WARN, verbose, `Prompts directory not found: ${this.promptsDir}`);
      return this.prompts;
    }

    try {
      const files = await fs.promises.readdir(this.promptsDir);
      const promptFiles = files.filter(file => file.endsWith('.txt'));

      logIfEnabled(LogLevel.INFO, verbose, `Found ${promptFiles.length} prompt files in ${this.promptsDir}`);

      for (const file of promptFiles) {
        try {
          const filePath = path.join(this.promptsDir, file);
          const content = await fs.promises.readFile(filePath, 'utf-8');
          const promptName = path.basename(file, '.txt');

          // Extract description from the first line if it starts with #
          let description: string | undefined;
          const lines = content.split('\n');
          if (lines.length > 0) {
            const firstLine = lines[0];
            if (firstLine && firstLine.startsWith('#')) {
              description = firstLine.substring(1).trim();
            }
          }

          const promptTemplate: PromptTemplate = {
            name: promptName,
            template: content,
            filePath,
            ...(description && { description })
          };

          this.prompts.set(promptName, promptTemplate);
          logIfEnabled(LogLevel.DEBUG, verbose, `Loaded prompt: ${promptName}`);

        } catch (error) {
          logIfEnabled(LogLevel.ERROR, verbose, `Failed to load prompt file: ${file}`, error);
        }
      }

      logIfEnabled(LogLevel.INFO, verbose, `Successfully loaded ${this.prompts.size} prompts`);
      return this.prompts;

    } catch (error) {
      logIfEnabled(LogLevel.ERROR, verbose, `Failed to load prompts from directory: ${this.promptsDir}`, error);
      return this.prompts;
    }
  }

  /**
   * Gets a specific prompt by name
   * @param name The prompt name
   * @returns The prompt template or undefined if not found
   */
  getPrompt(name: string): PromptTemplate | undefined {
    return this.prompts.get(name);
  }

  /**
   * Gets all available prompt names
   * @returns Array of prompt names
   */
  getAvailablePrompts(): string[] {
    return Array.from(this.prompts.keys());
  }

  /**
   * Gets a list of prompts with their descriptions
   * @returns Array of prompts with names and descriptions
   */
  getPromptList(): Array<{ name: string; description?: string }> {
    return Array.from(this.prompts.values()).map(prompt => ({
      name: prompt.name,
      ...(prompt.description && { description: prompt.description })
    }));
  }

  /**
   * Renders a prompt template with the provided variables
   * @param promptTemplate The prompt template to render
   * @param variables The variables to substitute
   * @returns The rendered prompt
   */
  renderPrompt(promptTemplate: PromptTemplate, variables: PromptVariables): string {
    let rendered = promptTemplate.template;

    // Replace all variable placeholders
    rendered = rendered.replace(/\{CHUNK_DURATION_MINUTE\}/g, variables.CHUNK_DURATION_MINUTE);
    rendered = rendered.replace(/\{START_TIME\}/g, variables.START_TIME);
    rendered = rendered.replace(/\{END_TIME\}/g, variables.END_TIME);
    rendered = rendered.replace(/\{TRANSCRIPT_CONTENT\}/g, variables.TRANSCRIPT_CONTENT);

    return rendered;
  }

  /**
   * Validates that a prompt template contains required variables
   * @param promptTemplate The prompt template to validate
   * @returns Array of missing variables (empty if valid)
   */
  validatePrompt(promptTemplate: PromptTemplate): string[] {
    const requiredVariables = [
      '{CHUNK_DURATION_MINUTE}',
      '{START_TIME}',
      '{END_TIME}',
      '{TRANSCRIPT_CONTENT}'
    ];

    const missingVariables: string[] = [];

    requiredVariables.forEach(variable => {
      if (!promptTemplate.template.includes(variable)) {
        missingVariables.push(variable);
      }
    });

    return missingVariables;
  }

  /**
   * Gets the default prompt (tries to load 'default.txt' first)
   * @returns The default prompt template or undefined
   */
  getDefaultPrompt(): PromptTemplate | undefined {
    return this.getPrompt('default');
  }

  /**
   * Creates a new prompt file
   * @param name The prompt name
   * @param content The prompt content
   * @param description Optional description
   * @param verbose Whether to log verbose output
   * @returns Promise resolving to success status
   */
  async createPrompt(
    name: string,
    content: string,
    description?: string,
    verbose: boolean = false
  ): Promise<boolean> {
    try {
      const fileName = `${name}.txt`;
      const filePath = path.join(this.promptsDir, fileName);

      // Add description as comment if provided
      let fileContent = content;
      if (description && !content.startsWith('#')) {
        fileContent = `# ${description}\n\n${content}`;
      }

      await fs.promises.writeFile(filePath, fileContent, 'utf-8');

      logIfEnabled(LogLevel.INFO, verbose, `Created prompt file: ${fileName}`);
      return true;

    } catch (error) {
      logIfEnabled(LogLevel.ERROR, verbose, `Failed to create prompt file: ${name}`, error);
      return false;
    }
  }

  /**
   * Checks if the prompts directory exists
   * @returns True if prompts directory exists
   */
  promptsDirectoryExists(): boolean {
    return fs.existsSync(this.promptsDir);
  }

  /**
   * Creates the prompts directory if it doesn't exist
   * @param verbose Whether to log verbose output
   * @returns Promise resolving to success status
   */
  async ensurePromptsDirectory(verbose: boolean = false): Promise<boolean> {
    try {
      if (!fs.existsSync(this.promptsDir)) {
        await fs.promises.mkdir(this.promptsDir, { recursive: true });
        logIfEnabled(LogLevel.INFO, verbose, `Created prompts directory: ${this.promptsDir}`);
      }
      return true;
    } catch (error) {
      logIfEnabled(LogLevel.ERROR, verbose, `Failed to create prompts directory: ${this.promptsDir}`, error);
      return false;
    }
  }
}