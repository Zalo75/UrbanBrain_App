export interface ConsolidationConflict {
  updateId: string;
  affectedSection: string;
  reason: string;
}

export interface SectionManifest {
  section: string;
  baseText: string;
  appliedModification: string;
  officialSource: string;
  effectiveDate: Date;
  sourceHash: string;
}

export interface ConsolidationManifest {
  familyId: string;
  targetVersionId: string;
  baseVersionId: string;
  consolidationDate: Date;
  sections: SectionManifest[];
}

export interface ConsolidatedArtifact {
  markdown: string;
  manifest: ConsolidationManifest;
  conflicts: ConsolidationConflict[];
  hash: string;
  hasConflicts: boolean;
}

export interface ConsolidationRequest {
  normativeFamilyId: string;
  targetVersionId: string;
}
