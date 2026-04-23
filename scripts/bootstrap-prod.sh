#!/bin/sh
set -e

echo "[bootstrap] waiting for database and redis..."
tries=0
fallback_mode=0
until npx prisma migrate deploy --schema prisma/schema.prisma >/tmp/migrate.log 2>&1; do
  tries=$((tries + 1))
  if [ "$tries" -ge 30 ]; then
    echo "[bootstrap] migrate deploy failed, switching to fallback db push"
    fallback_mode=1
    break
  fi
  sleep 2
done

if [ "$fallback_mode" -eq 0 ]; then
  echo "[bootstrap] migration-first deploy applied"
else
  echo "[bootstrap] fallback: prisma db push"
  npx prisma db push --schema prisma/schema.prisma --skip-generate
  echo "[bootstrap] fallback: applying db state machine constraints"
  npx tsx scripts/apply-state-machine-constraints.ts
fi

echo "[bootstrap] running seed..."
npx prisma db seed --schema prisma/schema.prisma
echo "[bootstrap] done"
