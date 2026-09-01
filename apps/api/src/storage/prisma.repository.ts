import type { PrismaClient } from '@prisma/client';
import {
  AdaptationResultSchema,
  DesignDocumentSchema,
  ProjectSchema,
  SourceDocumentSchema,
  ValidationReportSchema,
  type AdaptationResult,
  type DesignDocument,
  type Project,
  type SourceDocument,
  type ValidationReport,
} from '@dae/shared';
import { SourceImmutableError, type ExportRecord, type Repository } from './repository.js';

/**
 * PostgreSQL driver. Structured columns exist for the fields we query on;
 * the artefact itself is stored as JSON and re-validated against the shared
 * schema on read, so a schema change can never silently return a stale shape.
 */
export class PrismaRepository implements Repository {
  constructor(private readonly prisma: PrismaClient) {}

  async createProject(project: Project): Promise<Project> {
    const row = await this.prisma.project.create({
      data: {
        id: project.id,
        name: project.name,
        createdAt: new Date(project.createdAt),
        updatedAt: new Date(project.updatedAt),
      },
    });
    return ProjectSchema.parse({
      id: row.id,
      name: row.name,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    });
  }

  async getProject(id: string): Promise<Project | undefined> {
    const row = await this.prisma.project.findUnique({ where: { id } });
    if (!row) return undefined;
    return ProjectSchema.parse({
      id: row.id,
      name: row.name,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    });
  }

  async listProjects(): Promise<Project[]> {
    const rows = await this.prisma.project.findMany({ orderBy: { updatedAt: 'desc' } });
    return rows.map((row) =>
      ProjectSchema.parse({
        id: row.id,
        name: row.name,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      }),
    );
  }

  async putSource(source: SourceDocument): Promise<SourceDocument> {
    const existing = await this.prisma.source.findUnique({ where: { id: source.id } });
    if (existing) throw new SourceImmutableError(source.id);
    await this.prisma.source.create({
      data: {
        id: source.id,
        projectId: source.projectId,
        kind: source.kind,
        name: source.name,
        mimeType: source.mimeType,
        byteSize: source.byteSize,
        hash: source.hash,
        assetId: source.assetId,
        width: source.width,
        height: source.height,
        pixelWidth: source.pixelWidth ?? null,
        pixelHeight: source.pixelHeight ?? null,
        dpi: source.dpi ?? null,
        exportScale: source.exportScale,
        figmaFileKey: source.figma?.fileKey ?? null,
        figmaNodeId: source.figma?.nodeId ?? null,
        importedAt: new Date(source.importedAt),
        parserVersion: source.parserVersion,
        document: source as unknown as object,
      },
    });
    return source;
  }

  async getSource(id: string): Promise<SourceDocument | undefined> {
    const row = await this.prisma.source.findUnique({ where: { id } });
    return row ? SourceDocumentSchema.parse(row.document) : undefined;
  }

  async findSourceByHash(projectId: string, hash: string): Promise<SourceDocument | undefined> {
    const row = await this.prisma.source.findUnique({ where: { projectId_hash: { projectId, hash } } });
    return row ? SourceDocumentSchema.parse(row.document) : undefined;
  }

  async putDesign(design: DesignDocument): Promise<DesignDocument> {
    await this.prisma.design.upsert({
      where: { id: design.id },
      create: {
        id: design.id,
        sourceId: design.sourceId,
        sourceHash: design.sourceHash,
        sourceKind: design.sourceKind,
        irVersion: design.irVersion,
        parserVersion: design.parserVersion,
        createdAt: new Date(design.createdAt),
        document: design as unknown as object,
      },
      update: { document: design as unknown as object },
    });
    return design;
  }

  async getDesign(id: string): Promise<DesignDocument | undefined> {
    const row = await this.prisma.design.findUnique({ where: { id } });
    return row ? (DesignDocumentSchema.parse(row.document) as DesignDocument) : undefined;
  }

