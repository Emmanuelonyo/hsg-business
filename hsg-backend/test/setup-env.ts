// Jest always runs against the hsg_test database, never the dev database.
import * as dotenv from 'dotenv';
dotenv.config();
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://hsg_app:hsg_app@localhost:5432/hsg_test';
process.env.REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/1';
