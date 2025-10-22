/**
 * Service for batch processing of multiple clips with concurrent operations
 */

import { EventEmitter } from 'events';
import { DetectedClip } from '../types';
import {
  ClipConstructionOptions,
  BatchProcessingOptions,
  ClipConstructionResult,
  BatchSummary,
  ClipConstructionProgress,
  ConstructedClip,
  FailedClip,
  ProcessingStats
} from '../types/clip-construction';
import { ClipConstructionService } from './clip-construction.service';
import { LogLevel } from '../types';
import { logIfEnabled } from '../utils/validators';
import { FileOrganizationService, ExtendedDirectoryStructure } from '../utils/file-organization';
import { FileOrganizationConfig } from '../types';

interface QueuedClip {
  clip: DetectedClip;
  sourceVideoFile: string;
  options: ClipConstructionOptions;
  priority: number;
  retryCount: number;
}

interface ProcessingJob {
  id: string;
  queuedClip: QueuedClip;
  startTime: Date;
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'retrying';
  progress?: ClipConstructionProgress;
  result?: ConstructedClip;
  error?: string;
}

export class BatchClipProcessor extends EventEmitter {
  private clipConstructionService: ClipConstructionService;
  private fileOrganizer: FileOrganizationService;
  private processingQueue: QueuedClip[] = [];
  private activeJobs: Map<string, ProcessingJob> = new Map();
  private completedJobs: ProcessingJob[] = [];
  private failedJobs: ProcessingJob[] = [];
  private isProcessing = false;
  private maxConcurrentJobs: number;
  private stats: ProcessingStats;

  constructor() {
    super();
    this.clipConstructionService = new ClipConstructionService();
    this.fileOrganizer = new FileOrganizationService();
    this.maxConcurrentJobs = 3; // Default concurrent jobs
    this.stats = {
      startTime: new Date(),
      clipsProcessed: 0,
      clipsCompleted: 0,
      clipsFailed: 0,
      totalDuration: 0,
      avgProcessingTime: 0,
      totalFileSize: 0
    };
  }

  /**
   * Processes multiple clips in batch with configurable concurrency
   * @param clips Array of clips to process
   * @param sourceVideoFile Path to source video file
   * @param options Construction options
   * @param batchOptions Batch processing options
   * @returns Promise resolving to batch processing results
   */
  async processBatch(
    clips: DetectedClip[],
    sourceVideoFile: string,
    options: ClipConstructionOptions,
    batchOptions: BatchProcessingOptions
  ): Promise<ClipConstructionResult> {
    logIfEnabled(LogLevel.INFO, options.verbose !== false, '🚀 Starting batch clip processing', {
      totalClips: clips.length,
      maxConcurrent: batchOptions.maxConcurrentClips,
      prioritizeByVirality: batchOptions.prioritizeByVirality,
      viralityThreshold: batchOptions.viralityThreshold
    });

    this.maxConcurrentJobs = batchOptions.maxConcurrentClips;
    this.stats.startTime = new Date();
    this.isProcessing = true;

    try {
      // Filter and prioritize clips
      const filteredClips = this.filterAndPrioritizeClips(clips, batchOptions);

      // Limit clips per batch if specified
      const clipsToProcess = batchOptions.maxClipsPerBatch > 0
        ? filteredClips.slice(0, batchOptions.maxClipsPerBatch)
        : filteredClips;

      logIfEnabled(LogLevel.INFO, options.verbose !== false, `📋 Processing ${clipsToProcess.length} clips (filtered from ${clips.length})`);

      // Create processing queue
      this.createProcessingQueue(clipsToProcess, sourceVideoFile, options, batchOptions);

      // Process queue with concurrency control
      await this.processQueue(batchOptions, options.verbose !== false);

      // Generate results
      const results = this.generateResults(clips, options.outputDirectory);

      this.isProcessing = false;

      logIfEnabled(LogLevel.INFO, options.verbose !== false, '✅ Batch processing completed', {
        successful: results.successful.length,
        failed: results.failed.length,
        skipped: results.skipped.length,
        totalTime: `${(this.stats.endTime!.getTime() - this.stats.startTime.getTime()) / 1000}s`
      });

      return results;

    } catch (error) {
      this.isProcessing = false;
      throw error;
    }
  }

