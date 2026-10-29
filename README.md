# 🥋 Duell am See

Ein Online-Kampfspiel für zwei im Handy-Browser – vor einem See bei Sonnenuntergang.

- Wer die Seite **zuerst** öffnet, spielt **IHN** (1,80 m, Poloshirt, Jeans).
- Wer **als Zweites** kommt, spielt **SIE** (1,50 m, Bluse, Anzughose).
- Alle weiteren **schauen zu** und rücken in einer Warteschlange nach, sobald ein Spieler den Tab schließt.

## Steuerung

| Aktion   | Handy   | Tastatur          |
|----------|---------|-------------------|
| Bewegen  | ◀ ▶     | ← → oder A D      |
| Springen | ▲       | ↑, W oder Leertaste |
| Hieb     | Hieb    | J                 |
| Tritt    | Tritt   | K                 |
| Block    | Block   | L oder ↓          |

ER hat mehr Reichweite und Wucht, SIE ist schneller.

## Wie die Verbindung funktioniert

Es gibt keinen eigenen Server. Die Browser verbinden sich direkt miteinander (WebRTC, über die Bibliothek PeerJS und deren kostenlosen Vermittlungsdienst). Der Browser von IHM rechnet das Spiel und schickt den Stand an alle anderen. Schließt er den Tab, übernimmt automatisch der nächste.

**Eigene Arena:** Mit `?raum=name` hinten an der Adresse (z. B. `…netlify.app/?raum=wir2`) entsteht ein separater Raum.

## Deployen (GitHub + Netlify)

```bash
cd duell-am-see
git init
git add -A
git commit -m "Duell am See"
git branch -M main
git remote add origin https://github.com/DEIN-NAME/duell-am-see.git
git push -u origin main
```

Dann bei Netlify: **Add new project → Import an existing project → GitHub → duell-am-see**.
Build command und Publish directory leer lassen → **Deploy**. Danach unter *Project visibility* auf **Public** stellen.

## Gut zu wissen

- Läuft das Spiel beim Host im Hintergrund (anderer Tab, Handy gesperrt), bremsen Browser es stark aus – das Spiel stockt dann für alle.
- In sehr strengen Firmen- oder Uni-Netzen kann die Direktverbindung blockiert sein. Im Mobilfunknetz klappt es in der Regel.
