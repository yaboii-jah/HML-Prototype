export type ArchiveProgress = { phase: "preparing" | "uploading" | "complete"; label?: string; loaded?: number; total?: number; fileIndex?: number; fileCount?: number };
export type ArchiveProgressListener = (progress: ArchiveProgress) => void;
