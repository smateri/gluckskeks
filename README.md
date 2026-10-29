# 🥠 Glückskeks

Das Orakel der künftigen Frau Doktor: ein mystischer Glückskeks mit Weisheiten für eine Doktorandin aus Mannheim und einem gemeinsamen Zähler für alle Besucher.

## Aufbau

```
gluckskeks/
├── public/                    ← die Website selbst
│   ├── index.html
│   ├── style.css
│   └── script.js              ← hier stehen die Weisheiten
├── netlify/functions/
│   └── count.mjs              ← gemeinsamer Zähler (speichert in Netlify Blobs)
├── netlify.toml               ← sagt Netlify, wo was liegt
├── package.json               ← eine Abhängigkeit für den Zähler
└── .gitignore
```

## Deployen (Netlify)

Einfach pushen:

```bash
git add -A
git commit -m "Gemeinsamer Zähler und neue Weisheiten"
git push
```

Netlify liest die `netlify.toml` automatisch: Die Seite kommt aus `public/`, der Zähler läuft als Funktion unter `/api/count`.
Falls in den Netlify-Einstellungen unter **Build settings** noch ein eigenes *Publish directory* eingetragen ist, das Feld leeren oder auf `public` setzen.

## Lokal ansehen

`public/index.html` im Browser öffnen. Der Zähler funktioniert nur online auf Netlify, lokal bleibt er bei „…“ stehen.

## Eigene Weisheiten

In `public/script.js` das Array `fortunes` erweitern.
