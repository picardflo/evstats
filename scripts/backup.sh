#!/bin/bash
# Backup quotidien de la base SQLite evstats
# À exécuter via cron sur la VM Docker :
#   0 3 * * * /srv/docker_data/evstats/scripts/backup.sh

set -euo pipefail

DB_PATH="/srv/docker_data/evstats/evstats.db"
BACKUP_DIR="/srv/docker_data/evstats/backups"
RETENTION_DAYS=30

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
find "$BACKUP_DIR" -name "evstats_*.db" -mtime +$RETENTION_DAYS -delete
echo "$(date): Nettoyage : backups de plus de $RETENTION_DAYS jours supprimés"
