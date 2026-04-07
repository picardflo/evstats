"""
Client UDP pour la borne EVSE (protocole EVSEMaster / Morec).

Protocole UDP sur port 28376 (écoute locale) :
  1. Attendre le broadcast 0x0001 de la borne (toutes les ~5s)
  2. Envoyer RequestLogin 0x8002 au port source de la borne (6186)
  3. Recevoir LoginOK 0x0002
  4. Envoyer LoginConfirm 0x8001
  5. Envoyer GetStatus 0x8004
  6. Recevoir StatusResponse 0x0004

Contrainte : une seule session UDP à la fois (l'app EVSEMaster doit être fermée).

Structure des paquets :
  Header (2B) : 0x06 0x01
  Length (2B)  : longueur du corps + 4 (checksum + tail)
  key_type (1B): 0x00
  Serial  (8B) : numéro de série de la borne
  Password(6B) : mot de passe 6 chiffres (ASCII, padded)
  Command (2B) : code de commande (big-endian)
  Payload (var): données
  Checksum(2B) : somme de tous les octets précédents % 0xFFFF
  Tail    (2B) : 0x0f 0x02

Référence de base : https://github.com/Oniric75/evsemasterudp
"""

import socket
import struct
import time

HEADER      = b'\x06\x01'
TAIL        = b'\x0f\x02'
LISTEN_PORT = 28376   # Port d'écoute local (la borne broadcast vers ce port)

# Commandes envoyées au chargeur
CMD_REQUEST_LOGIN  = 0x8002
CMD_LOGIN_CONFIRM  = 0x8001
CMD_GET_STATUS     = 0x8004

# Commandes reçues du chargeur
CMD_BROADCAST      = 0x0001
CMD_LOGIN_OK       = 0x0002
CMD_STATUS_RESP    = 0x0004


def _build_packet(serial_bytes: bytes, password_bytes: bytes, cmd: int, payload: bytes = b'') -> bytes:
    """Construit un paquet UDP conforme au protocole EVSEMaster."""
    key_type = b'\x00'
    body = key_type + serial_bytes + password_bytes + struct.pack('>H', cmd) + payload
    # length = taille totale du paquet
    # total = header(2) + length(2) + body + checksum(2) + tail(2) = len(body) + 8
    total = len(body) + 8
    length = struct.pack('>H', total)
    raw = HEADER + length + body
    checksum = sum(raw) % 0xFFFF
    return raw + struct.pack('>H', checksum) + TAIL


def _parse_response(data: bytes) -> tuple[int, bytes]:
    """
    Décode un paquet reçu.
    Structure : header(2) + length(2) + key_type(1) + serial(8) + password(6) + cmd(2) + payload + checksum(2) + tail(2)
    Le champ password vaut 0xFF×6 dans les broadcasts et réponses de la borne.
    Returns (cmd, payload).
    """
    if len(data) < 23:
        return -1, b''
    cmd = struct.unpack('>H', data[19:21])[0]
    payload = data[21:-4]
    return cmd, payload


def _serial_from_packet(data: bytes) -> bytes:
    """Extrait les 8 octets du numéro de série depuis un paquet reçu (offset 5)."""
    return data[5:13]


def _parse_status_payload(payload: bytes) -> dict:
    print(f"[udp] payload status ({len(payload)}B) hex={payload.hex()}", flush=True)
    """
    Décode le payload de la réponse 0x0004 (statut de charge).

    Offsets validés sur borne Morec MC20CAPP :
      [0]    : byte de statut (0x00 = veille)
      [1:3]  : tension (uint16 big-endian, *0.1 → V)
      [3:5]  : courant (uint16 big-endian, *0.01 → A)
      [9:11] : puissance (uint16 big-endian, *0.1 → W)

    Note : la température est présente dans le payload mais son offset
    exact nécessite calibration (la formule (raw-20000)*0.01 donne ~400°C
    en veille — décalage à confirmer lors d'une session de charge active).
    """
    result = {}
    if len(payload) >= 3:
        raw_v = struct.unpack('>H', payload[1:3])[0]
        result['voltage'] = round(raw_v * 0.1, 1)
    if len(payload) >= 5:
        raw_i = struct.unpack('>H', payload[3:5])[0]
        result['current'] = round(raw_i * 0.01, 2)
    if len(payload) >= 11:
        raw_p = struct.unpack('>H', payload[9:11])[0]
        result['power_w'] = round(raw_p * 0.1, 1)
    result['is_charging'] = result.get('current', 0) > 0.1
    return result


