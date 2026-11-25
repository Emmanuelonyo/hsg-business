-- Gapless-enough daily transfer reference counter (HSG-YYYYMMDD-NNNNNN). The app role cannot CREATE, so it lives here.
CREATE SEQUENCE IF NOT EXISTS transfer_ref_seq;
GRANT USAGE, SELECT ON SEQUENCE transfer_ref_seq TO hsg_app;
