"""
Génération de rapports PDF mensuels.

Utilise reportlab pour produire un PDF autonome :
  - En-tête avec logo éclair + titre + période
  - KPIs : sessions, énergie, HC, HP, coût, économies
  - Tableau des sessions (début, fin, durée, énergie, coût, statut)
  - Pied de page avec date de génération
"""

from datetime import datetime
from io import BytesIO
from typing import List

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable,
)
from reportlab.lib.enums import TA_CENTER, TA_RIGHT

# Palette cohérente avec le frontend dark theme
COLOR_PRIMARY   = colors.HexColor("#00b4d8")  # Cyan
COLOR_HP        = colors.HexColor("#e85d04")  # Orange
COLOR_COST      = colors.HexColor("#06d6a0")  # Vert
COLOR_SAVINGS   = colors.HexColor("#a855f7")  # Violet
COLOR_DARK      = colors.HexColor("#161b22")  # Fond sombre
COLOR_MID       = colors.HexColor("#21262d")  # Fond tableau
COLOR_LIGHT_TXT = colors.HexColor("#c9d1d9")  # Texte clair
COLOR_WHITE     = colors.white


def generate_monthly_pdf(sessions: list, month_str: str, tariff) -> bytes:
    """
    Génère un rapport PDF pour un mois donné.

    Args:
        sessions:  Liste de ChargingSession triées par start_time
        month_str: Format "YYYY-MM" (ex: "2026-03")
        tariff:    TariffConfig (pour afficher les tarifs utilisés)

    Returns:
        Contenu du PDF en bytes
    """
    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=15 * mm,
        rightMargin=15 * mm,
        topMargin=15 * mm,
        bottomMargin=15 * mm,
    )

    styles = getSampleStyleSheet()
    story = []

    # ── Styles personnalisés ─────────────────────────────────────────────────
    title_style = ParagraphStyle(
        "title",
        parent=styles["Normal"],
        fontSize=20,
        textColor=COLOR_PRIMARY,
        fontName="Helvetica-Bold",
        spaceAfter=2 * mm,
    )
    subtitle_style = ParagraphStyle(
        "subtitle",
        parent=styles["Normal"],
        fontSize=12,
        textColor=COLOR_LIGHT_TXT,
        fontName="Helvetica",
        spaceAfter=4 * mm,
    )
    section_style = ParagraphStyle(
        "section",
        parent=styles["Normal"],
        fontSize=11,
        textColor=COLOR_WHITE,
        fontName="Helvetica-Bold",
        spaceBefore=4 * mm,
        spaceAfter=2 * mm,
    )
    small_style = ParagraphStyle(
        "small",
        parent=styles["Normal"],
        fontSize=8,
        textColor=COLOR_LIGHT_TXT,
        fontName="Helvetica",
    )
    right_style = ParagraphStyle(
        "right",
        parent=styles["Normal"],
        fontSize=8,
        textColor=COLOR_LIGHT_TXT,
        fontName="Helvetica",
        alignment=TA_RIGHT,
    )

    # ── En-tête ──────────────────────────────────────────────────────────────
    year, month = month_str.split("-")
    month_label = datetime.strptime(month_str + "-01", "%Y-%m-%d").strftime("%B %Y").capitalize()

    story.append(Paragraph("⚡ EVSE Stats — Rapport mensuel", title_style))
    story.append(Paragraph(month_label, subtitle_style))
    story.append(HRFlowable(width="100%", thickness=1, color=COLOR_PRIMARY, spaceAfter=4 * mm))

    # ── Calcul des KPIs ───────────────────────────────────────────────────────
    total_sessions  = len(sessions)
    total_energy    = sum(s.energy_kwh for s in sessions)
    total_hc        = sum(s.hc_kwh for s in sessions)
    total_hp        = sum(s.hp_kwh for s in sessions)
    total_cost      = sum(s.cost_eur for s in sessions)
    total_duration  = sum(s.duration_minutes for s in sessions)
    total_savings   = total_energy * tariff.price_hp - total_cost
    hc_pct          = (total_hc / total_energy * 100) if total_energy > 0 else 0
    avg_cost        = total_cost / total_sessions if total_sessions > 0 else 0
    eff_price       = (total_cost / total_energy * 100) if total_energy > 0 else 0

    # ── Tableau KPIs ──────────────────────────────────────────────────────────
    story.append(Paragraph("Résumé", section_style))

    kpi_data = [
        ["Indicateur", "Valeur"],
        ["Sessions", str(total_sessions)],
        ["Énergie totale",      f"{total_energy:.2f} kWh"],
        ["dont Heures Creuses", f"{total_hc:.2f} kWh  ({hc_pct:.1f}%)"],
        ["dont Heures Pleines", f"{total_hp:.2f} kWh  ({100-hc_pct:.1f}%)"],
        ["Durée totale",        f"{total_duration/60:.1f} h  (~{total_duration/total_sessions:.0f} min/session)"],
        ["Coût total",          f"{total_cost:.2f} €"],
        ["Coût moyen / session", f"{avg_cost:.2f} €"],
        ["Prix effectif",       f"{eff_price:.2f} c€/kWh"],
        ["Économies vs 100% HP", f"{total_savings:.2f} €"],
    ]

    kpi_table = Table(kpi_data, colWidths=[90 * mm, 80 * mm])
    kpi_table.setStyle(TableStyle([
        # En-tête
        ("BACKGROUND",   (0, 0), (-1, 0),  COLOR_DARK),
        ("TEXTCOLOR",    (0, 0), (-1, 0),  COLOR_PRIMARY),
        ("FONTNAME",     (0, 0), (-1, 0),  "Helvetica-Bold"),
        ("FONTSIZE",     (0, 0), (-1, 0),  9),
        # Corps — alternance de couleurs
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [COLOR_MID, COLOR_DARK]),
        ("TEXTCOLOR",    (0, 1), (-1, -1),  COLOR_LIGHT_TXT),
        ("FONTSIZE",     (0, 1), (-1, -1),  9),
        # Alignement colonne valeur
        ("ALIGN",        (1, 0), (1, -1),  "RIGHT"),
        # Bordures légères
        ("GRID",         (0, 0), (-1, -1),  0.3, colors.HexColor("#30363d")),
        ("ROWPADDING",   (0, 0), (-1, -1),  4),
        # Couleurs spéciales
        ("TEXTCOLOR",    (1, 6), (1, 6),   COLOR_COST),    # Coût total
        ("TEXTCOLOR",    (1, 9), (1, 9),   COLOR_SAVINGS), # Économies
    ]))
    story.append(kpi_table)
    story.append(Spacer(1, 4 * mm))

    # ── Tarifs utilisés ───────────────────────────────────────────────────────
    story.append(Paragraph(
        f"Tarifs EDF appliqués : HC {tariff.price_hc*100:.2f} c€/kWh · HP {tariff.price_hp*100:.2f} c€/kWh",
        small_style,
    ))
    story.append(Spacer(1, 6 * mm))

    # ── Tableau des sessions ──────────────────────────────────────────────────
    story.append(Paragraph(f"Sessions ({total_sessions})", section_style))

    session_data = [["Début", "Fin", "Durée", "Énergie", "HC", "HP", "Coût", "Statut"]]
    for s in sessions:
        session_data.append([
            s.start_time.strftime("%d/%m %H:%M"),
            s.end_time.strftime("%d/%m %H:%M"),
            f"{s.duration_minutes:.0f} min",
            f"{s.energy_kwh:.2f}",
            f"{s.hc_kwh:.2f}",
            f"{s.hp_kwh:.2f}",
            f"{s.cost_eur:.3f} €",
            s.end_status,
        ])

    col_widths = [22*mm, 22*mm, 16*mm, 18*mm, 16*mm, 16*mm, 18*mm, 24*mm]
    session_table = Table(session_data, colWidths=col_widths, repeatRows=1)
    session_table.setStyle(TableStyle([
        # En-tête
        ("BACKGROUND",   (0, 0), (-1, 0),  COLOR_DARK),
        ("TEXTCOLOR",    (0, 0), (-1, 0),  COLOR_PRIMARY),
        ("FONTNAME",     (0, 0), (-1, 0),  "Helvetica-Bold"),
        ("FONTSIZE",     (0, 0), (-1, 0),  7),
        # Corps
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [COLOR_MID, COLOR_DARK]),
        ("TEXTCOLOR",    (0, 1), (-1, -1),  COLOR_LIGHT_TXT),
        ("FONTSIZE",     (0, 1), (-1, -1),  7),
        ("ALIGN",        (2, 0), (6, -1),  "RIGHT"),
        ("GRID",         (0, 0), (-1, -1),  0.2, colors.HexColor("#30363d")),
        ("ROWPADDING",   (0, 0), (-1, -1),  3),
    ]))
    story.append(session_table)

    # ── Pied de page ──────────────────────────────────────────────────────────
    story.append(Spacer(1, 6 * mm))
    story.append(HRFlowable(width="100%", thickness=0.5, color=COLOR_PRIMARY))
    story.append(Paragraph(
        f"Généré le {datetime.now().strftime('%d/%m/%Y à %H:%M')} — EVSE Stats",
        right_style,
    ))

    doc.build(story)
    return buffer.getvalue()