def _resolve_host(host: str) -> str:
    """Résout un hostname ou FQDN en adresse IP. Retourne l'IP telle quelle si déjà numérique."""
    try:
        return socket.gethostbyname(host)
    except socket.gaierror as e:
        raise RuntimeError(f"Impossible de résoudre '{host}' : {e}") from e


def test_connection(ip: str, password: str, timeout: int = 20) -> dict:
    """
    Teste la connexion UDP à une borne EVSE et retourne les informations du périphérique.

    Effectue le flow d'authentification complet et récupère le statut actuel.

    Args:
        ip       : adresse IP de la borne
        password : mot de passe à 6 chiffres (ex: "202604")
        timeout  : délai maximum en secondes pour recevoir le broadcast initial

    Returns:
        dict avec : serial, src_port, voltage, current, power_w, is_charging

    Raises:
        RuntimeError : si la borne ne répond pas ou si l'authentification échoue
    """
    resolved_ip    = _resolve_host(ip)
    password_bytes = password.encode('ascii').ljust(6, b'\x00')[:6]

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        sock.bind(('', LISTEN_PORT))
    except OSError as e:
        raise RuntimeError(f"Impossible d'écouter sur le port {LISTEN_PORT} : {e}. "
                           "Un autre processus est peut-être déjà en écoute.") from e
    sock.settimeout(2)

    try:
        # ── Étape 1 : Attendre le broadcast de la borne ──────────────────────
        serial_bytes = None
        src_port = None
        deadline = time.time() + timeout

        while time.time() < deadline:
            try:
                data, addr = sock.recvfrom(1024)
            except socket.timeout:
                continue

            if addr[0] != resolved_ip:
                continue

            cmd, _ = _parse_response(data)
            if cmd == CMD_BROADCAST:
                serial_bytes = _serial_from_packet(data)
                src_port = addr[1]
                break

        if serial_bytes is None:
            raise RuntimeError(
                f"Aucun broadcast reçu de {ip} ({resolved_ip}) dans les {timeout}s. "
                "Vérifiez l'adresse et assurez-vous que l'application "
                "EVSEMaster est fermée (une seule session UDP à la fois)."
            )

        serial_hex = serial_bytes.hex()

        # ── Étape 2 : RequestLogin (0x8002) ──────────────────────────────────
        pkt = _build_packet(serial_bytes, password_bytes, CMD_REQUEST_LOGIN)
        sock.sendto(pkt, (resolved_ip, src_port))

        # ── Étape 3 : Attendre LoginOK (0x0002) ──────────────────────────────
        sock.settimeout(5)
        login_ok = False
        deadline = time.time() + 8

        while time.time() < deadline:
            try:
                data, addr = sock.recvfrom(1024)
            except socket.timeout:
                continue
            cmd, _ = _parse_response(data)
            if cmd == CMD_LOGIN_OK:
                login_ok = True
                break
            # Les broadcasts 0x0001 peuvent continuer à arriver, les ignorer

        if not login_ok:
            raise RuntimeError(
                "Authentification refusée. Vérifiez le mot de passe. "
                "Si l'app EVSEMaster est ouverte, fermez-la et réessayez."
            )

        # ── Étape 4 : LoginConfirm (0x8001) ──────────────────────────────────
        pkt = _build_packet(serial_bytes, password_bytes, CMD_LOGIN_CONFIRM)
        sock.sendto(pkt, (resolved_ip, src_port))

        # ── Étape 5 : GetStatus (0x8004) ─────────────────────────────────────
        pkt = _build_packet(serial_bytes, password_bytes, CMD_GET_STATUS)
        sock.sendto(pkt, (resolved_ip, src_port))

        # ── Étape 6 : Attendre StatusResponse (0x0004) ───────────────────────
        status = {}
        deadline = time.time() + 5

        while time.time() < deadline:
            try:
                data, addr = sock.recvfrom(1024)
            except socket.timeout:
                continue
            cmd, payload = _parse_response(data)
            if cmd == CMD_STATUS_RESP:
                status = _parse_status_payload(payload)
                break

        return {
            'serial':      serial_hex,
            'src_port':    src_port,
            'voltage':     status.get('voltage'),
            'current':     status.get('current'),
            'power_w':     status.get('power_w'),
            'is_charging': status.get('is_charging', False),
        }

    finally:
        sock.close()


