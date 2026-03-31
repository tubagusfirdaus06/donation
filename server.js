const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const bodyParser = require("body-parser");
const cors = require("cors");

// 🔥 FILE STORAGE
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

// 🔥 LOAD DATA
let donations = [];
if (fs.existsSync(DB_FILE)) {
  try {
    const raw = fs.readFileSync(DB_FILE);
    donations = JSON.parse(raw);
    console.log("📂 Data loaded:", donations.length);
  } catch (e) {
    console.error("❌ Gagal load data:", e);
  }
}

let checking = false;

// 🔥 SAVE FUNCTION
function saveDonations() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(donations, null, 2));
  } catch (e) {
    console.error("❌ Gagal save:", e);
  }
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

function formatDateTime(timestamp) {
  const d = new Date(timestamp);

  return {
    date: d.toLocaleDateString("id-ID", {
      day: "2-digit",
      month: "long",
      year: "numeric"
    }),
    time: d.toLocaleTimeString("id-ID", {
      hour: "2-digit",
      minute: "2-digit"
    })
  };
}

/* ========================= */

async function createQRIS(amount) {
  const url = `https://restapieliana.xyz/orderkuota/createpayment?apikey=${API_KEY}&username=${USERNAME}&token=${encodeURIComponent(TOKEN)}&amount=${amount}`;
  const res = await fetch(url);
  const json = await res.json();
  const data = json.result?.[0] || json.result;
  return { image: data?.imageqris?.url || "" };
}

/* ========================= */

async function getMutasi() {
  const url = `https://restapieliana.xyz/orderkuota/mutasiqr?apikey=${API_KEY}&username=${USERNAME}&token=${encodeURIComponent(TOKEN)}`;
  const res = await fetch(url);
  const json = await res.json();
  return json.result || [];
}

/* ========================= */

async function checkMutasiLoop() {
  if (checking) return;
  checking = true;

  const interval = setInterval(async () => {
    const pending = donations.filter(d => d.status === "pending");

    if (pending.length === 0) {
      clearInterval(interval);
      checking = false;
      return;
    }

    const mutasi = await getMutasi();

    for (let trx of mutasi) {
      if (trx.status !== "IN") continue;

      const amount = Number(String(trx.kredit).replace(/\./g, ""));

      for (let d of pending) {
        if (Number(d.amount_unique) === amount) {

          d.status = "paid";

          // 🔥 RULE 1
          if (d.amount_original < 10000) {
            d.media_url = "";
          }

          // 🔥 RULE 2
          d.video_duration = Math.floor(d.amount_original / 200);

          saveDonations(); // 🔥 SAVE

          io.emit("donation", d);
          break;
        }
      }
    }
  }, 5000);
}

/* ========================= */

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

  donations.push(donation);

  // 🔥 OPTIONAL LIMIT
  if (donations.length > 1000) {
    donations = donations.slice(-1000);
  }

  saveDonations(); // 🔥 SAVE

  checkMutasiLoop();

  res.json(donation);
});

/* ========================= */

app.get("/donation/:id", (req, res) => {
  const d = donations.find(x => x.id == req.params.id);
  res.json(d || {});
});

app.get("/check/:id", (req, res) => {
  const d = donations.find(x => x.id == req.params.id);
  res.json({ status: d?.status || "pending" });
});

/* ========================= */

server.listen(3000, () => {
  console.log("🚀 Server jalan di http://localhost:3000");
});

/* ========================= */

io.on("connection", (socket) => {
  socket.on("donation", (data) => {
    io.emit("donation", data);
  });
});

/* ========================= */

// 🔥 GET ALL DONATIONS
app.get("/donations", (req, res) => {
  const result = donations.map(d => {
    const { date, time } = formatDateTime(d.created_at);

    return {
      ...d,
      date,
      time
    };
  });

  res.json(result.reverse());
});

// 🔥 REPLAY
app.post("/replay/:id", (req, res) => {
  const d = donations.find(x => x.id == req.params.id);

  if (!d) return res.status(404).json({ error: "not found" });

  console.log("🔁 REPLAY:", d.name);

  io.emit("donation", d);

  res.json({ success: true });
});