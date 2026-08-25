const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
app.use(express.json());

// 1. Database Setup
const db = new sqlite3.Database('./inventory.db', (err) => {
  if (err) console.error('Database Connection Error:', err.message);
  else console.log('Connected to SQLite Database.');
});

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS parts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      barcode TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      quantity INTEGER DEFAULT 0,
      min_quantity INTEGER DEFAULT 5
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      part_id INTEGER,
      type TEXT CHECK(type IN ('WITHDRAW', 'RECEIVE')),
      amount INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (part_id) REFERENCES parts(id)
    )
  `);
});

// 2. API Endpoints
app.get('/api/parts/:barcode', (req, res) => {
  db.get('SELECT * FROM parts WHERE barcode = ?', [req.params.barcode], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'ไม่พบอะไหล่ชิ้นนี้ในระบบ' });
    res.json(row);
  });
});

app.post('/api/withdraw', (req, res) => {
  const { barcode, amount } = req.body;
  const qty = parseInt(amount, 10);

  if (!barcode || isNaN(qty) || qty <= 0) {
    return res.status(400).json({ error: 'กรุณาระบุ Barcode และจำนวนที่ถูกต้อง' });
  }

  db.get('SELECT * FROM parts WHERE barcode = ?', [barcode], (err, part) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!part) return res.status(404).json({ error: 'ไม่พบรายการอะไหล่นี้ในระบบ' });
    if (part.quantity < qty) {
      return res.status(400).json({ error: `สต็อกไม่พอ (คงเหลือ: ${part.quantity})` });
    }

    const newQty = part.quantity - qty;
    db.serialize(() => {
      db.run('UPDATE parts SET quantity = ? WHERE id = ?', [newQty, part.id]);
      db.run('INSERT INTO transactions (part_id, type, amount) VALUES (?, "WITHDRAW", ?)', [part.id, qty]);
      res.json({
        message: 'ตัดยอดสำเร็จ',
        part_name: part.name,
        remaining: newQty,
        warning: newQty <= part.min_quantity ? 'คำเตือน: อะไหล่ต่ำกว่าจุดขั้นต่ำ!' : null
      });
    });
  });
});

app.post('/api/parts', (req, res) => {
  const { barcode, name, quantity, min_quantity } = req.body;
  const sql = `
    INSERT INTO parts (barcode, name, quantity, min_quantity)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(barcode) DO UPDATE SET
      quantity = quantity + excluded.quantity,
      name = excluded.name
  `;
  db.run(sql, [barcode, name, parseInt(quantity) || 0, parseInt(min_quantity) || 5], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'บันทึก/เพิ่มสต็อกอะไหล่เรียบร้อย' });
  });
});

// 3. Frontend Web Interface
app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Spare Part Barcode Scanner</title>
  <script src="https://unpkg.com/html5-qrcode"></script>
  <style>
    body { font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f4f4f9; }
    .card { background: #fff; padding: 20px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.1); margin-bottom: 20px; }
    #reader { width: 100%; border-radius: 8px; overflow: hidden; }
    input, button { width: 100%; padding: 10px; margin-top: 10px; box-sizing: border-box; border-radius: 4px; border: 1px solid #ccc; }
    button { background: #007bff; color: white; border: none; font-weight: bold; cursor: pointer; }
    button:hover { background: #0056b3; }
    .btn-add { background: #28a745; }
    .btn-add:hover { background: #218838; }
    #result { padding: 10px; border-radius: 4px; margin-top: 10px; display: none; }
    .success { background: #d4edda; color: #155724; }
    .error { background: #f8d7da; color: #721c24; }
  </style>
</head>
<body>

  <div class="card">
    <h2>สแกนบาร์โค้ดเพื่อเบิกอะไหล่</h2>
    <div id="reader"></div>
    
    <label>Barcode:</label>
    <input type="text" id="barcode" placeholder="ผลการสแกนจะปรากฏที่นี่">
    
    <label>จำนวนที่ต้องการเบิก:</label>
    <input type="number" id="amount" value="1" min="1">
    
    <button onclick="withdrawPart()">ยืนยันการตัดยอดเบิก</button>
    <div id="result"></div>
  </div>

  <div class="card">
    <h3>เพิ่มอะไหล่ใหม่ / เพิ่มสต็อก</h3>
    <input type="text" id="add_barcode" placeholder="Barcode">
    <input type="text" id="add_name" placeholder="ชื่ออะไหล่">
    <input type="number" id="add_qty" placeholder="จำนวนที่นำเข้า" value="10">
    <button class="btn-add" onclick="addPart()">บันทึกข้อมูลเข้าสต็อก</button>
  </div>

  <script>
    const html5QrCode = new Html5Qrcode("reader");
    html5QrCode.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 250, height: 150 } },
      (decodedText) => {
        document.getElementById('barcode').value = decodedText;
      }
    ).catch(err => console.log("กล้องถูกปิดใช้งานหรือไม่อยู่บน HTTPS/localhost"));

    async function withdrawPart() {
      const barcode = document.getElementById('barcode').value;
      const amount = document.getElementById('amount').value;
      const res = await fetch('/api/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ barcode, amount })
      });
      const data = await res.json();
      showResult(data.error ? data.error : \`\${data.message} (\${data.part_name}) คงเหลือ: \${data.remaining}\`, !data.error);
    }

    async function addPart() {
      const barcode = document.getElementById('add_barcode').value;
      const name = document.getElementById('add_name').value;
      const quantity = document.getElementById('add_qty').value;
      const res = await fetch('/api/parts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ barcode, name, quantity })
      });
      const data = await res.json();
      showResult(data.error || data.message, !data.error);
    }

    function showResult(msg, isSuccess) {
      const box = document.getElementById('result');
      box.style.display = 'block';
      box.className = isSuccess ? 'success' : 'error';
      box.innerText = msg;
    }
  </script>
</body>
</html>
  `);
});

// 4. Start Server
const PORT = 3000;
app.listen(PORT, () => console.log(`App running at http://localhost:${PORT}`));
