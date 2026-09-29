-- The public feed distinguishes recommended/rejected works from sanctioned
-- works. Preserve legacy LAPSED while accepting every value produced by the
-- real-feed importer.
ALTER TABLE works DROP CONSTRAINT IF EXISTS works_status_check;
ALTER TABLE works ADD CONSTRAINT works_status_check
    CHECK (status IN (
        'RECOMMENDED', 'SANCTIONED', 'IN_PROGRESS', 'COMPLETED',
        'LAPSED', 'CANCELLED', 'REJECTED'
    ));
