#!/bin/bash
# Backup quotidien de la base SQLite evstats
#
# Usage :
#   DB_PATH=/path/to/evstats.db BACKUP_DIR=/path/to/backups ./backup.sh
#
# Exemple cron (VM Docker, volume sur /srv/docker_data) :
#   0 3 * * * root DB_PATH=/srv/docker_data/evstats/evstats.db \
#                   BACKUP_DIR=/srv/docker_data/evstats/backups \
#                   /path/to/scripts/backup.sh
#
# Si les variables ne sont pas définies, les valeurs par défaut ci-dessous s'appliquent.

set -euo pipefail

DB_PATH="${DB_PATH:-/app/data/evstats.db}"
BACKUP_DIR="${BACKUP_DIR:-/app/data/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"

mkdir -p "$BACKUP_DIR"

if [ ! -f "$DB_PATH" ]; then
  echo "$(date): DB introuvable : $DB_PATH" >&2
  exit 1
fi

DEST="$BACKUP_DIR/evstats_$(date +%Y%m%d_%H%M%S).db"

# sqlite3 online backup (safe même si l'appli tourne)
sqlite3 "$DB_PATH" ".backup '$DEST'"

echo "$(date): Backup OK → $DEST ($(du -sh "$DEST" | cut -f1))"

# Nettoyage des backups > RETENTION_DAYS jours
find "$BACKUP_DIR" -name "evstats_*.db" -mtime +"$RETENTION_DAYS" -delete
echo "$(date): Nettoyage : backups de plus de $RETENTION_DAYS jours supprimés"
