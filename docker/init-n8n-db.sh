#!/bin/bash
# Cria o banco e usuario do n8n se ainda nao existirem
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE USER n8n WITH PASSWORD 'N8N_DB_PASSWORD_REMOVIDA';
    CREATE DATABASE n8n OWNER n8n;
    GRANT ALL PRIVILEGES ON DATABASE n8n TO n8n;
EOSQL

echo ">>> n8n database and user created successfully."
