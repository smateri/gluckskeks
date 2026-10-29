const fortunes = [
  "Dein nächster Commit wird beim ersten Versuch durch die Pipeline laufen.",
  "Es ist nicht DNS. Es ist nie DNS. Es war DNS.",
  "Ein Bug, den du heute findest, ist einer, den der Kunde morgen nicht findet.",
  "Wer freitags deployt, erntet Wochenend-Abenteuer.",
  "Die Lösung liegt in der Fehlermeldung, die du nicht gelesen hast.",
  "Du wirst heute eine Variable großartig benennen.",
  "Auf deinem Rechner funktioniert es. Bald auch auf dem Server.",
  "Ein gut geschriebener Kommentar ist ein Geschenk an dein zukünftiges Ich.",
  "Das Glück ist mit denen, die vorher ein Backup gemacht haben.",
  "Du wirst ein Problem lösen, indem du es einer Gummiente erklärst.",
  "Der Fluss umgeht den Stein. Der weise Entwickler umgeht den Merge-Konflikt.",
  "Ein Refactor von tausend Zeilen beginnt mit einer einzigen Umbenennung.",
  "Wer den Stacktrace bis zum Ende liest, findet den Weg.",
  "Der Bambus biegt sich im Sturm. Dein Server skaliert unter Last.",
  "Dein Code wird gelesen werden. Schreib ihn, als wüsstest du das."
];

const $ = (id) => document.getElementById(id);
const cookie = $("cookie"), paper = $("paper"), fortuneEl = $("fortune");
const numbersEl = $("numbers"), again = $("again"), hint = $("hint");
const countEl = $("count"), burst = $("burst"), sky = $("sky");

const rand = (min, max) => Math.random() * (max - min) + min;

/* ---------- Zähler ---------- */
let count = 0;
try { count = Number(localStorage.getItem("cookies")) || 0; } catch (e) {}
countEl.textContent = count;

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

  count++;
  countEl.textContent = count;
  try { localStorage.setItem("cookies", count); } catch (e) {}
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
