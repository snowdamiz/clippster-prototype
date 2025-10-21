declare module '@120356aa/pumpfun-wrapper' {
  export class PumpFunClient {
    constructor();
    getCompleteStreams(mintId: string, limit?: number): Promise<{ clips: any[], hasMore: boolean }>;
    getHighlightClips(mintId: string, limit?: number): Promise<{ clips: any[], hasMore: boolean }>;
    getStreamClips(mintId: string, options?: {
      limit?: number;
      clipType?: 'COMPLETE' | 'HIGHLIGHT';
    }): Promise<{ clips: any[], hasMore: boolean }>;
    downloadHighlightClip(clip: any, outputPath: string, options?: {
      onProgress?: (progress: number, downloaded: number, total: number) => void;
    }): Promise<void>;
    downloadHighlightClips(clips: any[], outputDir: string, options?: {
      concurrency?: number;
      filenameGenerator?: (clip: any, index: number) => string;
    }): Promise<any[]>;
  }
}