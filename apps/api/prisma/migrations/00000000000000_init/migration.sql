-- Initial schema for the Device Adaptation Engine.
--
-- Generated with:
--   pnpm --filter @dae/api exec prisma migrate diff \
--     --from-empty --to-schema-datamodel prisma/schema.prisma --script
--
-- Apply with `pnpm db:migrate` (prisma migrate deploy). This migration is only
-- needed for STORAGE_DRIVER=postgres; the default filesystem driver requires
-- no database at all.

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sources" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "hash" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "width" DOUBLE PRECISION NOT NULL,
    "height" DOUBLE PRECISION NOT NULL,
    "pixelWidth" INTEGER,
    "pixelHeight" INTEGER,
    "dpi" DOUBLE PRECISION,
    "exportScale" DOUBLE PRECISION NOT NULL,
    "figmaFileKey" TEXT,
    "figmaNodeId" TEXT,
    "importedAt" TIMESTAMP(3) NOT NULL,
    "parserVersion" TEXT NOT NULL,
    "document" JSONB NOT NULL,

    CONSTRAINT "sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "designs" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "sourceKind" TEXT NOT NULL,
    "irVersion" TEXT NOT NULL,
    "parserVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "document" JSONB NOT NULL,

    CONSTRAINT "designs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "adaptations" (
    "id" TEXT NOT NULL,
    "cacheKey" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "designId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "screenId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "deviceCatalogVersion" TEXT NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "strategy" TEXT NOT NULL,
    "scale" DOUBLE PRECISION NOT NULL,
    "preservationScore" DOUBLE PRECISION NOT NULL,
    "revision" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "result" JSONB NOT NULL,

    CONSTRAINT "adaptations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "validations" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "adaptationId" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "criticalCount" INTEGER NOT NULL,
    "warningCount" INTEGER NOT NULL,
    "preservationScore" DOUBLE PRECISION NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "report" JSONB NOT NULL,

    CONSTRAINT "validations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exports" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "adaptationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "provenance" JSONB NOT NULL,

    CONSTRAINT "exports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_catalog_versions" (
    "catalogVersion" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL,
    "deviceCount" INTEGER NOT NULL,
    "catalog" JSONB NOT NULL,

    CONSTRAINT "device_catalog_versions_pkey" PRIMARY KEY ("catalogVersion")
);

-- CreateIndex
CREATE INDEX "sources_projectId_idx" ON "sources"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "sources_projectId_hash_key" ON "sources"("projectId", "hash");

-- CreateIndex
CREATE INDEX "designs_sourceId_idx" ON "designs"("sourceId");

-- CreateIndex
CREATE INDEX "adaptations_projectId_deviceId_idx" ON "adaptations"("projectId", "deviceId");

-- CreateIndex
CREATE UNIQUE INDEX "adaptations_cacheKey_key" ON "adaptations"("cacheKey");

-- CreateIndex
CREATE INDEX "validations_adaptationId_idx" ON "validations"("adaptationId");

-- CreateIndex
CREATE INDEX "exports_projectId_idx" ON "exports"("projectId");

-- AddForeignKey
ALTER TABLE "sources" ADD CONSTRAINT "sources_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "designs" ADD CONSTRAINT "designs_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adaptations" ADD CONSTRAINT "adaptations_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adaptations" ADD CONSTRAINT "adaptations_designId_fkey" FOREIGN KEY ("designId") REFERENCES "designs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "validations" ADD CONSTRAINT "validations_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "validations" ADD CONSTRAINT "validations_adaptationId_fkey" FOREIGN KEY ("adaptationId") REFERENCES "adaptations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exports" ADD CONSTRAINT "exports_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exports" ADD CONSTRAINT "exports_adaptationId_fkey" FOREIGN KEY ("adaptationId") REFERENCES "adaptations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

