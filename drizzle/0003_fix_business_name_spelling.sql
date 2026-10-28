-- The business is "Sweets by Shyee". Earlier versions saved the misspelling "Sweets by Shee" into site settings
-- (business name and homepage headline), and saved values override the code's default. Correct it wherever it
-- appears in the settings document. The domain (sweetsbyshee.com) has no spaces, so it isn't matched; "Shyee"
-- doesn't contain "Shee", so running this again changes nothing.
UPDATE "settings"
SET "value" = regexp_replace("value"::text, 'Sweets by Shee\M', 'Sweets by Shyee', 'g')::jsonb,
    "updated_at" = now()
WHERE "value"::text ~ 'Sweets by Shee\M';
