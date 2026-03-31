const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const bodyParser = require("body-parser");
const cors = require("cors");

const fs = require("fs");
const path = require("path");
const DB_FILE = path.join(__dirname, "donations.json");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(cors());
app.use(bodyParser.json());
app.use(express.static("public"));

const API_KEY = "ugaliuwt87t8wq98ysg98ay";
const USERNAME = "elianacharostore";
const TOKEN = "2402702:zd4IGiVAOpeRvFEnbqWlTmftHwSgausD";

/* ========================= */
/* 🔥 STORAGE */

let donations = []; // ONLY PAID
let pendingDonations = []; // MEMORY ONLY

if (fs.existsSync(DB_FILE)) {
  try {
    donations = JSON.parse(fs.readFileSync(DB_FILE));
    console.log("📂 Data loaded:", donations.length);
  } catch {}
}

function saveDonations() {
  fs.writeFileSync(DB_FILE, JSON.stringify(donations, null, 2));
}

/* ========================= */

function generateUniqueAmount(base) {
  let unique;
  let amount;
  do {
    unique = Math.floor(Math.random() * 900) + 100;
    amount = Number(base) + unique;
  } while (donations.some(d => d.amount_unique === amount));
  return amount;
}

/* ========================= */

async function createQRIS(amount) {
  const url = `https://restapieliana.xyz/orderkuota/createpayment?apikey=${API_KEY}&username=${USERNAME}&token=${encodeURIComponent(TOKEN)}&amount=${amount}`;
  const res = await fetch(url);
  const json = await res.json();
  const data = json.result?.[0] || json.result;
  return { image: data?.imageqris?.url || "" };
}

async function getMutasi() {
  try {
    const url = `https://restapieliana.xyz/orderkuota/mutasiqr?apikey=${API_KEY}&username=${USERNAME}&token=${encodeURIComponent(TOKEN)}`;
    const res = await fetch(url);
    const json = await res.json();
    return json.result || [];
  } catch {
    console.log("❌ error mutasi");
    return [];
  }
}

/* ========================= */
/* 🔥 AUTO LOOP (SERVER SIDE) */

let checking = false;

async function checkMutasiLoop() {
  if (checking) return;
  checking = true;

  const interval = setInterval(async () => {

    if (pendingDonations.length === 0) {
      clearInterval(interval);
      checking = false;
      return;
    }

    const mutasi = await getMutasi();

    for (let trx of mutasi) {
      if (trx.status !== "IN") continue;

      const amount = Number(String(trx.kredit).replace(/\./g, ""));

      for (let d of [...pendingDonations]) {

        // ⏱ TIMEOUT 2 MENIT
        if (Date.now() - d.created_at > 2 * 60 * 1000) {
          console.log("⏰ expired:", d.id);
          pendingDonations = pendingDonations.filter(x => x.id !== d.id);
          continue;
        }

        if (amount === Number(d.amount_unique)) {

  d.status = "paid";

  // 🔥 RULE
  if (d.amount_original < 10000) d.media_url = "";
  d.video_duration = Math.floor(d.amount_original / 200);

  // 🔥 TAMBAH TANGGAL & JAM
  const now = new Date();

  d.tanggal = now.toLocaleDateString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric"
  });

  d.jam = now.toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit"
  });

  // 🔥 BACKUP (buat filter tetap jalan)
  d.created_at = Date.now();

  // 🔥 SIMPAN KE FILE (clean object)
  donations.push({
    id: d.id,
    name: d.name,
    message: d.message,
    media_url: d.media_url,
    amount_original: d.amount_original,
    amount_unique: d.amount_unique,
    video_duration: d.video_duration,
    tanggal: d.tanggal,
    jam: d.jam,
    created_at: d.created_at
  });

  // 🔥 LIMIT HISTORY
  if (donations.length > 1000) {
    donations = donations.slice(-1000);
  }

  saveDonations();

  // 🔥 HAPUS PENDING
  pendingDonations = pendingDonations.filter(x => x.id !== d.id);

  console.log("💰 PAID:", d.amount_unique);

  // 🔥 KIRIM KE OVERLAY
  io.emit("donation", d);
}
      }
    }

  }, 5000);
}

/* ========================= */
/* 🔥 DONATE */

app.post("/donate", async (req, res) => {
  const { name, amount, message, media_url } = req.body;

  const amount_unique = generateUniqueAmount(amount);
  const qris = await createQRIS(amount_unique);

  const donation = {
    id: Date.now(),
    name,
    message,
    media_url,
    amount_original: Number(amount),
    amount_unique,
    qr: qris.image,
    status: "pending",
    created_at: Date.now()
  };

  // 🔥 SIMPAN KE MEMORY
  pendingDonations.push(donation);

  checkMutasiLoop();

  res.json(donation);
});

/* ========================= */

app.get("/donation/:id", (req, res) => {
  const d =
    pendingDonations.find(x => x.id == req.params.id) ||
    donations.find(x => x.id == req.params.id);

  res.json(d || {});
});

/* ========================= */

app.get("/check/:id", (req, res) => {
  const id = req.params.id;

  const pending = pendingDonations.find(x => x.id == id);
  if (pending) return res.json({ status: "pending" });

  const paid = donations.find(x => x.id == id);
  if (paid) return res.json({ status: "paid" });

  return res.json({ status: "expired" });
});

/* ========================= */

app.get("/donations", (req, res) => {
  res.json(donations.reverse());
});

/* ========================= */

app.post("/replay/:id", (req, res) => {
  const d = donations.find(x => x.id == req.params.id);

  if (!d) return res.status(404).json({ error: "not found" });

  io.emit("donation", d);

  res.json({ success: true });
});

/* ========================= */

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log("🚀 Server jalan di port", PORT);
});

/* ========================= */

io.on("connection", (socket) => {
  socket.on("donation", (data) => {
    io.emit("donation", data);
  });
});