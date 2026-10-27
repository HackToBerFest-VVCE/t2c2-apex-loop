// Shared report store (Neon Postgres over HTTP). Only the server talks to it; the admin page reads
// it through /api/admin/reports, which checks the signed-in Google account first.
import { neon } from '@neondatabase/serverless';

export const dbConfigured = () => Boolean(process.env.DATABASE_URL);

let sql;
let ready;

/** Returns the SQL tag, creating the table on first use. */
export async function db() {
  sql ??= neon(process.env.DATABASE_URL);
  ready ??= (async () => {
    await sql`
      CREATE TABLE IF NOT EXISTS reports (
        id             text PRIMARY KEY,
        created_at     timestamptz NOT NULL DEFAULT now(),
        reporter_email text,
        reporter_name  text,
        issue_type     text NOT NULL,
        severity       text NOT NULL,
        department     text NOT NULL,
        authority      text,
        is_civic       boolean NOT NULL DEFAULT true,
        description    text,
        description_kn text,
        location       text,
        lat            double precision,
        lon            double precision,
        accuracy_m     double precision,
        coords_source  text,
        thumb          text,
        status         text NOT NULL DEFAULT 'Drafted',
        sent_at        timestamptz
      )`;
    await sql`CREATE INDEX IF NOT EXISTS reports_created_at ON reports (created_at DESC)`;
    // Drafts used to be logged; only sent complaints are kept now, so clear any old drafts.
    await sql`DELETE FROM reports WHERE status = 'Drafted'`;

    // De-duplication: people who report the same spot "support" the existing complaint instead.
    await sql`ALTER TABLE reports ADD COLUMN IF NOT EXISTS supporters int NOT NULL DEFAULT 1`;
    await sql`ALTER TABLE reports ADD COLUMN IF NOT EXISTS escalated_at int NOT NULL DEFAULT 1`;
    await sql`ALTER TABLE reports ADD COLUMN IF NOT EXISTS resolved_at timestamptz`;
    await sql`
      CREATE TABLE IF NOT EXISTS report_supports (
        id             bigserial PRIMARY KEY,
        report_id      text NOT NULL REFERENCES reports (id) ON DELETE CASCADE,
        created_at     timestamptz NOT NULL DEFAULT now(),
        reporter_email text,
        reporter_name  text,
        thumb          text,
        lat            double precision,
        lon            double precision,
        accuracy_m     double precision
      )`;
    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS report_supports_once
      ON report_supports (report_id, reporter_email) WHERE reporter_email IS NOT NULL`;
    await sql`CREATE INDEX IF NOT EXISTS reports_open_by_dept ON reports (department, lat) WHERE status = 'Sent'`;

    // WhatsApp bot: reporters identified by phone number, each chat's progress, and processed message ids
    // (WhatsApp may deliver the same message twice).
    await sql`ALTER TABLE reports ADD COLUMN IF NOT EXISTS reporter_phone text`;
    await sql`ALTER TABLE report_supports ADD COLUMN IF NOT EXISTS reporter_phone text`;
    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS report_supports_once_phone
      ON report_supports (report_id, reporter_phone) WHERE reporter_phone IS NOT NULL`;
    await sql`
      CREATE TABLE IF NOT EXISTS whatsapp_chats (
        phone      text PRIMARY KEY,
        step       text NOT NULL,
        draft      jsonb,
        updated_at timestamptz NOT NULL DEFAULT now()
      )`;
    await sql`
      CREATE TABLE IF NOT EXISTS whatsapp_seen (
        message_id text PRIMARY KEY,
        seen_at    timestamptz NOT NULL DEFAULT now()
      )`;
    // Small key/value store, e.g. the admin's encrypted Gmail sign-in that the bot sends from.
    await sql`
      CREATE TABLE IF NOT EXISTS settings (
        key   text PRIMARY KEY,
        value text NOT NULL
      )`;
  })().catch((err) => {
    ready = null; // let the next request retry
    throw err;
  });
  await ready;
  return sql;
}
