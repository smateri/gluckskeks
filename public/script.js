const fortunes = [
  // Die Doktorarbeit
  "Das Kapitel, das du am meisten fürchtest, wird das sein, auf das du am stolzesten bist.",
  "Die Sterne sehen bereits zwei Buchstaben vor deinem Namen leuchten: Dr.",
  "Eine Doktorarbeit wird nicht an einem Tag geschrieben. Aber an vielen Tagen, an denen du einfach weitergemacht hast.",
  "Reviewer 2 wird heute gnädig gestimmt sein. Die Sterne haben mit ihm gesprochen.",
  "Dein Literaturverzeichnis wird sich wie von Zauberhand von selbst formatieren. Fast.",
  "Die Daten werden sprechen. Und sie werden genau das sagen, was du gehofft hast.",
  "Wer eine Disputation fürchtet, hat sie noch nicht bestanden. Du wirst sie bestehen.",
  "Eine Deadline ist nur ein Drache, der darauf wartet, von dir besiegt zu werden.",
  "Der weise Meister sagt: Auch eine Dissertation von 300 Seiten beginnt mit einem einzigen Satz.",
  "Heute wird dir ein Gedanke kommen, der eine ganze Seite deiner Arbeit rettet.",
  "Dein Doktorvater wird nächste Woche überraschend schnell auf deine Mail antworten.",
  "Die Konferenz, auf die du hoffst, wird deinen Vortrag annehmen.",
  "Kaffee ist die Tinte, mit der große Dissertationen geschrieben werden.",
  "Prokrastination ist nur dein Geist, der heimlich an der Lösung arbeitet.",
  "Eines Tages wirst du Frau Doktor genannt werden, und es wird sich wunderbar anfühlen.",
  "Der p-Wert ist dir wohlgesonnen. Die Sterne haben gerechnet.",
  "Zweifel ist der Schatten jeder Forscherin. Doch nur wer im Licht steht, wirft einen.",
  "Die schwierigste Fußnote deiner Arbeit liegt bereits hinter dir.",

  // Klein, dunkles Haar, stark
  "Die kleinsten Laternen leuchten in der dunkelsten Nacht am hellsten.",
  "Der Bambus ist schlank, doch kein Sturm kann ihn brechen. So auch du.",
  "Die Nacht hat dir ihre Farbe für dein Haar geliehen und dir dafür ihre Weisheit geschenkt.",
  "Große Taten brauchen keine großen Körper, sondern einen großen Geist. Den hast du.",
  "Wie der Mond in dunkler Nacht wird deine Arbeit über allen anderen leuchten.",

  // Mannheim
  "In der Stadt der Quadrate wirst du heute einen Weg finden, der um keine Ecke führt.",
  "Wie der Wasserturm über Mannheim wacht, so wacht das Glück heute über dich.",
  "Wo Rhein und Neckar sich treffen, fließen auch deine Gedanken heute zusammen.",
  "Mannheim gab der Welt das Auto und das Fahrrad. Bald gibt es ihr auch deine Dissertation.",
  "Gönn dir nach dem nächsten Kapitel ein Spaghettieis. Es wurde schließlich in deiner Stadt erfunden.",
  "Das Schloss hat schon viele Gelehrte gesehen. Bald trägt eine weitere ihren Doktorhut hinaus.",
  "Ein Spaziergang durch den Luisenpark wird dir die Antwort bringen, die du am Schreibtisch suchst."
];

const $ = (id) => document.getElementById(id);
const cookie = $("cookie"), paper = $("paper"), fortuneEl = $("fortune");
const numbersEl = $("numbers"), again = $("again"), hint = $("hint");
const countEl = $("count"), burst = $("burst"), sky = $("sky");

const rand = (min, max) => Math.random() * (max - min) + min;

/* ---------- Gemeinsamer Zähler ---------- */
const API = "/api/count";
let count = 0;

function showCount(n) {
  if (n >= count) {
    count = n;
    countEl.textContent = count.toLocaleString("de-DE");
  }
}

async function loadCount() {
  try {
    const res = await fetch(API, { cache: "no-store" });
    if (res.ok) showCount((await res.json()).count);
  } catch (e) { /* lokal ohne Server: Zähler bleibt einfach stehen */ }
}

async function addCount() {
  showCount(count + 1); // sofort anzeigen, Server bestätigt gleich
  try {
    const res = await fetch(API, { method: "POST" });
    if (res.ok) showCount((await res.json()).count);
  } catch (e) {}
}

loadCount();
// Alle 20 Sekunden nachsehen, ob andere Kekse geöffnet haben (nur wenn die Seite sichtbar ist)
setInterval(() => { if (!document.hidden) loadCount(); }, 20000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) loadCount(); });

/* ---------- Laternen & Blüten ---------- */
function spawnScene() {
  for (let i = 0; i < 9; i++) {
    const l = document.createElement("div");
    l.className = "lantern";
    const size = rand(14, 26);
    l.style.width = size + "px";
    l.style.height = size * 1.3 + "px";
    l.style.left = rand(2, 96) + "%";
    l.style.setProperty("--sway", rand(-80, 80) + "px");
    l.style.animationDuration = rand(18, 34) + "s";
    l.style.animationDelay = -rand(0, 30) + "s";
    l.style.opacity = rand(.6, 1);
    sky.appendChild(l);
  }
  for (let i = 0; i < 16; i++) {
    const p = document.createElement("div");
    p.className = "petal";
    const size = rand(8, 14);
    p.style.width = size + "px";
    p.style.height = size * .8 + "px";
    p.style.left = rand(0, 100) + "%";
    p.style.setProperty("--drift", rand(-150, 150) + "px");
    p.style.animationDuration = rand(10, 20) + "s";
    p.style.animationDelay = -rand(0, 20) + "s";
    sky.appendChild(p);
  }
}
spawnScene();

/* ---------- Funken ---------- */
function sparkle() {
  for (let i = 0; i < 26; i++) {
    const s = document.createElement("span");
    s.className = "spark";
    const angle = rand(0, Math.PI * 2);
    const dist = rand(70, 150);
    s.style.setProperty("--x", Math.cos(angle) * dist + "px");
    s.style.setProperty("--y", Math.sin(angle) * dist + "px");
    burst.appendChild(s);
    setTimeout(() => s.remove(), 1000);
  }
}

/* ---------- Glückszahlen ---------- */
function luckyNumbers() {
  const set = new Set();
  while (set.size < 6) set.add(Math.floor(rand(1, 50)));
  return [...set].sort((a, b) => a - b).join(" · ");
}

/* ---------- Keks ---------- */
let last = -1;

function openCookie() {
  if (cookie.classList.contains("open")) return;

  let i;
  do { i = Math.floor(Math.random() * fortunes.length); } while (i === last);
  last = i;

  fortuneEl.textContent = fortunes[i];
  numbersEl.textContent = luckyNumbers();

  cookie.classList.add("open");
  sparkle();
  paper.classList.add("show");
  hint.textContent = "Das Schicksal hat gesprochen.";
  again.hidden = false;

  addCount();
}

function reset() {
  cookie.classList.remove("open");
  paper.classList.remove("show");
  hint.textContent = "Berühre den Keks und empfange deine Weisheit.";
  again.hidden = true;
  cookie.focus();
}

cookie.addEventListener("click", openCookie);
again.addEventListener("click", reset);
