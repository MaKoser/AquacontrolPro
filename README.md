# AquaControl Pro v3
### Meerwasseraquarium Steuerung für iPad

---

## Schnellstart (5 Minuten)

### Voraussetzungen
- **Node.js** (kostenlos): https://nodejs.org → LTS Version herunterladen & installieren

### Schritt 1 – Pakete installieren
Ordner `aquacontrol` in einem Terminal öffnen:

```bash
cd aquacontrol
npm install
```

### Schritt 2 – Entwicklungsmodus starten
```bash
npm run dev
```
→ App läuft auf **http://localhost:5173**  
→ Im Browser öffnen und loslegen ✓

---

## Als PWA auf dem iPad installieren

### Schritt 1 – Build erstellen
```bash
npm run build
```
Erzeugt einen `dist/` Ordner mit der fertigen App.

### Schritt 2 – Lokalen Server starten
```bash
npm run preview
```
oder mit einem einfachen HTTP-Server:
```bash
npx serve dist
```

### Schritt 3 – IP-Adresse des Computers herausfinden
**Mac:** Systemeinstellungen → Netzwerk → IP (z.B. 192.168.1.50)  
**Windows:** cmd → `ipconfig` → IPv4-Adresse

### Schritt 4 – iPad verbinden
1. iPad und Computer im **gleichen WLAN** (Vertima-24)
2. Safari auf dem iPad öffnen
3. `http://192.168.1.50:4173` aufrufen (Port ggf. anpassen)
4. **Teilen-Symbol** → **„Zum Home-Bildschirm"**
5. Fertig – AquaControl Pro erscheint als App-Icon ✓

---

## Einstellungen in der App

### ESP32
| Einstellung | Beschreibung |
|---|---|
| IP-Adresse | IP des ESP32 im WLAN (Serial Monitor beim Flash ablesen) |
| Beckenvolumen | Liter Nettovolumen des Aquariums |
| Pumpengeschwindigkeit | ml/ms – messen: 10s laufen lassen, ml messen, teilen |

### Home Assistant
| Einstellung | Beschreibung |
|---|---|
| HA URL | z.B. `http://homeassistant.local:8123` oder IP |
| Access Token | HA → Profil → Sicherheit → Langlebige Zugriffstoken |
| Temperatur-Entität | z.B. `sensor.aquarium_temperature` |
| Entitäten | Schalter/Sensoren die gesteuert werden sollen |

### Parameter (KH, Ca, Mg, …)
| Feld | Beschreibung |
|---|---|
| ml/100L pro 1 Einheit | **Wichtigste Einstellung!** Steht auf dem Produktetikett. z.B. Fauna Marin Balling: KH=17,8 / Ca=5,88 / Mg=8,33 |
| Max/Tag | Sicherheitslimit – nie mehr als dieser Wert pro 24h |
| Max/Vorgang | Wie viel die Pumpe auf einmal dosiert (z.B. 10ml) |
| Standard-Tagesdosis | Feste tägliche Basisdosierung (z.B. 50ml Calcium) |

---

## Projektstruktur
```
aquacontrol/
├── src/
│   ├── main.jsx              ← Einstiegspunkt
│   └── AquaControlPro_v3.jsx ← Gesamte App
├── public/
│   ├── manifest.json         ← PWA-Konfiguration
│   └── icon.svg              ← App-Icon
├── index.html                ← HTML-Grundgerüst
├── vite.config.js            ← Build-Konfiguration
├── package.json              ← Abhängigkeiten
└── README.md                 ← Diese Datei
```

---

## Häufige Probleme

**„Cannot fetch ESP32"**  
→ App und ESP32 müssen im gleichen Netz sein. App muss über `http://` laufen (nicht https).

**Home Assistant nicht erreichbar**  
→ HA URL ohne abschließenden `/`. Token korrekt kopiert? In HA: Profil → ganz nach unten scrollen.

**Pumpengeschwindigkeit falsch**  
→ Pumpe 10 Sekunden laufen lassen (via `/dose?pump=1&time=10000`), Wasservolumen messen, dann: `ml ÷ 10000ms = ml/ms`

---

## ESP32 Endpoints
```
GET http://[IP]/ping              → {"pong":true}
GET http://[IP]/status            → JSON Systemstatus  
GET http://[IP]/dose?pump=1&time=5000  → Pumpe 1 für 5s
GET http://[IP]/stop              → Alle Pumpen stopp
```
