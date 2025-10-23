/**
 * Utility for calculating optimal concurrency settings
 */

import * as os from 'os';

/**
 * Calculates the optimal number of concurrent jobs based on system resources
 * @param clipCount Number of clips to process
 * @param quality Quality setting (affects resource usage)
 * @returns Optimal number of concurrent jobs
 */
export function calculateOptimalConcurrency(
  clipCount: number,
  quality: 'high' | 'medium' | 'low' = 'medium'
): number {
  // Get system resources
  const cpuCount = os.cpus().length;
  const totalMemoryGB = os.totalmem() / (1024 ** 3);
  const freeMemoryGB = os.freemem() / (1024 ** 3);
  
  // Base concurrency on CPU count
  // Video processing is CPU-intensive, so we use CPU count as primary factor
  let optimalConcurrency: number;
  
  if (cpuCount <= 4) {
    // Low-end systems: 1-2 jobs
    optimalConcurrency = Math.max(1, Math.floor(cpuCount / 2));
  } else if (cpuCount <= 8) {
    // Mid-range systems: 2-4 jobs
    optimalConcurrency = Math.max(2, Math.floor(cpuCount / 2));
  } else if (cpuCount <= 16) {
    // High-end systems: 4-6 jobs
    optimalConcurrency = Math.min(6, Math.max(4, Math.floor(cpuCount * 0.4)));
  } else {
    // Very high-end systems: 6-8 jobs
    optimalConcurrency = Math.min(8, Math.max(6, Math.floor(cpuCount * 0.35)));
  }
  
  // Adjust based on quality setting (higher quality = more resources per job)
  if (quality === 'high') {
    optimalConcurrency = Math.max(1, Math.floor(optimalConcurrency * 0.75));
  } else if (quality === 'low') {
    optimalConcurrency = Math.min(10, Math.ceil(optimalConcurrency * 1.25));
  }
  
  // Memory constraint check
  // Assume each job needs roughly 1-2GB of memory for video processing
  const memoryPerJobGB = quality === 'high' ? 2 : quality === 'medium' ? 1.5 : 1;
  const maxJobsByMemory = Math.floor(freeMemoryGB * 0.7 / memoryPerJobGB);
  
  // Don't exceed what memory allows
  if (maxJobsByMemory < optimalConcurrency) {
    optimalConcurrency = Math.max(1, maxJobsByMemory);
  }
  
  // Don't exceed the number of clips
  optimalConcurrency = Math.min(optimalConcurrency, clipCount);
  
  // Safety bounds: at least 1, at most 10
  optimalConcurrency = Math.max(1, Math.min(10, optimalConcurrency));
  
  return optimalConcurrency;
}

/**
 * Gets system resource information for logging
 * @returns Object with system resource details
 */
export function getSystemResourceInfo() {
  const cpuCount = os.cpus().length;
  const totalMemoryGB = (os.totalmem() / (1024 ** 3)).toFixed(2);
  const freeMemoryGB = (os.freemem() / (1024 ** 3)).toFixed(2);
  const platform = os.platform();
  const arch = os.arch();
  
  return {
    cpuCount,
    totalMemoryGB: `${totalMemoryGB} GB`,
    freeMemoryGB: `${freeMemoryGB} GB`,
    platform,
    arch
  };
}
