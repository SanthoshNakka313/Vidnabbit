-- Takedown requests and the rights-holder blocklist (docs/02 section 3.3, ADR-006).
-- Requests hold personal data and are purged after TAKEDOWN_RETENTION_DAYS;
-- blocklist entries outlive them (takedown_id becomes NULL).

CREATE TYPE takedown_status AS ENUM
    ('received', 'under_review', 'actioned', 'rejected', 'withdrawn');
CREATE TYPE blocklist_kind AS ENUM ('canonical_url', 'site_media_id', 'domain');

CREATE TABLE takedown_requests (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    received_at          timestamptz NOT NULL DEFAULT now(),
    name                 text NOT NULL,
    email                text NOT NULL,
    organisation         text,
    urls                 jsonb NOT NULL,
    statement_good_faith boolean NOT NULL,
    statement_accuracy   boolean NOT NULL,
    signature            text NOT NULL,
    status               takedown_status NOT NULL DEFAULT 'received',
    reviewer_notes       text,
    decided_at           timestamptz
);
CREATE INDEX takedown_requests_received_at ON takedown_requests (received_at);
CREATE INDEX takedown_requests_open ON takedown_requests (received_at)
    WHERE status IN ('received', 'under_review');

CREATE TABLE blocklist_entries (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kind        blocklist_kind NOT NULL,
    site        text,  -- yt-dlp extractor key, lowercased; only for site_media_id
    value       text NOT NULL,  -- canonical URL | media id | domain
    takedown_id uuid REFERENCES takedown_requests (id) ON DELETE SET NULL,
    reason      text NOT NULL CHECK (reason IN ('dmca', 'domain_exclusion', 'operator')),
    active      boolean NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now(),
    created_by  text NOT NULL,
    revoked_at  timestamptz,
    revoked_by  text,
    CONSTRAINT blocklist_entries_unique UNIQUE NULLS NOT DISTINCT (kind, site, value),
    CONSTRAINT blocklist_entries_site CHECK ((kind = 'site_media_id') = (site IS NOT NULL))
);
CREATE INDEX blocklist_entries_takedown ON blocklist_entries (takedown_id);
