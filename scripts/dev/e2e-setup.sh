#!/usr/bin/env bash
# Prepares the end-to-end database: migrations, demo data, and a test owner account.
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL must point at the e2e database}"
case "$DATABASE_URL" in *e2e*|*test*) ;; *) echo "Refusing: DATABASE_URL doesn't look like a test database" >&2; exit 1 ;; esac
pnpm -s db:migrate
pnpm -s db:seed:demo --reset
psql "$DATABASE_URL" -qc "TRUNCATE admin_users, admin_sessions, audit_log CASCADE"
ADMIN_EMAIL="e2e-owner@example.com" ADMIN_NAME="E2E Owner" ADMIN_PASSWORD="e2e-password-123456" pnpm -s admin:create
ADMIN_EMAIL="e2e-production@example.com" ADMIN_NAME="E2E Baker" ADMIN_ROLE="production" ADMIN_PASSWORD="e2e-password-654321" pnpm -s admin:create
ADMIN_EMAIL="e2e-orders@example.com" ADMIN_NAME="E2E Orders" ADMIN_ROLE="order_manager" ADMIN_PASSWORD="e2e-password-orders-1" pnpm -s admin:create
rm -rf ./storage-e2e