def get_status(ip: str, serial_hex: str, password: str,
               src_port: int = 6186, timeout: int = 20) -> dict:
    """
    Récupère le statut actuel d'une borne connue.

    Effectue le même flow d'authentification que test_connection
    (le protocole ne maintient pas de session persistante).

    Args:
        ip         : adresse IP de la borne
        serial_hex : numéro de série hex (ex: "9451591201849145" en hex)
        password   : mot de passe
        src_port   : port source de la borne (obtenu lors du test, défaut 6186)
        timeout    : délai max en secondes pour le broadcast

    Returns:
        dict avec : voltage, current, power_w, is_charging

    Raises:
        RuntimeError : si la borne ne répond pas
    """
    resolved_ip    = _resolve_host(ip)
    password_bytes = password.encode('ascii').ljust(6, b'\x00')[:6]
    serial_bytes   = bytes.fromhex(serial_hex)

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        sock.bind(('', LISTEN_PORT))
    except OSError as e:
        raise RuntimeError(f"Impossible d'écouter sur le port {LISTEN_PORT} : {e}") from e
    sock.settimeout(2)

    try:
        # Attendre broadcast
        actual_src_port = src_port
        deadline = time.time() + timeout

        while time.time() < deadline:
            try:
                data, addr = sock.recvfrom(1024)
            except socket.timeout:
                continue
            if addr[0] != resolved_ip:
                continue
            cmd, _ = _parse_response(data)
            if cmd == CMD_BROADCAST:
                actual_src_port = addr[1]
                break
        else:
            raise RuntimeError(f"Aucun broadcast reçu de {ip} ({resolved_ip}) dans les {timeout}s.")

        # Auth
        sock.settimeout(5)
        pkt = _build_packet(serial_bytes, password_bytes, CMD_REQUEST_LOGIN)
        sock.sendto(pkt, (resolved_ip, actual_src_port))

        login_ok = False
        deadline = time.time() + 8
        while time.time() < deadline:
            try:
                data, _ = sock.recvfrom(1024)
            except socket.timeout:
                continue
            cmd, _ = _parse_response(data)
            if cmd == CMD_LOGIN_OK:
                login_ok = True
                break

        if not login_ok:
            raise RuntimeError("Authentification échouée.")

        pkt = _build_packet(serial_bytes, password_bytes, CMD_LOGIN_CONFIRM)
        sock.sendto(pkt, (resolved_ip, actual_src_port))

        pkt = _build_packet(serial_bytes, password_bytes, CMD_GET_STATUS)
        sock.sendto(pkt, (resolved_ip, actual_src_port))

        deadline = time.time() + 5
        while time.time() < deadline:
            try:
                data, _ = sock.recvfrom(1024)
            except socket.timeout:
                continue
            cmd, payload = _parse_response(data)
            if cmd == CMD_STATUS_RESP:
                return _parse_status_payload(payload)

        raise RuntimeError("Pas de réponse au statut après authentification.")

    finally:
        sock.close()