  /**
   * Stops the current batch processing
   */
  stopProcessing(): void {
    logIfEnabled(LogLevel.INFO, true, '🛑 Stopping batch processing...');
    this.isProcessing = false;
  }

  /**
   * Gets current processing statistics
   * @returns Current processing statistics
   */
  getStats(): ProcessingStats & {
    queueLength: number;
    activeJobs: number;
    isProcessing: boolean;
  } {
    const now = new Date();
    const elapsed = now.getTime() - this.stats.startTime.getTime();
    const avgTime = this.stats.clipsProcessed > 0 ? elapsed / this.stats.clipsProcessed : 0;

    return {
      ...this.stats,
      avgProcessingTime: avgTime,
      estimatedTimeRemaining: this.processingQueue.length > 0 && avgTime > 0
        ? avgTime * (this.processingQueue.length + this.activeJobs.size)
        : undefined,
      queueLength: this.processingQueue.length,
      activeJobs: this.activeJobs.size,
      isProcessing: this.isProcessing
    };
  }

  /**
   * Filters and prioritizes clips based on batch options
   * @param clips Array of clips to filter
   * @param batchOptions Batch processing options
   * @returns Filtered and sorted array of clips
   */
  private filterAndPrioritizeClips(
    clips: DetectedClip[],
    batchOptions: BatchProcessingOptions
  ): DetectedClip[] {
    let filteredClips = [...clips];

    // Filter by virality threshold if specified
    if (batchOptions.skipLowVirality && batchOptions.viralityThreshold > 0) {
      const beforeCount = filteredClips.length;
      filteredClips = filteredClips.filter(clip =>
        clip.virality_score >= batchOptions.viralityThreshold
      );
      logIfEnabled(LogLevel.INFO, true, `📊 Filtered ${beforeCount - filteredClips.length} low-virality clips (threshold: ${batchOptions.viralityThreshold})`);
    }

    // Prioritize by virality if specified
    if (batchOptions.prioritizeByVirality) {
      filteredClips.sort((a, b) => b.virality_score - a.virality_score);
      logIfEnabled(LogLevel.INFO, true, `📈 Prioritized clips by virality score`);
    }

    return filteredClips;
  }

