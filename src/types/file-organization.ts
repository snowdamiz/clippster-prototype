/**
 * Type definitions for file organization and management
 */

export interface DirectoryStructure {
  base: string;
  source: string;
  clips: string;
  metadata: string;
  assets: string;
}

export interface FileManifest {
  videos: Array<{
    id: string;
    filename: string;
    path: string;
    size: number;
    duration: number;
    format: string;
    createdAt: string;
  }>;
  thumbnails: Array<{
    id: string;
    filename: string;
    path: string;
    width: number;
    height: number;
  }>;
  metadata: Array<{
    type: string;
    filename: string;
    path: string;
  }>;
}

export interface ClipProcessingManifest {
  mintId: string;
  createdAt: string;
  sourceVideo: string;
  sourceAudio?: string;
  transcription: {
    verbose: string;
    simple: string;
    clipsDetection: string;
  };
  construction: {
    options: any; // Will import from clip-construction
    results: any; // Will import from clip-construction
    summary: any; // Will import from clip-construction
  };
  fileManifest: FileManifest;
}

export interface FileOrganizationConfig {
  baseDirectory: string;
  mintId: string;
  createSubdirectories: boolean;
  directoryStructure: {
    source: string;
    clips: string;
    metadata: string;
    assets: string;
  };
  fileNaming: {
    includeMintId: boolean;
    includeTimestamp: boolean;
    includeViralityScore: boolean;
    separator: string;
    mintId: string;
  };
}

export interface OrganizationResult {
  success: boolean;
  organizedClips: any[]; // Will import ConstructedClip from clip-construction
  failedClips: any[];    // Will import FailedClip from clip-construction
  summary: {
    totalProcessed: number;
    successful: number;
    failed: number;
    outputDirectory: string;
  };
}