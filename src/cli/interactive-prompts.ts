/**
 * Interactive CLI prompts for configuration
 */

import prompts from 'prompts';
import { CLIOptions } from '../types';
import { PromptLoader } from '../utils/prompt-loader';

/**
 * Prompts user interactively for CLI options
 * @returns CLIOptions configured by user
 */
export async function promptForOptions(): Promise<CLIOptions> {
  const options: CLIOptions = {};

  // Verbose output
  const verboseResponse = await prompts({
    type: 'confirm',
    name: 'value',
    message: 'Enable verbose output?',
    initial: false
  });
  options.verbose = verboseResponse.value;

  // Output directory
  const outputResponse = await prompts({
    type: 'text',
    name: 'value',
    message: 'Output directory:',
    initial: './downloads'
  });
  if (outputResponse.value && outputResponse.value !== './downloads') {
    options.output = outputResponse.value;
  }

  // Stream index
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

    // Generate clips only
    const generateClipsOnlyResponse = await prompts({
      type: 'confirm',
      name: 'value',
      message: 'Only generate clips from existing data (skip download)?',
      initial: false
    });
    options.generateClipsOnly = generateClipsOnlyResponse.value;

    // Always use highest quality
    options.clipQuality = 'high';

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

    // Include subtitles
    const subtitlesResponse = await prompts({
      type: 'confirm',
      name: 'value',
      message: 'Include subtitles in clips?',
      initial: false
    });
    options.includeSubtitles = subtitlesResponse.value;

    // Include thumbnails
    const thumbnailsResponse = await prompts({
      type: 'confirm',
      name: 'value',
      message: 'Generate thumbnails for clips?',
      initial: false
    });
    options.includeThumbnails = thumbnailsResponse.value;

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

    // Auto crop
    const autoCropResponse = await prompts({
      type: 'confirm',
      name: 'value',
      message: 'Auto-crop for platform aspect ratio?',
      initial: false
    });
    options.autoCrop = autoCropResponse.value;

    // Max concurrent jobs
    const concurrentResponse = await prompts({
      type: 'number',
      name: 'value',
      message: 'Maximum concurrent processing jobs (1-10):',
      initial: 3,
      min: 1,
      max: 10
    });
    if (concurrentResponse.value && concurrentResponse.value !== 3) {
      options.maxConcurrentJobs = concurrentResponse.value;
    }
  }

  return options;
}