  async findDesignBySourceId(sourceId: string): Promise<DesignDocument | undefined> {
    const row = await this.prisma.design.findFirst({ where: { sourceId }, orderBy: { createdAt: 'desc' } });
    return row ? (DesignDocumentSchema.parse(row.document) as DesignDocument) : undefined;
  }

  async putAdaptation(result: AdaptationResult): Promise<AdaptationResult> {
    const { plan } = result;
    await this.prisma.adaptation.upsert({
      where: { id: plan.id },
      create: {
        id: plan.id,
        cacheKey: plan.cacheKey,
        projectId: plan.projectId,
        designId: plan.designDocumentId,
        sourceId: plan.sourceId,
        screenId: plan.screenId,
        deviceId: plan.deviceId,
        deviceCatalogVersion: plan.deviceCatalogVersion,
        engineVersion: plan.engineVersion,
        strategy: plan.strategy,
        scale: plan.scale,
        preservationScore: plan.preservation.score,
        revision: plan.revision,
        createdAt: new Date(plan.createdAt),
        result: result as unknown as object,
      },
      update: {
        revision: plan.revision,
        preservationScore: plan.preservation.score,
        result: result as unknown as object,
      },
    });
    return result;
  }

  async getAdaptation(planId: string): Promise<AdaptationResult | undefined> {
    const row = await this.prisma.adaptation.findUnique({ where: { id: planId } });
    return row ? (AdaptationResultSchema.parse(row.result) as AdaptationResult) : undefined;
  }

  async findAdaptationByCacheKey(cacheKey: string): Promise<AdaptationResult | undefined> {
    const row = await this.prisma.adaptation.findUnique({ where: { cacheKey } });
    return row ? (AdaptationResultSchema.parse(row.result) as AdaptationResult) : undefined;
  }

  async listAdaptationsForProject(projectId: string): Promise<AdaptationResult[]> {
    const rows = await this.prisma.adaptation.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' } });
    return rows.map((row) => AdaptationResultSchema.parse(row.result) as AdaptationResult);
  }

  async putValidation(report: ValidationReport): Promise<ValidationReport> {
    await this.prisma.validation.upsert({
      where: { id: report.id },
      create: {
        id: report.id,
        projectId: report.projectId,
        adaptationId: report.adaptationPlanId,
        sourceHash: report.sourceHash,
        deviceId: report.deviceId,
        status: report.status,
        criticalCount: report.criticalCount,
        warningCount: report.warningCount,
        preservationScore: report.preservationScore,
        confidence: report.confidence,
        engineVersion: report.engineVersion,
        createdAt: new Date(report.createdAt),
        report: report as unknown as object,
      },
      update: { report: report as unknown as object },
    });
    return report;
  }

  async getValidation(id: string): Promise<ValidationReport | undefined> {
    const row = await this.prisma.validation.findUnique({ where: { id } });
    return row ? (ValidationReportSchema.parse(row.report) as ValidationReport) : undefined;
  }

  async findValidationByPlan(planId: string): Promise<ValidationReport | undefined> {
    const row = await this.prisma.validation.findFirst({
      where: { adaptationId: planId },
      orderBy: { createdAt: 'desc' },
    });
    return row ? (ValidationReportSchema.parse(row.report) as ValidationReport) : undefined;
  }

  async putExport(record: ExportRecord): Promise<ExportRecord> {
    await this.prisma.export.create({
      data: {
        id: record.id,
        projectId: record.projectId,
        adaptationId: record.adaptationPlanId,
        kind: record.kind,
        format: record.format,
        assetId: record.assetId,
        byteSize: record.byteSize,
        createdAt: new Date(record.createdAt),
        provenance: record.provenance,
      },
    });
    return record;
  }

  async getExport(id: string): Promise<ExportRecord | undefined> {
    const row = await this.prisma.export.findUnique({ where: { id } });
    if (!row) return undefined;
    return {
      id: row.id,
      projectId: row.projectId,
      adaptationPlanId: row.adaptationId,
      kind: row.kind,
      format: row.format,
      assetId: row.assetId,
      byteSize: row.byteSize,
      createdAt: row.createdAt.toISOString(),
      provenance: row.provenance as Record<string, string>,
    };
  }
}
