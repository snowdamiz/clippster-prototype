/**
 * Interactive CLI prompts for configuration
 */

import prompts from 'prompts';
import * as fs from 'fs';
import * as path from 'path';
import { CLIOptions } from '../types';
import { PromptLoader } from '../utils/prompt-loader';

/**
 * Prompts user to select a video file from the downloads folder
 * @param downloadsDir The downloads directory to search
 * @returns Selected video file path or null if none selected
 */
export async function promptForVideoFile(downloadsDir: string = './downloads'): Promise<string | null> {
  // Check if downloads directory exists
  if (!fs.existsSync(downloadsDir)) {
    console.error(`Downloads directory not found: ${downloadsDir}`);
    return null;
  }

  // Find all .mp4 files in downloads folder
  const mp4Files: string[] = [];
  
  const scanDirectory = (dir: string) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scanDirectory(fullPath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.mp4')) {
        mp4Files.push(fullPath);
      }
    }
  };

  scanDirectory(downloadsDir);

  if (mp4Files.length === 0) {
    console.error('No .mp4 files found in downloads folder.');
    return null;
  }

  // Create choices for the prompt
  const choices = mp4Files.map(filePath => {
    const relativePath = path.relative(downloadsDir, filePath);
    const stats = fs.statSync(filePath);
    const sizeMB = (stats.size / 1024 / 1024).toFixed(1);
    return {
      title: `${relativePath} (${sizeMB} MB)`,
      value: filePath
    };
  });

  const response = await prompts({
    type: 'select',
    name: 'value',
    message: 'Select a video file to process:',
    choices: choices
  });

  return response.value || null;
}

/**
 * Prompts user interactively for CLI options
 * @param includeStreamIndex Whether to include stream index prompt (only for Mode A)
 * @returns CLIOptions configured by user
 */
export async function promptForOptions(includeStreamIndex: boolean = true): Promise<CLIOptions> {
  const options: CLIOptions = {};

  // Verbose output
  const verboseResponse = await prompts({
    type: 'confirm',
    name: 'value',
    message: 'Enable verbose output?',
    initial: false
  });
  options.verbose = verboseResponse.value;

  // Output directory (only show in Mode A, Mode B already selected the file)
  if (includeStreamIndex) {
    const outputResponse = await prompts({
      type: 'text',
      name: 'value',
      message: 'Output directory:',
      initial: './downloads'
    });
    if (outputResponse.value && outputResponse.value !== './downloads') {
      options.output = outputResponse.value;
    }

    // Stream index (only for Mode A - downloading from mint ID)
    const indexResponse = await prompts({
      type: 'number',
      name: 'value',
      message: 'Stream index (1=newest, 2=second newest, etc.):',
      initial: 1,
      min: 1
    });
    if (indexResponse.value && indexResponse.value > 1) {
      options.index = indexResponse.value;
    }
  }

  // AI clip detection settings (always enabled)
  {
    // Load available prompts
    const promptLoader = new PromptLoader('./prompts');
    await promptLoader.loadPrompts(false);
    const availablePrompts = promptLoader.getPromptList();

    if (availablePrompts.length > 0) {
      const promptChoices = availablePrompts.map(p => ({
        title: p.description ? `${p.name} - ${p.description}` : p.name,
        value: p.name
      }));

      const promptResponse = await prompts({
        type: 'select',
        name: 'value',
        message: 'Select prompt for clip detection:',
        choices: promptChoices,
        initial: promptChoices.findIndex(c => c.value === 'default')
      });
      
      if (promptResponse.value && promptResponse.value !== 'default') {
        options.prompt = promptResponse.value;
      }
    } else {
      console.warn('Warning: No prompts found in ./prompts directory. Using default.');
    }

    // Clip format
    const formatResponse = await prompts({
      type: 'select',
      name: 'value',
      message: 'Clip format:',
      choices: [
        { title: 'MP4', value: 'mp4' },
        { title: 'MOV', value: 'mov' },
        { title: 'WebM', value: 'webm' }
      ],
      initial: 0
    });
    options.clipFormat = formatResponse.value;

    // Virality threshold
    const viralityResponse = await prompts({
      type: 'number',
      name: 'value',
      message: 'Minimum virality score (0-100):',
      initial: 0,
      min: 0,
      max: 100
    });
    if (viralityResponse.value && viralityResponse.value > 0) {
      options.viralityThreshold = viralityResponse.value;
    }

    // Always generate thumbnails
    options.includeThumbnails = true;

    // Platform optimization
    const platformResponse = await prompts({
      type: 'select',
      name: 'value',
      message: 'Optimize for platform:',
      choices: [
        { title: 'Auto', value: 'auto' },
        { title: 'TikTok', value: 'tiktok' },
        { title: 'YouTube', value: 'youtube' },
        { title: 'Instagram', value: 'instagram' },
        { title: 'Twitter', value: 'twitter' }
      ],
      initial: 0
    });
    options.optimizeForPlatform = platformResponse.value;

    // Always enable auto-crop
    options.autoCrop = true;

    // Max concurrent jobs will be calculated intelligently
    // No need to set it here

    // Subtitle configuration
    const subtitlesEnabled = await prompts({
      type: 'confirm',
      name: 'value',
      message: 'Add word-by-word subtitles to clips?',
      initial: false
    });

    if (subtitlesEnabled.value) {
      // Subtitle style
      const subtitleStyle = await prompts({
        type: 'select',
        name: 'value',
        message: 'Subtitle style:',
        choices: [
          { title: 'TikTok (Bold, yellow highlight, centered)', value: 'tiktok' },
          { title: 'YouTube (White text, black bar, bottom)', value: 'youtube' },
          { title: 'Minimal (Simple white text with shadow)', value: 'minimal' }
        ],
        initial: 0
      });

      // Subtitle position
      const subtitlePosition = await prompts({
        type: 'select',
        name: 'value',
        message: 'Subtitle position:',
        choices: [
          { title: 'Top', value: 'top' },
          { title: 'Center', value: 'center' },
          { title: 'Bottom', value: 'bottom' }
        ],
        initial: 2 // Bottom by default
      });

      // Words per phrase
      const wordsPerPhrase = await prompts({
        type: 'number',
        name: 'value',
        message: 'Maximum words per subtitle (4-7 recommended):',
        initial: 6,
        min: 3,
        max: 10
      });

      options.subtitles = {
        enabled: true,
        style: subtitleStyle.value,
        position: subtitlePosition.value,
        minWordsPerPhrase: 4,
        maxWordsPerPhrase: wordsPerPhrase.value || 7
      };
    } else {
      options.subtitles = { 
        enabled: false,
        style: 'minimal',
        minWordsPerPhrase: 4,
        maxWordsPerPhrase: 7,
        position: 'bottom'
      };
    }
  }

  return options;
}
