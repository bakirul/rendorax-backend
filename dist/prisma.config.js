"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const config_1 = require("@prisma/config");
require("dotenv/config");
// Prisma 7: CLI commands (db push, migrate, introspect) read datasource.url
// from prisma.config.ts only — directUrl was removed. Use the direct connection
// here; runtime app traffic stays on the pooled DATABASE_URL via the pg adapter.
if (!process.env.DIRECT_URL) {
    throw new Error("DIRECT_URL is not set. Add the direct Supabase connection (port 5432) to rendorax-backend/.env.");
}
if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set. Add the pooled Supabase connection (port 6543) to rendorax-backend/.env.");
}
const legacyPublicTables = [
    "public.client_invoices",
    "public.project_status",
    "public.project_status_details",
    "public.user_roles",
    "public.video_comments",
    "public.video_metadata",
];
const supabaseAuthTables = [
    "auth.audit_log_entries",
    "auth.custom_oauth_providers",
    "auth.flow_state",
    "auth.identities",
    "auth.instances",
    "auth.mfa_amr_claims",
    "auth.mfa_challenges",
    "auth.mfa_factors",
    "auth.oauth_authorizations",
    "auth.oauth_client_states",
    "auth.oauth_clients",
    "auth.oauth_consents",
    "auth.one_time_tokens",
    "auth.refresh_tokens",
    "auth.saml_providers",
    "auth.saml_relay_states",
    "auth.schema_migrations",
    "auth.sessions",
    "auth.sso_domains",
    "auth.sso_providers",
    "auth.users",
    "auth.webauthn_challenges",
    "auth.webauthn_credentials",
];
const supabaseAuthEnums = [
    "auth.aal_level",
    "auth.code_challenge_method",
    "auth.factor_status",
    "auth.factor_type",
    "auth.oauth_authorization_status",
    "auth.oauth_client_type",
    "auth.oauth_registration_type",
    "auth.oauth_response_type",
    "auth.one_time_token_type",
];
exports.default = (0, config_1.defineConfig)({
    schema: "prisma/schema.prisma",
    datasource: {
        url: (0, config_1.env)("DIRECT_URL"),
    },
    experimental: {
        externalTables: true,
    },
    tables: {
        external: [...legacyPublicTables, ...supabaseAuthTables],
    },
    enums: {
        external: [...supabaseAuthEnums],
    },
});