  /**
   * Creates processing queue from clips
   * @param clips Array of clips to queue
   * @param sourceVideoFile Path to source video
   * @param options Construction options
   * @param batchOptions Batch processing options
   */
  private createProcessingQueue(
    clips: DetectedClip[],
    sourceVideoFile: string,
    options: ClipConstructionOptions,
    batchOptions: BatchProcessingOptions
  ): void {
    this.processingQueue = clips.map((clip, index) => ({
      clip,
      sourceVideoFile,
      options,
      priority: batchOptions.prioritizeByVirality ? clip.virality_score : clips.length - index,
      retryCount: 0
    }));

    // Sort by priority (higher priority first)
    this.processingQueue.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Processes the queue with concurrency control
   * @param batchOptions Batch processing options
   * @param verbose Whether to enable verbose logging
   */
  private async processQueue(batchOptions: BatchProcessingOptions, verbose: boolean): Promise<void> {
    const promises: Promise<void>[] = [];

    while (this.isProcessing && (this.processingQueue.length > 0 || this.activeJobs.size > 0)) {
      // Start new jobs if we have capacity
      while (this.activeJobs.size < this.maxConcurrentJobs && this.processingQueue.length > 0) {
        const queuedClip = this.processingQueue.shift()!;
        const jobId = `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        const jobPromise = this.processClipJob(jobId, queuedClip, batchOptions, verbose);
        promises.push(jobPromise);
      }

      // Wait for at least one job to complete
      if (promises.length > 0) {
        await Promise.race(promises);
        // Remove completed promises
        for (let i = promises.length - 1; i >= 0; i--) {
          const promise = promises[i];
          if (await this.isPromiseSettled(promise)) {
            promises.splice(i, 1);
          }
        }
      }

      // Small delay to prevent busy waiting
      if (this.processingQueue.length > 0 && this.activeJobs.size >= this.maxConcurrentJobs) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    // Wait for remaining jobs to complete
    await Promise.all(promises);

    this.stats.endTime = new Date();
  }

  /**
   * Processes a single clip job
   * @param jobId Unique job identifier
   * @param queuedClip Queued clip to process
   * @param batchOptions Batch processing options
   * @param verbose Whether to enable verbose logging
   */
  private async processClipJob(
    jobId: string,
    queuedClip: QueuedClip,
    batchOptions: BatchProcessingOptions,
    verbose: boolean
  ): Promise<void> {
    const job: ProcessingJob = {
      id: jobId,
      queuedClip,
      startTime: new Date(),
      status: 'processing'
    };

    this.activeJobs.set(jobId, job);

    try {
      logIfEnabled(LogLevel.DEBUG, verbose, `🎬 Starting job ${jobId}`, {
        clipId: queuedClip.clip.id,
        title: queuedClip.clip.title,
        viralityScore: queuedClip.clip.virality_score
      });

      // Note: The batch processor should not create its own directory structure
      // This should be handled by the calling service
      // For now, we'll create a minimal structure to prevent errors, but this should be refactored
      const fileOrgConfig: FileOrganizationConfig = {
        baseDirectory: queuedClip.options.outputDirectory,
        mintId: queuedClip.clip.id, // Use clip ID only as last resort
        createSubdirectories: false, // Don't create subdirectories in batch processor
        directoryStructure: {
          source: 'source',
          clips: 'clips',
          metadata: 'metadata',
          assets: 'assets'
        },
        fileNaming: {
          includeMintId: false,
          includeTimestamp: false,
          includeViralityScore: false,
          separator: '_',
          mintId: queuedClip.clip.id
        }
      };

      const directoryStructure = await this.fileOrganizer.createDirectoryStructure(fileOrgConfig, queuedClip.options.verbose);

      // Process the clip
      const result = await this.clipConstructionService.constructClips(
        [queuedClip.clip],
        queuedClip.sourceVideoFile,
        queuedClip.options,
        directoryStructure,
        (progress) => {
          job.progress = progress;
          this.emit('progress', { jobId, progress });
        }
      );

      if (result.successful.length > 0) {
        job.status = 'completed';
        job.result = result.successful[0]!;
        this.completedJobs.push(job);

        this.stats.clipsCompleted++;
        if (job.result) {
          this.stats.totalDuration += job.result.duration;
          this.stats.totalFileSize += job.result.fileSize;
        }

        logIfEnabled(LogLevel.DEBUG, verbose, `✅ Completed job ${jobId}`, {
          clipId: queuedClip.clip.id,
          duration: job.result?.duration || 0,
          fileSize: job.result ? `${(job.result.fileSize / 1024 / 1024).toFixed(1)}MB` : 'Unknown'
        });

      } else if (result.failed.length > 0 && result.failed[0]) {
        throw new Error(result.failed[0].error);
      }

    } catch (error) {
      job.error = error instanceof Error ? error.message : 'Unknown error';

      // Handle retry logic
      if (batchOptions.retryFailedClips &&
          queuedClip.retryCount < batchOptions.maxRetries &&
          batchOptions.continueOnError) {

        queuedClip.retryCount++;
        job.status = 'retrying';

        logIfEnabled(LogLevel.WARN, verbose, `🔄 Retrying job ${jobId} (attempt ${queuedClip.retryCount}/${batchOptions.maxRetries})`, {
          clipId: queuedClip.clip.id,
          error: job.error
        });

        // Re-queue the clip
        this.processingQueue.unshift(queuedClip);

      } else {
        job.status = 'failed';
        this.failedJobs.push(job);
        this.stats.clipsFailed++;

        logIfEnabled(LogLevel.ERROR, verbose, `❌ Job ${jobId} failed`, {
          clipId: queuedClip.clip.id,
          error: job.error,
          retryCount: queuedClip.retryCount
        });

        // Stop processing if continueOnError is false
        if (!batchOptions.continueOnError) {
          this.isProcessing = false;
        }
      }
    } finally {
      this.stats.clipsProcessed++;
      this.activeJobs.delete(jobId);
      this.emit('jobCompleted', { jobId, job });
    }
  }

  /**
   * Generates final batch processing results
   * @param originalClips Original array of clips
   * @param outputDirectory Output directory path
   * @returns Batch processing results
   */
  private generateResults(
    originalClips: DetectedClip[],
    outputDirectory: string
  ): ClipConstructionResult {
    const successful = this.completedJobs
      .map(job => job.result)
      .filter((result): result is ConstructedClip => result !== undefined);

    const failed = this.failedJobs.map(job => ({
      id: job.queuedClip.clip.id,
      title: job.queuedClip.clip.title,
      error: job.error || 'Unknown error',
      originalClip: job.queuedClip.clip,
      retryCount: job.queuedClip.retryCount
    }));

    // Determine skipped clips (original clips that weren't processed)
    const processedClipIds = new Set([
      ...successful.map(c => c.id),
      ...failed.map(f => f.id)
    ]);
    const skipped = originalClips.filter(clip => !processedClipIds.has(clip.id));

    // Generate summary
    const endTime = this.stats.endTime || new Date();
    const summary: BatchSummary = {
      totalClips: originalClips.length,
      successful: successful.length,
      failed: failed.length,
      skipped: skipped.length,
      totalTime: endTime.getTime() - this.stats.startTime.getTime(),
      avgConstructionTime: this.stats.clipsProcessed > 0
        ? (endTime.getTime() - this.stats.startTime.getTime()) / this.stats.clipsProcessed
        : 0,
      totalFileSize: this.stats.totalFileSize,
      qualityDistribution: this.calculateQualityDistribution(successful),
      typeDistribution: this.calculateTypeDistribution(successful)
    };

    return {
      successful,
      failed,
      skipped,
      summary,
      outputDirectory
    };
  }

  /**
   * Checks if a promise is settled
   * @param promise Promise to check
   * @returns True if promise is settled
   */
  private async isPromiseSettled(promise: Promise<void> | undefined): Promise<boolean> {
    if (!promise) return true;

    const results = await Promise.allSettled([
      promise.then(() => true),
      promise.catch(() => true),
      new Promise<boolean>(resolve => setTimeout(() => resolve(false), 0))
    ]);

    return results.some(result => result.status === 'fulfilled' && result.value === true);
  }

  /**
   * Calculates quality distribution for successful clips
   * @param clips Array of successful clips
   * @returns Quality distribution object
   */
  private calculateQualityDistribution(clips: ConstructedClip[]) {
    const distribution = { high: 0, medium: 0, low: 0 };
    clips.forEach(clip => {
      const quality = clip.quality as keyof typeof distribution;
      distribution[quality]++;
    });
    return distribution;
  }

  /**
   * Calculates type distribution for successful clips
   * @param clips Array of successful clips
   * @returns Type distribution object
   */
  private calculateTypeDistribution(clips: ConstructedClip[]) {
    const distribution = { continuous: 0, spliced: 0 };
    clips.forEach(clip => {
      distribution[clip.type]++;
    });
    return distribution;
  }
}