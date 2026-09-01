import type {
  AdaptationResult,
  DesignDocument,
  Project,
  SourceDocument,
  ValidationReport,
} from '@dae/shared';

export interface ExportRecord {
  id: string;
  projectId: string;
  adaptationPlanId: string;
  kind: string;
  format: string;
  assetId: string;
  byteSize: number;
  createdAt: string;
  /** A compare export names several devices, so values may be lists. */
  provenance: Record<string, string | string[]>;
}

/**
 * Persistence port. Two drivers implement it: a filesystem store so the app
 * runs with no external services, and Prisma/PostgreSQL for real deployments.
 * Nothing above this interface knows which one is active.
 */
export interface Repository {
  createProject(project: Project): Promise<Project>;
  getProject(id: string): Promise<Project | undefined>;
  listProjects(): Promise<Project[]>;

  /**
   * Sources are write-once. Implementations MUST reject an attempt to
   * overwrite an existing source (spec section 2).
   */
  putSource(source: SourceDocument): Promise<SourceDocument>;
  getSource(id: string): Promise<SourceDocument | undefined>;
  findSourceByHash(projectId: string, hash: string): Promise<SourceDocument | undefined>;

  putDesign(design: DesignDocument): Promise<DesignDocument>;
  getDesign(id: string): Promise<DesignDocument | undefined>;
  findDesignBySourceId(sourceId: string): Promise<DesignDocument | undefined>;

  putAdaptation(result: AdaptationResult): Promise<AdaptationResult>;
  getAdaptation(planId: string): Promise<AdaptationResult | undefined>;
  findAdaptationByCacheKey(cacheKey: string): Promise<AdaptationResult | undefined>;
  listAdaptationsForProject(projectId: string): Promise<AdaptationResult[]>;

  putValidation(report: ValidationReport): Promise<ValidationReport>;
  getValidation(id: string): Promise<ValidationReport | undefined>;
  findValidationByPlan(planId: string): Promise<ValidationReport | undefined>;

  putExport(record: ExportRecord): Promise<ExportRecord>;
  getExport(id: string): Promise<ExportRecord | undefined>;
}

export class SourceImmutableError extends Error {
  constructor(id: string) {
    super(`Source ${id} already exists and sources are immutable. Import creates a new source instead.`);
    this.name = 'SourceImmutableError';
  }
}

export const REPOSITORY = 'REPOSITORY';
