/**
 * Type definitions for social media platform optimization
 */

export interface PlatformOptimizationOptions {
  platform: 'tiktok' | 'youtube' | 'instagram' | 'twitter' | 'auto';
  autoCrop: boolean;
  addBranding: boolean;
  branding?: {
    logo?: string;
    text?: string;
    opacity?: number;
    position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  };
  optimizeDuration: boolean;
  addIntros: boolean;
  addOutros: boolean;
  enhanceAudio: boolean;
  stabilizeVideo: boolean;
}

export interface PlatformConstraints {
  maxDuration: number;
  aspectRatio: string;
  resolution: string;
  maxFileSize: number; // in MB
  supportedFormats: string[];
  recommendedBitrate: {
    minimum: string;
    maximum: string;
  };
}

export interface OptimizationResult {
  optimizedClip: any; // Will import ConstructedClip from clip-construction
  optimizations: string[];
  originalSize: number;
  newSize: number;
  compressionRatio: number;
}

export interface PlatformPreset {
  name: string;
  constraints: PlatformConstraints;
  optimizations: (keyof PlatformOptimizationOptions)[];
}

export type Platform = 'tiktok' | 'youtube' | 'instagram' | 'twitter';

export type BrandingPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';