import { pgTable, uuid, text, timestamp, jsonb, boolean, customType, pgEnum, index } from "drizzle-orm/pg-core";

// Custom type para PostGIS geometry (Point)
const geometry = customType<{ data: [number, number]; driverData: string }>({
  dataType() {
    return 'geometry(Point, 4326)';
  },
  toDriver(value) {
    return `SRID=4326;POINT(${value[0]} ${value[1]})`;
  },
  fromDriver(value) {
    // Implementación básica para V1, parsear string WKT a [lon, lat] si es necesario
    return value as unknown as [number, number];
  },
});

export const roleEnum = pgEnum("role", ["owner", "admin", "member", "viewer"]);
export const messageRoleEnum = pgEnum("message_role", ["user", "assistant", "system", "tool"]);
export const verificationStatusEnum = pgEnum("verification_status", ["pending", "verified", "rejected"]);
export const accountTypeEnum = pgEnum("account_type", ["independent_professional", "studio_company", "public_administration", "real_estate_developer", "other"]);
export const landClassEnum = pgEnum("land_class", ["desconocido", "urbano_consolidado", "urbano_no_consolidado", "urbanizable", "rustico_no_urbanizable", "nucleo_rural"]);
export const actionTypeEnum = pgEnum("action_type", ["consulta_urbanistica", "vivienda_unifamiliar", "reforma", "segregacion", "cambio_de_uso", "nave", "legalizacion", "demolicion", "parcelacion", "informe_urbanistico", "otro"]);
export const locationSourceEnum = pgEnum("location_source", ["cadastral_reference", "address", "coordinates", "planning_area", "manual"]);
export const normativeScopeEnum = pgEnum("normative_scope", ["estatal", "autonomico", "provincial", "municipal", "sectorial"]);
export const normativeSourceEnum = pgEnum("normative_source", ["SIOTUGA", "CTE", "NHG", "sectorial", "manual"]);

export const organizations = pgTable("organizations", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").unique().notNull(),
  plan: text("plan").default("freemium").notNull(),
  accountType: accountTypeEnum("account_type").default("independent_professional").notNull(),
  contactName: text("contact_name"),
  phone: text("phone"),
  province: text("province"),
  verificationStatus: verificationStatusEnum("verification_status").default("pending").notNull(),
  verifiedAt: timestamp("verified_at"),
  verifiedBy: uuid("verified_by"), // Could reference profiles.id, but let's keep it simple for now
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey(), // Mapped from Auth Provider (e.g., Supabase auth.users)
  fullName: text("full_name"),
  avatarUrl: text("avatar_url"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const organizationMembers = pgTable("organization_members", {
  orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  profileId: uuid("profile_id").references(() => profiles.id, { onDelete: "cascade" }).notNull(),
  role: roleEnum("role").default("member").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const expedientes = pgTable("expedientes", {
  id: uuid("id").defaultRandom().primaryKey(),
  orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),
  province: text("province"),
  municipio: text("municipio").notNull(),
  address: text("address"),
  location: geometry("location"),
  lat: customType<{ data: number; driverData: string | number }>({ dataType() { return 'double precision' } })("lat"),
  lng: customType<{ data: number; driverData: string | number }>({ dataType() { return 'double precision' } })("lng"),
  refCatastral: text("ref_catastral"),
  urbanPlanningZone: text("urban_planning_zone"),
  landClass: landClassEnum("land_class"),
  actionType: actionTypeEnum("action_type"),
  locationSource: locationSourceEnum("location_source"),
  notes: text("notes"),
  status: text("status").default("active").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const conversations = pgTable("conversations", {
  id: uuid("id").defaultRandom().primaryKey(),
  expedienteId: uuid("expediente_id").references(() => expedientes.id, { onDelete: "cascade" }).notNull(),
  createdBy: uuid("created_by").references(() => profiles.id).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const messages = pgTable("messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "cascade" }).notNull(),
  role: messageRoleEnum("role").notNull(),
  content: text("content").notNull(),
  structuredResponse: jsonb("structured_response"),
  countedAsUsage: boolean("counted_as_usage").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const messageSources = pgTable("message_sources", {
  id: uuid("id").defaultRandom().primaryKey(),
  messageId: uuid("message_id").references(() => messages.id, { onDelete: "cascade" }).notNull(),
  documentRef: text("document_ref").notNull(),
  excerpt: text("excerpt").notNull(),
});

export const documentTypeEnum = pgEnum("document_type", ["planeamiento", "normativa", "catalogo", "ficha", "informe", "consulta", "otros"]);

export const documents = pgTable("documents", {
  id: uuid("id").defaultRandom().primaryKey(),
  expedienteId: uuid("expediente_id").references(() => expedientes.id, { onDelete: "cascade" }).notNull(),
  filename: text("filename").notNull(),
  storagePath: text("storage_path").notNull(),
  documentType: documentTypeEnum("document_type").notNull(),
  uploadedBy: uuid("uploaded_by").references(() => profiles.id).notNull(),
  uploadedAt: timestamp("uploaded_at").defaultNow().notNull(),
  processed: boolean("processed").default(false).notNull(),
  chunked: boolean("chunked").default(false).notNull(),
  embedded: boolean("embedded").default(false).notNull(),
});

// Custom type para vector(3072) de pgvector
const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return 'vector(3072)';
  },
  toDriver(value) {
    return `[${value.join(',')}]`;
  },
  fromDriver(value) {
    return JSON.parse(value as string);
  },
});

export const documentChunks = pgTable("document_chunks", {
  id: uuid("id").defaultRandom().primaryKey(),
  documentId: uuid("document_id").references(() => documents.id, { onDelete: "cascade" }).notNull(),
  expedienteId: uuid("expediente_id").references(() => expedientes.id, { onDelete: "cascade" }).notNull(),
  content: text("content").notNull(),
  pageNumber: customType<{ data: number; driverData: number }>({ dataType() { return 'integer' } })("page_number"),
  metadata: jsonb("metadata"),
  embedding: vector("embedding"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const normativaDocuments = pgTable("normativa_documents", {
  id: uuid("id").defaultRandom().primaryKey(),
  sourceId: text("source_id").unique(), // sha256
  title: text("title").notNull(),
  originalPath: text("original_path"),
  scopeType: normativeScopeEnum("scope_type").notNull(),
  ccaa: text("ccaa"),
  province: text("province"),
  municipalityId: text("municipality_id"), // ine_code o código interno
  municipalityName: text("municipality_name"),
  documentType: text("document_type"),
  sourceSystem: normativeSourceEnum("source_system").default("manual").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => {
  return {
    scopeIdx: index("normativa_scope_idx").on(table.scopeType),
    municipalityIdx: index("normativa_muni_idx").on(table.municipalityId),
    ccaaIdx: index("normativa_ccaa_idx").on(table.ccaa),
    sourceSystemIdx: index("normativa_source_system_idx").on(table.sourceSystem),
  };
});

export const normativaChunks = pgTable("normativa_chunks", {
  id: uuid("id").defaultRandom().primaryKey(),
  normativaDocumentId: uuid("normativa_document_id").references(() => normativaDocuments.id, { onDelete: "cascade" }).notNull(),
  content: text("content").notNull(),
  metadata: jsonb("metadata"),
  embedding: vector("embedding"), // Usa el customType de vector(3072) existente
  chunkIndex: customType<{ data: number; driverData: number }>({ dataType() { return 'integer' } })("chunk_index"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => {
  return {
    embeddingIdx: index("normativa_embedding_idx").using("hnsw", table.embedding.op("vector_cosine_ops")),
  };
});
