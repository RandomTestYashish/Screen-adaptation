import { mkdir, readFile, readdir, writeFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, resolve } from 'node:path';
import type {
  AdaptationResult,
  DesignDocument,
  Project,
  SourceDocument,
  ValidationReport,
} from '@dae/shared';
import { SourceImmutableError, type ExportRecord, type Repository } from './repository.js';

type Collection = 'projects' | 'sources' | 'designs' | 'adaptations' | 'validations' | 'exports';

/**
 * JSON-file persistence under DATA_DIR.
 *
 * This is the default driver so `pnpm dev` works with no database. It is
 * deliberately simple: one file per record, atomic-enough writes, and an
 * in-memory index rebuilt on demand.
 */
export class FilesystemRepository implements Repository {
  constructor(private readonly root: string) {}

  private dir(collection: Collection): string {
    return resolve(this.root, collection);
  }

  private async ensure(collection: Collection): Promise<string> {
    const dir = this.dir(collection);
    await mkdir(dir, { recursive: true });
    return dir;
  }

  private async write<T>(collection: Collection, id: string, value: T): Promise<T> {
    const dir = await this.ensure(collection);
    // Write to a temp file then rename, so a crash can never leave a half-written record.
    const target = join(dir, `${id}.json`);
    const temp = `${target}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(value, null, 2), 'utf8');
    const { rename } = await import('node:fs/promises');
    await rename(temp, target);
    return value;
  }

  private async read<T>(collection: Collection, id: string): Promise<T | undefined> {
    try {
      const raw = await readFile(join(this.dir(collection), `${id}.json`), 'utf8');
      return JSON.parse(raw) as T;
    } catch {
      return undefined;
    }
  }

  private async all<T>(collection: Collection): Promise<T[]> {
    try {
      const dir = await this.ensure(collection);
      const files = await readdir(dir);
      const records = await Promise.all(
        files.filter((f) => f.endsWith('.json')).map((f) => readFile(join(dir, f), 'utf8')),
      );
      return records.map((r) => JSON.parse(r) as T);
    } catch {
      return [];
    }
  }

  private async exists(collection: Collection, id: string): Promise<boolean> {
    try {
      await access(join(this.dir(collection), `${id}.json`), constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  createProject(project: Project) { return this.write('projects', project.id, project); }
  getProject(id: string) { return this.read<Project>('projects', id); }
  listProjects() { return this.all<Project>('projects'); }

  async putSource(source: SourceDocument): Promise<SourceDocument> {
    if (await this.exists('sources', source.id)) throw new SourceImmutableError(source.id);
    return this.write('sources', source.id, source);
  }
  getSource(id: string) { return this.read<SourceDocument>('sources', id); }
  async findSourceByHash(projectId: string, hash: string) {
    const all = await this.all<SourceDocument>('sources');
    return all.find((s) => s.projectId === projectId && s.hash === hash);
  }

  putDesign(design: DesignDocument) { return this.write('designs', design.id, design); }
  getDesign(id: string) { return this.read<DesignDocument>('designs', id); }
  async findDesignBySourceId(sourceId: string) {
    const all = await this.all<DesignDocument>('designs');
    return all
      .filter((d) => d.sourceId === sourceId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  }

  putAdaptation(result: AdaptationResult) { return this.write('adaptations', result.plan.id, result); }
  getAdaptation(planId: string) { return this.read<AdaptationResult>('adaptations', planId); }
  async findAdaptationByCacheKey(cacheKey: string) {
    const all = await this.all<AdaptationResult>('adaptations');
    return all.find((a) => a.plan.cacheKey === cacheKey);
  }
  async listAdaptationsForProject(projectId: string) {
    const all = await this.all<AdaptationResult>('adaptations');
    return all.filter((a) => a.plan.projectId === projectId);
  }

  putValidation(report: ValidationReport) { return this.write('validations', report.id, report); }
  getValidation(id: string) { return this.read<ValidationReport>('validations', id); }
  async findValidationByPlan(planId: string) {
    const all = await this.all<ValidationReport>('validations');
    return all
      .filter((r) => r.adaptationPlanId === planId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  }

  putExport(record: ExportRecord) { return this.write('exports', record.id, record); }
  getExport(id: string) { return this.read<ExportRecord>('exports', id); }
}
