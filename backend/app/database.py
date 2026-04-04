"""
Connexion à la base de données SQLite via SQLModel.

La base est un fichier SQLite dont le chemin est configurable via la
variable d'environnement DATABASE_URL (défaut : ./evstats.db en dev,
/app/data/evstats.db en Docker via le Dockerfile).

check_same_thread=False est nécessaire pour FastAPI qui utilise plusieurs
threads pour servir les requêtes, alors que SQLite est monothread par défaut.
"""

import os
from sqlmodel import SQLModel, create_engine, Session

# Chemin de la base : variable d'env en prod, fichier local en dev
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./evstats.db")

engine = create_engine(
    DATABASE_URL,
    echo=False,  # Passer à True pour logger les requêtes SQL (debug uniquement)
    connect_args={"check_same_thread": False},
)


def create_db():
    """Crée toutes les tables définies dans les modèles SQLModel si elles n'existent pas."""
    SQLModel.metadata.create_all(engine)


def get_session():
    """
    Générateur de session SQLModel pour l'injection de dépendances FastAPI.

    Usage dans un endpoint :
        def my_endpoint(db: Session = Depends(get_session)):
            ...
    """
    with Session(engine) as session:
        yield session
