-- Gapless-enough daily transfer reference counter (HSG-YYYYMMDD-NNNNNN). The app role cannot CREATE, so it lives here.
CREATE SEQUENCE IF NOT EXISTS transfer_ref_seq;
DO $$BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hsg_app') THEN
    GRANT USAGE, SELECT ON SEQUENCE transfer_ref_seq TO hsg_app;
  END IF;
END$$;
